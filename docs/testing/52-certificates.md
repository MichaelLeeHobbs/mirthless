# 52 — Certificates

SSL/TLS certificate store: a central place to import, track, and monitor the
expiry of certificates and key pairs used to secure connectors.

## Prerequisites
- Logged in as admin or a user with `settings:read` (to view) and `settings:write` (to import/edit/delete)
- A PEM-encoded X.509 certificate available for import. Generate a throwaway one with:
  `openssl req -x509 -newkey rsa:2048 -keyout key.pem -out cert.pem -days 3650 -nodes -subj "/CN=test"`

> **Scope note.** This page is a certificate *store* for tracking and expiry
> monitoring. Connectors do not reference certificates by ID — TLS is still
> configured by pasting PEM material directly into each connector's TLS
> settings (see "TLS on Connectors" below). The page shows an info banner to
> this effect.

## Navigation & List

| # | Scenario | Steps | Expected | Pass? |
|---|---|---|---|---|
| 1 | Navigate to Certificates | Open `/certificates` | Page loads with heading "Certificates" and the info banner about the store's scope | |
| 2 | Empty state | With no certificates stored | "No certificates yet" empty state with an "Add Certificate" prompt | |
| 3 | List columns | With ≥1 certificate | Table shows Name, Type, Subject, Issuer, Expiry, Actions | |
| 4 | Loading indicator | Reload the page | Table skeleton shown while loading; background refetch shows a small spinner beside the title | |
| 5 | Load error | Stop the API, reload | "Couldn't load certificates" error state with a Retry button | |

## Import (Create)

| # | Scenario | Steps | Expected | Pass? |
|---|---|---|---|---|
| 6 | Open Add dialog | Click "Add Certificate" | Dialog opens titled "Add Certificate" with Name, Description, Type, Certificate PEM, Private Key PEM fields | |
| 7 | Type default | Observe Type field | Defaults to CA; options are CA, CLIENT, SERVER, KEYPAIR | |
| 8 | Save disabled until valid | Leave Name or Certificate PEM empty | "Create" button disabled until both Name and Certificate PEM are non-empty | |
| 9 | Import a CA cert | Fill Name, paste a valid PEM into Certificate PEM, keep Type=CA, click Create | Dialog closes; certificate appears in list with parsed Subject/Issuer/Expiry | |
| 10 | Parsed metadata | After import | Subject, Issuer, Not-Before, Not-After are extracted from the PEM (not typed by the user) | |
| 11 | Import with private key | Choose Type=KEYPAIR, paste both Certificate PEM and Private Key PEM, Create | Certificate saved; the private key is stored server-side but never returned in read responses | |
| 12 | Invalid PEM rejected | Paste `not a valid pem` into Certificate PEM, Create | Error alert "Invalid PEM certificate: unable to parse" in the dialog; dialog stays open; no row added | |
| 13 | Duplicate name rejected | Import a second certificate with a name that already exists | Error alert "Certificate \"…\" already exists"; no duplicate row | |
| 14 | Cancel | Open Add dialog, click Cancel | Dialog closes, no certificate created | |

## Expiry Indicators

| # | Scenario | Steps | Expected | Pass? |
|---|---|---|---|---|
| 15 | Healthy expiry | Import a cert expiring >90 days out | Green chip "Nd remaining" | |
| 16 | Warning expiry | Import a cert expiring in 30–90 days | Amber/warning chip "Nd remaining" | |
| 17 | Critical expiry | Import a cert expiring in <30 days | Red/error chip "Nd remaining" | |
| 18 | Expired cert | Import an already-expired cert | Red chip "Expired Nd ago" | |
| 19 | Validity range | Any row | "notBefore - notAfter" dates shown in the Expiry cell | |

## Edit

| # | Scenario | Steps | Expected | Pass? |
|---|---|---|---|---|
| 20 | Open Edit dialog | Click the Edit (pencil) action on a row | Dialog titled "Edit Certificate"; Name/Description/Type prefilled; PEM fields load from the server | |
| 21 | PEM loading state | Immediately after opening Edit | Certificate PEM field disabled with "Loading..." until detail loads | |
| 22 | Rename | Change Name, click Update | Row name updates in the list | |
| 23 | Replace PEM | Paste a different valid PEM, Update | Subject/Issuer/Expiry re-parse to match the new PEM | |
| 24 | Replace with invalid PEM | Paste an unparseable PEM, Update | "Invalid PEM certificate" error; dialog stays open; existing row unchanged | |

## Delete

| # | Scenario | Steps | Expected | Pass? |
|---|---|---|---|---|
| 25 | Delete confirmation | Click the Delete (trash) action on a row | ConfirmDialog "Delete Certificate" asks to confirm; warns the action cannot be undone | |
| 26 | Cancel delete | Click Cancel in the confirm dialog | Dialog closes, certificate remains | |
| 27 | Confirm delete | Click Delete in the confirm dialog | Row removed from the list | |
| 28 | Delete pending state | While the delete request is in flight | Confirm button shows a pending/disabled state | |

## Certificate Generation (CSR)

> **Not currently implemented in-app.** There is no server endpoint or UI to
> generate a key pair or a Certificate Signing Request. Certificates are
> imported as PEM only. These rows document the expected current behavior and
> the external workflow.

| # | Scenario | Steps | Expected | Pass? |
|---|---|---|---|---|
| 29 | No in-app generate | Inspect the Add Certificate dialog | Only import (paste PEM) is offered — no "Generate" / "Create CSR" button | |
| 30 | External key pair | `openssl genrsa -out key.pem 2048` | Key generated externally | |
| 31 | External CSR | `openssl req -new -key key.pem -out req.csr -subj "/CN=host"` | CSR generated externally, to be signed by a CA | |
| 32 | Import signed result | Paste the CA-signed certificate PEM (and, for a KEYPAIR, the private key) via Add Certificate | Certificate stored and tracked with correct expiry | |

## TLS on Connectors

> How the certificate store relates to connector security today. TLS is enabled
> per-connector by pasting PEM material into that connector's TLS settings; the
> connector does not look the certificate up from this store by ID.

| # | Scenario | Steps | Expected | Pass? |
|---|---|---|---|---|
| 33 | Store is reference-only | Import a SERVER certificate here | It appears in the store for expiry tracking but is not auto-applied to any connector | |
| 34 | Enable TLS on a connector | Open a TLS-capable connector (e.g. TCP/MLLP or HTTP), enable TLS, paste the same server cert + key PEM into its TLS settings | Connector negotiates TLS using the pasted material | |
| 35 | Expiry awareness | Keep the store cert in sync with what's pasted into connectors | Expiry chips in the store warn before the connector's live cert expires | |
| 36 | CA trust for clients | For a client connector verifying a peer, paste the CA PEM into the connector's trust settings | Peer certificate validated against the pasted CA | |
