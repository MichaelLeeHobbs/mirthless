# TLS Termination & PHI-in-Transit

Message content is PHI. **PHI must never traverse a network in plaintext.** TLS
applies at two independent layers in Mirthless, and a compliant deployment secures
both:

1. **The admin/API edge** — the web UI and REST/WebSocket API, fronted by nginx.
2. **The connectors** — the healthcare interfaces themselves (MLLP/HL7, HTTP), which
   talk to external systems.

---

## 1. Edge TLS (nginx / reverse proxy)

The production stack ships **nginx listening on port 80** (`docker/nginx/default.conf`),
serving the built web UI and reverse-proxying `/api/`, `/health`, `/socket.io/`, and
`/metrics` to the server on `:3000`. Port 80 is plaintext — you must terminate TLS in
front of it.

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
port-80 block, `return 301 https://$host$request_uri;`.

### Option B — terminate upstream

Put a TLS-terminating load balancer / ingress (ALB, Cloudflare, Traefik, another nginx)
in front and forward plaintext to the web container on port 80 **inside a trusted
network only**. The server already honors `X-Forwarded-*` headers — keep `TRUST_PROXY`
set appropriately (`true` behind a single proxy, or a hop count) so rate limiting and
client-IP logging work.

Either way: set `FRONTEND_URL=https://your-domain.com` so CORS matches the TLS origin.

---

## 2. Connector-level TLS

Individual connectors carry their own optional TLS configuration, independent of the
edge. This is what protects the actual HL7/HTTP feeds to and from partner systems. The
option shapes are defined in `packages/connectors/src/tls.ts` and set on a connector's
properties under a `tls` object. **The presence of the `tls` object enables TLS** — there
is no separate `enabled` flag.

### Receivers (server side) — `TlsServerOptions`

Applies to the **TCP/MLLP source** and the **HTTP source**. When a `tls` object is
present, the receiver terminates TLS (`tls.createServer` / `https.createServer`).

| Field | Type | Required | Default | Meaning |
|-------|------|----------|---------|---------|
| `cert` | string (PEM) | **yes** | — | Server certificate chain |
| `key` | string (PEM) | **yes** | — | Server private key |
| `ca` | string (PEM) | no | omitted | CA bundle to verify client certs |
| `requireClientCert` | boolean | no | `false` | Require + verify a client cert (mutual TLS) |

Both `cert` and `key` are mandatory when `tls` is set — omitting either fails connector
startup with `TLS requires both cert and key`.

### Dispatchers (client side) — `TlsClientOptions`

Applies to the **TCP/MLLP destination**. When `tls` is present, the dispatcher connects
over TLS (`tls.connect`).

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

The **HTTP destination** has **no `tls` config object**. It uses `fetch`, so transport
security is governed entirely by the URL scheme: use an `https://` URL and TLS is applied
using the Node runtime's trust store. To trust a private CA, provide it to the runtime
(e.g. `NODE_EXTRA_CA_CERTS`).

### Connectors without TLS options today

FILE, DATABASE, JAVASCRIPT, CHANNEL, DICOM, FHIR, SMTP, and EMAIL connectors do not expose
a structured `tls` block. Where those protocols carry PHI (e.g. a DATABASE connector to a
remote Postgres, or an EMAIL/SMTP feed), secure them at the protocol/driver or network
layer (DB SSL parameters, SMTPS/STARTTLS, VPN/private networking).

---

## PHI-in-Transit Checklist

- [ ] Edge TLS terminated (nginx 443 or upstream LB); port 80 redirects to 443.
- [ ] `FRONTEND_URL` set to the `https://` origin; `TRUST_PROXY` matches your proxy setup.
- [ ] Every MLLP/HTTP interface that carries PHI has a `tls` config (or an `https://` URL
      for HTTP destinations).
- [ ] Dispatcher `rejectUnauthorized` left at its `true` default (verify server certs).
- [ ] Non-TLS-aware connectors carrying PHI are secured at the network layer.
- [ ] Certificates are rotated before expiry and stored outside the repo / image.
- [ ] TLS 1.2+ only (the shipped nginx snippet pins `TLSv1.2 TLSv1.3`).
