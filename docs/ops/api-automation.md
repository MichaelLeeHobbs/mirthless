# Scripting the REST API

GalvaniFlow has no command-line client (D-280). Scripts and CI jobs call the REST API directly. The full API is described at `/api-docs` on a running server. These recipes cover the usual pipeline: export a channel, commit it, then import and deploy it on another server.

Every response has the shape `{ "success": true, "data": ... }` or `{ "success": false, "error": { "code", "message" } }`, and a failure has a non-2xx status. Use `curl --fail-with-body` so a failed call fails the script and still prints the error.

## Get a token

Until API tokens land (#144), a script logs in with a username and password. The token lasts 15 minutes by default (`JWT_ACCESS_EXPIRES_IN`). This stops working for an account that has MFA, so use a dedicated automation account with the narrowest role that does the job (`deployer` to import and deploy).

```bash
export GALVANIFLOW_URL=https://galvaniflow.example.org
export GALVANIFLOW_TOKEN=$(curl -sS --fail-with-body "$GALVANIFLOW_URL/api/v1/auth/login" \
  -H 'Content-Type: application/json' \
  -d "{\"username\":\"$GF_USER\",\"password\":\"$GF_PASSWORD\"}" | jq -r '.data.accessToken')
```

## Export a channel

```bash
curl -sS --fail-with-body "$GALVANIFLOW_URL/api/v1/channels/$CHANNEL_ID/export" \
  -H "Authorization: Bearer $GALVANIFLOW_TOKEN" | jq '.data' > channels/my-channel.json
```

`GET /api/v1/channels/export` exports every channel in the same format.

## Import it on another server

The import body is the exported file plus `collisionMode`: `OVERWRITE` replaces a channel with the same ID, `SKIP` leaves it, `CREATE_NEW` imports a copy.

```bash
jq '. + {collisionMode: "OVERWRITE"}' channels/my-channel.json | \
  curl -sS --fail-with-body "$GALVANIFLOW_URL/api/v1/channels/import" \
    -H "Authorization: Bearer $GALVANIFLOW_TOKEN" \
    -H 'Content-Type: application/json' --data-binary @-
```

## Deploy it

Use `redeploy`. It deploys a channel that isn't deployed and applies the saved configuration to one that is, keeping its running or paused state. A plain `deploy` returns 409 for a channel that is already deployed.

```bash
curl -sS --fail-with-body -X POST "$GALVANIFLOW_URL/api/v1/channels/$CHANNEL_ID/redeploy" \
  -H "Authorization: Bearer $GALVANIFLOW_TOKEN"
```

The call returns once the channel is in its final state: the state it was in before, or its initial state if it wasn't deployed. `data.state` holds that state. If a script doesn't compile, or the channel should start and can't (a port in use, an unreachable host), the call returns an error status and the job fails. You don't need to poll. `GET /api/v1/channels/$CHANNEL_ID/status` returns the current state if you want to print it.
