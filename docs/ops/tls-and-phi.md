# TLS Termination & PHI-in-Transit

Message content is PHI. **PHI must never traverse a network in plaintext.** TLS
applies at two independent layers in GalvaniFlow, and a compliant deployment secures
both:

1. **The admin/API edge**: the web UI and REST/WebSocket API, fronted by nginx.
2. **The connectors**: the healthcare interfaces themselves (MLLP/HL7, HTTP, database, mail, DICOM, Kafka, AMQP), which talk to external systems.

---

## 1. Edge TLS (nginx / reverse proxy)

The production stack ships **nginx listening on port 80** (`docker/nginx/default.conf`),
serving the built web UI and reverse-proxying `/api/`, `/health`, `/socket.io/`, and
`/metrics` to the server on `:3000`. Port 80 is plaintext — you must terminate TLS in
front of it. For that reason `docker/docker-compose.prod.yml` publishes it on
`127.0.0.1` only: out of the box it is reachable from the host itself and from nothing
else. `WEB_BIND` and `WEB_PORT` in `.env` change the address and port.

Two supported options:

### Option A — terminate at nginx (built-in guidance)

`docker/nginx/default.conf` contains a ready-to-uncomment `443 ssl` server block.
Mount your certificate and key, enable the 443 block, and redirect 80 → 443:

```nginx
server {
    listen 443 ssl http2;
    server_name your-domain.com;
    ssl_certificate     /etc/nginx/certs/fullchain.pem;
    ssl_certificate_key /etc/nginx/certs/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers HIGH:!aNULL:!MD5;
    # ... same location blocks as the port-80 server ...
}
```

Mount the certs into the web container (e.g. a volume at `/etc/nginx/certs`) and, in the
port-80 block, `return 301 https://$host$request_uri;`. Publish 443 from the `web`
service (`"443:443"` under `ports`) and set `WEB_BIND=0.0.0.0` so the redirect is
reachable.

### Option B — terminate upstream

Put a TLS-terminating load balancer / ingress (ALB, Cloudflare, Traefik, another nginx)
in front and forward plaintext to the web container on port 80 **inside a trusted
network only**. A proxy on the same host needs no change (it reaches `127.0.0.1:80`);
for one on another machine set `WEB_BIND` to the address of the trusted interface, or
`0.0.0.0`. The server already honors `X-Forwarded-*` headers — keep `TRUST_PROXY`
set appropriately (`true` behind a single proxy, or a hop count) so rate limiting and
client-IP logging work.

Either way: set `FRONTEND_URL=https://your-domain.com` so CORS matches the TLS origin.

---

## 2. Connector-level TLS

Individual connectors carry their own transport security, independent of the edge. This is what protects the HL7, HTTP, database, mail and broker feeds to and from partner systems. Which connectors have TLS, and how each one behaves when it is half configured, is in the [connector matrix](../user/connector-reference.md#connectors-at-a-glance).

Connectors set TLS in one of three ways:

- **A `tls` object with certificate IDs, resolved by the server.** The HTTP source and destination (with `scheme` set to `HTTPS`), and Kafka and AMQP (with `useTls` on), pick certificates from the certificate store. At deploy the server replaces the IDs with PEM (`packages/server/src/services/connector-tls-resolver.ts`). A missing certificate, or a client or server certificate without a private key, stops the channel deploying. An HTTPS source with no `serverCertId` refuses to deploy, so it cannot listen in plaintext by mistake.
- **A `tls` object with raw PEM.** TCP_MLLP reads PEM directly from its properties (`packages/connectors/src/tls.ts`). The channel editor has no TLS control for it, so the PEM is set through the API or a channel import.
- **A flag.** DATABASE has a `tls` boolean, SMTP has `secure` (implicit TLS) and `requireTLS` (STARTTLS required), and EMAIL has `secure` (IMAP over TLS, on by default).

DICOM has no TLS. FILE, JAVASCRIPT and CHANNEL do not cross a network themselves; secure the mount, or the endpoint a script calls, instead.

### Receivers (server side), TCP_MLLP

When a `tls` object holds both `cert` and `key`, the TCP_MLLP source terminates TLS (`tls.createServer`).

| Field | Type | Required | Default | Meaning |
|-------|------|----------|---------|---------|
| `cert` | string (PEM) | **yes** | none | Server certificate chain |
| `key` | string (PEM) | **yes** | none | Server private key |
| `ca` | string (PEM) | no | omitted | CA bundle to verify client certs |
| `requireClientCert` | boolean | no | `false` | Require and verify a client cert (mutual TLS) |

A `tls` object missing `cert` or `key` does **not** fail startup. `readTlsServerOptions` returns nothing when either is absent (`tls.ts:46-47`), so the receiver's own `TLS requires both cert and key` check never sees a `tls` block and the listener runs in plaintext with no error or warning. This is issue [#98](https://github.com/MichaelLeeHobbs/mirthless/issues/98). Until it is fixed, run the check below after deploying any TCP_MLLP listener with TLS.

The HTTP source is not affected: the server resolver refuses to deploy an HTTPS source without a usable server certificate.

### Dispatchers (client side), TCP_MLLP

When any `tls` object is present, the TCP_MLLP destination connects over TLS (`tls.connect`).

| Field | Type | Required | Default | Meaning |
|-------|------|----------|---------|---------|
| `cert` | string (PEM) | no | none | Client cert for mutual TLS |
| `key` | string (PEM) | no | none | Client private key for mutual TLS |
| `ca` | string (PEM) | no | Node trust store | CA bundle to verify the server cert |
| `rejectUnauthorized` | boolean | no | **`true`** | Verify the server cert against trusted CAs |

> `rejectUnauthorized` defaults to **true** (certificate verification on), for TCP_MLLP and for the certificate-store connectors alike. Set it to `false` only for an explicit, audited exception, such as a self-signed test peer. Doing so in production defeats TLS's authentication guarantee.

### HTTP destination

The HTTP destination reads a `tls` object (`packages/connectors/src/registry.ts:253`). With `scheme` set to `HTTPS`, the server resolves `tls.caCertId` and `tls.clientCertId` to PEM and the request always uses TLS with them, verifying the server against that CA or the Node trust store. With no `scheme` and an `https://` URL, the request uses the Node trust store; to trust a private CA that way, provide it to the runtime (for example `NODE_EXTRA_CA_CERTS`).

### Check TLS is on

After deploying a listener with TLS, check from another machine that it speaks TLS and refuses plaintext. Replace `host` and `port` with the listener's.

1. A TLS handshake succeeds and shows your certificate:

   ```bash
   openssl s_client -connect host:port -servername host < /dev/null
   ```

   The output should show the certificate chain and `Verify return code: 0 (ok)` (or the code you expect for a private CA). `no peer certificate available` or `wrong version number` means the listener is not speaking TLS.

2. A plaintext MLLP frame gets no HL7 acknowledgement:

   ```bash
   printf '\x0bMSH|^~\\&|TEST|TEST|GF|GF|20260101000000||ADT^A01|TLSCHECK|P|2.5\r\x1c\r' | nc -w 5 host port
   ```

   A TLS listener closes the connection or prints nothing readable. If an acknowledgement containing `MSA|` comes back, the listener is plaintext: undeploy it and fix the `tls` block (both `cert` and `key` must be set). A plaintext listener also takes this test message into the channel, so look for message control ID `TLSCHECK` and remove it.

Until [#98](https://github.com/MichaelLeeHobbs/mirthless/issues/98) is fixed, run both steps after every deploy of a TCP_MLLP listener with TLS.

---

## PHI-in-Transit Checklist

- [ ] Edge TLS terminated (nginx 443 or upstream LB); port 80 redirects to 443.
- [ ] `FRONTEND_URL` set to the `https://` origin; `TRUST_PROXY` matches your proxy setup.
- [ ] Every connector that carries PHI over a network has its TLS setting on (see the [connector matrix](../user/connector-reference.md#connectors-at-a-glance)).
- [ ] Every TCP_MLLP listener with TLS passed [Check TLS is on](#check-tls-is-on) after deploy (#98).
- [ ] Dispatcher `rejectUnauthorized` left at its `true` default (verify server certs).
- [ ] Connectors without TLS (DICOM) and file mounts carrying PHI are secured at the network layer.
- [ ] Certificates are rotated before expiry and stored outside the repo / image.
- [ ] TLS 1.2+ only (the shipped nginx snippet pins `TLSv1.2 TLSv1.3`).
