# 29 — Queue Consumer Wiring

## Prerequisites
- Server running with PostgreSQL
- At least one channel with queued destination(s) configured
- Admin or deployer credentials

## Consumer Lifecycle

| # | Scenario | Steps | Expected | Pass? |
|---|---|---|---|---|
| 1 | Queue consumer starts with channel start | Deploy a channel with a queued destination, start it | Queue consumer created and polling for messages | |
| 2 | Queue consumer does NOT start for NEVER queue mode | Deploy a channel with queueMode: NEVER destination, start it | No queue consumer created for that destination | |
| 3 | Queue consumer stops when channel stops | Start a channel with queued destination, then stop it | Queue consumer stops polling | |
| 4 | Queue consumer stops on undeploy | Start a channel with queued destination, then undeploy | Queue consumer stopped and cleaned up | |
| 5 | Queue consumer stops on halt | Start a channel with queued destination, then halt | Queue consumer stopped immediately | |

## Multi-Destination Behavior

| # | Scenario | Steps | Expected | Pass? |
|---|---|---|---|---|
| 6 | Multiple queued destinations get separate consumers | Deploy channel with 3 queued destinations, start | 3 independent queue consumers created | |
| 7 | Mixed queue modes handled correctly | Channel with dest A (ALWAYS), dest B (NEVER), dest C (ON_FAILURE) | Consumers created for A and C only | |

## Consumer Configuration

| # | Scenario | Steps | Expected | Pass? |
|---|---|---|---|---|
| 8 | Queue consumer uses destination-specific retry count | Destination configured with retryCount: 5 | Consumer retries failed messages up to 5 times | |
| 9 | Queue consumer uses destination-specific retry interval | Destination configured with retryIntervalMs: 3000 | Consumer waits 3 seconds between retries | |
| 10 | Queue consumer batch size defaults to 10 | Deploy and start channel with queued destination | Consumer processes up to 10 messages per poll cycle | |
| 11 | Queue consumer poll interval defaults to 1000ms | Deploy and start channel with queued destination | Consumer polls every 1 second | |
