# Scripting the REST API

GalvaniGraph has no command-line client (D-280). Scripts and CI jobs call the REST API directly. The full API is described at `/api-docs` on a running server. These recipes cover the usual pipeline: export a channel, commit it, then import and deploy it on another server.

Every response has the shape `{ "success": true, "data": ... }` or `{ "success": false, "error": { "code", "message" } }`, and a failure has a non-2xx status. Use `curl --fail-with-body` so a failed call fails the script and still prints the error.

## Get a token

A script uses an API key. Issue one on the API keys page (Administration, **New key**) as someone who holds `api_keys:manage`. These recipes need `channels:read` (export, status), `channels:write` (import) and `channels:deploy` (redeploy). A key holds its permissions on every channel or on chosen channel groups, always has an end time, and can hold only what its issuer holds until then. The token is shown once; keep it in the CI system's secret store. [Access control](../user/access-control.md#api-keys) has the limits and what stops a key.

```bash
export GALVANIGRAPH_URL=https://galvanigraph.example.org
export GALVANIGRAPH_TOKEN="$CI_SECRET_GALVANIGRAPH_KEY"   # gf_<keyId>_<secret>
```

Every request sends it as `Authorization: Bearer $GALVANIGRAPH_TOKEN`. A key in a URL is refused.

A key can also be issued through the API, signed in as a person, since a key can never hold `api_keys:manage`. `groupIds` is `null` for every channel, or a list of channel group IDs:

```bash
ACCESS_TOKEN=$(curl -sS --fail-with-body "$GALVANIGRAPH_URL/api/v1/auth/login" \
  -H 'Content-Type: application/json' \
  -d "{\"username\":\"$GF_USER\",\"password\":\"$GF_PASSWORD\"}" | jq -r '.data.accessToken')
curl -sS --fail-with-body "$GALVANIGRAPH_URL/api/v1/api-keys" \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"name":"Channel pipeline","permissions":["channels:read","channels:write","channels:deploy"],"groupIds":null,"expiresAt":"2027-06-30T00:00:00Z"}' | jq -r '.data.token'
```

## Export a channel

```bash
curl -sS --fail-with-body "$GALVANIGRAPH_URL/api/v1/channels/$CHANNEL_ID/export" \
  -H "Authorization: Bearer $GALVANIGRAPH_TOKEN" | jq '.data' > channels/my-channel.json
```

`GET /api/v1/channels/export` exports every channel in the same format.

## Import it on another server

The import body is the exported file plus `collisionMode`: `OVERWRITE` replaces a channel with the same ID, `SKIP` leaves it, `CREATE_NEW` imports a copy. New channels join the channel group named in an optional `groupId`, or Default when the caller can change every channel; a caller who can change channels in several groups but not all of them must name one. `OVERWRITE` needs `channels:write` on each channel it replaces; one outside the caller's scope is listed in `errors` and left as it was ([access control](../user/access-control.md)). Which credentials it keeps is [below](#credentials).

```bash
jq '. + {collisionMode: "OVERWRITE"}' channels/my-channel.json | \
  curl -sS --fail-with-body "$GALVANIGRAPH_URL/api/v1/channels/import" \
    -H "Authorization: Bearer $GALVANIGRAPH_TOKEN" \
    -H 'Content-Type: application/json' --data-binary @-
```

## Credentials

An export masks connector credentials, and so does a backup: where a connector setting named like a secret (a password, passphrase, private key, token, API key, `Authorization` or `Cookie` header, at any depth) has a value, the file has `__REDACTED__`. A credential written into a script, a query, a URL, a message template or headers saved as text is not recognised and is exported as it is. An import never stores the mask itself:

- A new channel (`CREATE_NEW`, or an ID the server does not have) gets no credentials. Enter them in the editor before you deploy it.
- `OVERWRITE`, and a backup restore that overwrites, keeps a credential the target already has when the connector is the same one (the source, or the destination with the same `metaDataId` and the same name, which no other destination in the file or the channel has; the credential kept is the one stored there now, whatever it was at export), has the same type, and nothing that decides where the credential goes or whose it is has changed: host, port, URL (with an HTTP source's path, an HTTP destination's query parameters and a FHIR destination's resource type), HTTP, FHIR and AMQP headers that are not secrets, brokers and client ID, virtual host, database and vendor, scheme, TLS settings and certificate checks, SFTP host key, user name, auth or SASL type, a Kafka destination's topic, and an AMQP destination's exchange and routing key. Queries, folders, file patterns, polling, timeouts, queue settings and scripts can change. Both the id and the name count because every save from the editor renumbers the destinations by position: one that was renamed, moved or deleted since the export gets no credential.
- When one of those changed, the connector loses all its masked credentials, and you must enter them again before you redeploy. Some connectors refuse to deploy without them. Others deploy: a database connector signs in with an empty password, and an HTTP destination sends without its `Authorization` header. The import's answer does not name the connectors that lost a credential.
- A credential in the file in clear is stored as given. In an HTTP connector's `headers`, `parameters`, `basicAuth` or `auth`, or the `headers` of a FHIR or AMQP connector, it also counts as a change, so the connector's other masked credentials are dropped.

Settings are compared as saved. One that is missing on one side counts as changed, and a `${name}` is compared as text, so a channel whose hosts and user names are configuration map references keeps its credentials on every server it is promoted to.

A `${name}` that a message fills is compared as text too. A URL, query parameter, `Host` header, Kafka topic, or AMQP exchange, routing key or header that holds one is unchanged to an import whose scripts give it another value, so such a file can send the credential somewhere else. It gains the importer nothing: importing over a channel needs `channels:write` on it, which also shows its credentials, and a restore needs `system:restore`, which already replaces every channel's code.

The settings that may change for each connector type are in `packages/server/src/lib/stored-credentials.ts` (D-335).

## Deploy it

Use `redeploy`. It deploys a channel that isn't deployed and applies the saved configuration to one that is, keeping its running or paused state. A plain `deploy` returns 409 for a channel that is already deployed.

```bash
curl -sS --fail-with-body -X POST "$GALVANIGRAPH_URL/api/v1/channels/$CHANNEL_ID/redeploy" \
  -H "Authorization: Bearer $GALVANIGRAPH_TOKEN"
```

The call returns once the channel is in its final state: the state it was in before, or its initial state if it wasn't deployed. `data.state` holds that state. If a script doesn't compile, or the channel should start and can't (a port in use, an unreachable host), the call returns an error status and the job fails. You don't need to poll. `GET /api/v1/channels/$CHANNEL_ID/status` returns the current state if you want to print it.
