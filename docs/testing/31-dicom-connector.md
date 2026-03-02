# 31 — DICOM Connector

## Prerequisites
- Server running with `pnpm dev`
- Web UI accessible at http://localhost:5173
- Logged in as admin

## Source Form

| # | Scenario | Steps | Expected | Pass? |
|---|---|---|---|---|
| 1 | Source form renders with defaults | Create channel, select DICOM source type | Port=4242, AE Title=MIRTHLESS, dispatchMode=PER_FILE, postAction=DELETE | |
| 2 | Port field accepts valid values | Enter 11112 in Port | Value updates to 11112 | |
| 3 | AE Title max 16 characters | Type more than 16 characters | Input limited to 16 characters | |
| 4 | Storage directory field editable | Enter /data/dicom/received | Value updates correctly | |
| 5 | Min pool size field | Enter 4 | Value updates to 4 | |
| 6 | Max pool size field | Enter 20 | Value updates to 20 | |
| 7 | Connection timeout field | Enter 15000 | Value updates to 15000 | |
| 8 | Dispatch mode selector | Select Per Association | Value changes to PER_ASSOCIATION | |
| 9 | Post action selector shows 3 options | Click post action dropdown | Delete, Move, None visible | |
| 10 | Move-To Directory appears when postAction=MOVE | Select Move for post action | Move-To Directory field appears | |
| 11 | Move-To Directory hidden when postAction=DELETE | Select Delete for post action | Move-To Directory field hidden | |
| 12 | Move-To Directory hidden when postAction=NONE | Select None for post action | Move-To Directory field hidden | |
| 13 | Move-To Directory editable | Select MOVE, enter /data/processed | Value updates correctly | |

## Destination Form

| # | Scenario | Steps | Expected | Pass? |
|---|---|---|---|---|
| 14 | Destination form renders with defaults | Add DICOM destination | Host=localhost, Port=104, CalledAE=PACS, CallingAE=MIRTHLESS, mode=multiple | |
| 15 | Host field editable | Enter 192.168.1.100 | Value updates | |
| 16 | Port field accepts valid values | Enter 4242 | Value updates to 4242 | |
| 17 | Called AE Title max 16 characters | Type more than 16 chars | Input limited to 16 | |
| 18 | Calling AE Title max 16 characters | Type more than 16 chars | Input limited to 16 | |
| 19 | Mode selector shows 2 options | Click mode dropdown | Single and Multiple visible | |
| 20 | Max Associations appears in multiple mode | Select Multiple | Max Associations field visible | |
| 21 | Max Associations hidden in single mode | Select Single | Max Associations field hidden | |
| 22 | Timeout field editable | Enter 60000 | Value updates to 60000 | |
| 23 | Max retries field editable | Enter 5 | Value updates to 5 | |
| 24 | Retry delay field editable | Enter 2000 | Value updates to 2000 | |

## Persistence

| # | Scenario | Steps | Expected | Pass? |
|---|---|---|---|---|
| 25 | Save DICOM source settings | Configure source fields, save channel | Save succeeds (200/201) | |
| 26 | Reload preserves DICOM source settings | Save channel, navigate away, return | All source settings preserved | |
| 27 | Save DICOM destination settings | Configure destination fields, save channel | Save succeeds | |
| 28 | Reload preserves DICOM destination settings | Save channel, navigate away, return | All destination settings preserved | |
| 29 | Clone preserves DICOM source config | Clone channel with DICOM source | Cloned channel has same source settings | |
| 30 | Clone preserves DICOM destination config | Clone channel with DICOM destination | Cloned channel has same destination settings | |

## Channel Creation

| # | Scenario | Steps | Expected | Pass? |
|---|---|---|---|---|
| 31 | Create channel with DICOM source | New channel → source type=DICOM → fill port+storageDir → save | Channel created with DICOM source | |
| 32 | Create channel with DICOM destination | New channel → add DICOM destination → fill host+port → save | Channel created with DICOM destination | |
| 33 | Create channel with DICOM source and destination | DICOM source + DICOM destination on same channel | Both connectors saved | |

## Deploy Validation

| # | Scenario | Steps | Expected | Pass? |
|---|---|---|---|---|
| 34 | Deploy succeeds with valid DICOM source | Set port=4242, storageDir=/data/dicom, deploy | Deploy succeeds | |
| 35 | Deploy fails with missing port | Remove port from DICOM source properties, deploy | Validation error mentioning port | |
| 36 | Deploy fails with missing storageDir | Set empty storageDir, deploy | Validation error mentioning storageDir | |
| 37 | Deploy succeeds with valid DICOM destination | Set host=localhost, port=104, deploy | Deploy succeeds | |
| 38 | Deploy fails with missing host | Remove host from DICOM dest properties, deploy | Validation error mentioning host | |
| 39 | Deploy fails with invalid port | Set port=0 on DICOM dest, deploy | Validation error mentioning port | |

## Export/Import

| # | Scenario | Steps | Expected | Pass? |
|---|---|---|---|---|
| 40 | Export channel with DICOM connectors | Create channel with DICOM source+dest, export | JSON includes DICOM connector properties | |
| 41 | Import channel with DICOM connectors | Import the exported JSON | Channel created with DICOM settings intact | |

## Connector Type Switching

| # | Scenario | Steps | Expected | Pass? |
|---|---|---|---|---|
| 42 | Switch source from TCP/MLLP to DICOM | Create channel with TCP/MLLP source, switch to DICOM | DICOM defaults populate, TCP fields gone | |
| 43 | Switch source from DICOM to HTTP | Create channel with DICOM source, switch to HTTP | HTTP defaults populate, DICOM fields gone | |
| 44 | Switch destination from FHIR to DICOM | FHIR destination, switch to DICOM | DICOM defaults populate, FHIR fields gone | |
| 45 | Switch destination from DICOM to TCP/MLLP | DICOM destination, switch to TCP/MLLP | TCP defaults populate, DICOM fields gone | |
