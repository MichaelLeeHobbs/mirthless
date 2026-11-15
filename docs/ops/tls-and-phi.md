# TLS Termination & PHI-in-Transit

Message content is PHI. **PHI must never traverse a network in plaintext.** TLS
applies at two independent layers in GalvaniFlow, and a compliant deployment secures
both:

1. **The admin/API edge** — the web UI and REST/WebSocket API, fronted by nginx.
2. **The connectors**: the healthcare interfaces themselves (HL7 over MLLP, HTTP, databases, mail, Kafka and AMQP brokers), which talk to external systems.

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

Individual connectors carry their own optional TLS configuration, independent of the edge. This is what protects the actual HL7, HTTP, database, mail and broker feeds to and from partner systems. How TLS is switched on differs by connector:

| Connector | Turns TLS on | Certificates |
|---|---|---|
| TCP/MLLP source | A `tls` object holding both `cert` and `key`; anything less fails the deploy | Inline PEM in the `tls` object (tables below) |
| TCP/MLLP destination | A `tls` object, which may be empty; a client `cert` needs its `key` and the reverse | Inline PEM in the `tls` object (tables below) |
| HTTP source | `scheme: 'HTTPS'` | Certificate store ids in `tls`: `serverCertId` (required, with a private key), optional `caCertId` and `requireClientCert` |
| HTTP destination | `scheme: 'HTTPS'`, or an `https://` URL | Optional certificate store ids in `tls`, used only with `scheme: 'HTTPS'`: `caCertId`, `clientCertId` (mutual TLS, needs a private key), `rejectUnauthorized` (default `true`) |
| Kafka and AMQP source and destination | `useTls: true` | Optional certificate store ids in `tls`: `caCertId`, `clientCertId`, `rejectUnauthorized` (default `true`) |
| DATABASE source and destination | `tls: true` | None to set: the server certificate is always verified against the system's trusted CAs |
| SMTP destination | `secure: true` (TLS from connect, usually port 465) or `requireTLS: true` (STARTTLS required before sending, usually port 587) | The Node runtime's trust store |
| EMAIL source | `secure` (default `true`) | The Node runtime's trust store |
| FHIR destination | An `https://` base URL | The Node runtime's trust store |

The PEM option shapes are defined in `packages/connectors/src/tls.ts`. For HTTP, Kafka and AMQP connectors the channel stores certificate store ids, and the server swaps them for PEM when it deploys the channel (`packages/server/src/services/connector-tls-resolver.ts`); a missing certificate, or one without the private key its role needs, stops the deploy. The Kafka and AMQP property schemas are in `packages/core-models/src/schemas/queue-connector.schema.ts`. The web forms set TLS for HTTP, Kafka, AMQP and DATABASE; TCP/MLLP TLS is set through the API, a channel import or an export file.

### Receivers (server side): `TlsServerOptions`

Applies to the **TCP/MLLP source** and, after the server has resolved its certificate ids, the **HTTP source**. When TLS is on (a `tls` object for TCP/MLLP, `scheme: 'HTTPS'` for HTTP), the receiver terminates TLS (`tls.createServer` / `https.createServer`).

| Field | Type | Required | Default | Meaning |
|-------|------|----------|---------|---------|
| `cert` | string (PEM) | **yes** | — | Server certificate chain |
| `key` | string (PEM) | **yes** | — | Server private key |
| `ca` | string (PEM) | no | omitted | CA bundle to verify client certs |
| `requireClientCert` | boolean | no | `false` | Require + verify a client cert (mutual TLS) |

Both `cert` and `key` are mandatory. A TCP/MLLP source whose `tls` object lacks the certificate, the private key or both (an empty `tls: {}` included), and an HTTP source on `scheme: 'HTTPS'` without both, fail to deploy with an error that starts `TLS configuration is incomplete:` and names what is missing. On a TCP/MLLP connector, a `tls` value that is not an object, `false` or `null`, a PEM field that is not a string, or a key inside `tls` that is not listed here fails deploy validation with `Invalid source connector properties for TCP_MLLP: tls...`. On an HTTP source the same mistakes fail the deploy with `TLS configuration is invalid:`. The listener never falls back to plaintext. To run a TCP/MLLP source without TLS, remove `tls` or set it to `false`; an HTTP source runs without TLS on any scheme other than `HTTPS` when its `tls` holds only certificate store ids (as the form leaves it). An HTTP source whose `tls` holds a `cert` or `key` PEM on a scheme other than `HTTPS` fails to deploy with `TLS configuration is invalid: tls has a certificate but scheme is not HTTPS`, rather than ignoring the certificate.

### Dispatchers (client side): `TlsClientOptions`

Applies to the **TCP/MLLP destination**, and to the HTTP, Kafka and AMQP connectors after the server has resolved their certificate ids. When `tls` is an object on a TCP/MLLP destination, the dispatcher connects over TLS (`tls.connect`); `tls: false` or no `tls` means plaintext. The client certificate is optional, but a `cert` without its `key`, or a `key` without its `cert`, fails the deploy with `TLS configuration is incomplete:` rather than connecting without it.

| Field | Type | Required | Default | Meaning |
|-------|------|----------|---------|---------|
| `cert` | string (PEM) | no | — | Client cert for mutual TLS |
| `key` | string (PEM) | no | — | Client private key for mutual TLS |
| `ca` | string (PEM) | no | — | CA bundle to verify the server cert |
| `rejectUnauthorized` | boolean | no | **`true`** | Verify the server cert against trusted CAs |

> `rejectUnauthorized` defaults to **true** (certificate verification ON). Set it to
> `false` only for an explicit, audited exception (e.g. a self-signed test peer) — doing
> so in production defeats TLS's authentication guarantee.

### HTTP destination

With `scheme: 'HTTPS'` the HTTP destination sends over `node:https` and applies its resolved `tls` options: a private CA to trust, a client certificate for mutual TLS, and `rejectUnauthorized`. Without a scheme, an `https://` URL with no custom TLS options goes through `fetch` and the Node runtime's trust store.

### Connectors with a TLS switch but no certificate options

DATABASE (`tls: true`) verifies the server certificate against the system's trusted CAs and has no option to add a CA or a client certificate. SMTP, EMAIL and FHIR use the Node runtime's trust store. To trust a private CA for these, give it to the runtime (for example `NODE_EXTRA_CA_CERTS`).

### Connectors without TLS options today

FILE, JAVASCRIPT, CHANNEL and DICOM have no TLS option. SFTP has none either because SSH encrypts it; leave its `strictHostKey` check on so the server is authenticated. Where a DICOM feed carries PHI across a network, secure it at the network layer (VPN or private networking).

---

## PHI-in-Transit Checklist

- [ ] Edge TLS terminated (nginx 443 or upstream LB); port 80 redirects to 443.
- [ ] `FRONTEND_URL` set to the `https://` origin; `TRUST_PROXY` matches your proxy setup.
- [ ] Every network interface that carries PHI has TLS on, using the switch the table in section 2 names for its connector (`tls` for TCP/MLLP, `scheme: 'HTTPS'` for HTTP, `useTls` for Kafka and AMQP, `tls: true` for DATABASE, `secure` or `requireTLS` for SMTP).
- [ ] Dispatcher `rejectUnauthorized` left at its `true` default (verify server certs).
- [ ] Non-TLS-aware connectors carrying PHI are secured at the network layer.
- [ ] Certificates are rotated before expiry and stored outside the repo / image.
- [ ] TLS 1.2+ only (the shipped nginx snippet pins `TLSv1.2 TLSv1.3`).
