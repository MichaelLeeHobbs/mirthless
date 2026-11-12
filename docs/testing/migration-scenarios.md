# Migration scenario suite

Can an operator who runs Mirth Connect in production move their real channels here and run them without workarounds? This suite answers that with a number. Each scenario imports a Mirth Connect 4.5 channel export (or a full server backup), deploys it on a real server with a real Postgres database, sends real messages through real connectors to real partner systems, and checks what arrived.

The score is the weighted share of scenarios that pass. Weight 3 means most production integrations need it, 2 common, 1 occasional. The weights and scenarios are in [`e2e/scenarios/manifest.json`](../../e2e/scenarios/manifest.json).

## Running it

```bash
docker compose -f docker/docker-compose.yml --profile test up -d sftp-test mail-test mysql-test
```

```bash
SCENARIO_DATABASE_URL=postgresql://<user>:<password>@localhost:5432/galvaniflow_scenarios_test pnpm test:scenarios
```

`pnpm test:scenarios` drops and recreates that database (it must end in `_test`), migrates and seeds it, starts its own server on port 3100, runs [`playwright.scenarios.config.ts`](../../playwright.scenarios.config.ts) and prints the score. It writes `tmp/feature-climb/score.json` and the Playwright report `tmp/feature-climb/results.json`. Pass `--no-reset` to keep the database, and extra Playwright arguments after `--`.

## How it is built

- `e2e/scenarios/support/mirth-xml.ts` writes exports in the shape Mirth Connect 4.5 produces. The element names, property classes and nesting follow a real 4.5 server backup. Scripts inside are written the way a Mirth (Rhino) channel writes them: `msg['PID']['PID.5']`, `channelMap.put`, `destinationSet.removeAllExcept`, `ResponseFactory`, `$gc`, `DateUtil`.
- Partner systems are real sockets and servers: MLLP and HTTP sinks in `support/net.ts`, a `partner` schema in the scenario database, and the SFTP, GreenMail and MySQL test containers.
- `harness.scenario.ts` checks each partner helper against a real counterpart and builds one channel natively through this product's API. It is not scored. If it fails, a scenario failure may be a harness fault, so fix the harness before reading the score.

## Rules for changing the suite

The suite is frozen once its baseline is approved. Changing a scenario, its pass condition or its weight resets the baseline. A scenario must not pass because its test was weakened, because a fixture is shaped like something no Mirth server exports, or because a stub stands in for a connector.
