# 08 — Advanced Tab

## Prerequisites
- Logged in as admin
- At least one channel created

## Message Storage

| # | Scenario | Steps | Expected | Pass? |
|---|---|---|---|---|
| 1 | Default storage mode | Go to Advanced tab | DEVELOPMENT selected | |
| 2 | Change to Production | Select PRODUCTION radio | Radio updates | |
| 3 | All modes available | View radio group | DEVELOPMENT, PRODUCTION, RAW, METADATA, DISABLED shown | |
| 4 | Encrypt data | Toggle on | Switch turns on | |
| 5 | Remove content on completion | Toggle on | Switch turns on | |
| 6 | Remove attachments on completion | Toggle on | Switch turns on | |
| 7 | Save storage settings | Save, reload, go to Advanced | Settings persisted | |

## Pruning

| # | Scenario | Steps | Expected | Pass? |
|---|---|---|---|---|
| 8 | Pruning disabled by default | Go to Advanced tab | Pruning switch is off, no sub-fields shown | |
| 9 | Enable pruning | Toggle pruning on | Max age and archive fields appear | |
| 10 | Set max age | Enter 30 | Value updates | |
| 11 | Enable archive | Toggle archive on | Switch turns on | |
| 12 | Disable pruning hides fields | Toggle pruning off | Max age and archive fields hidden | |
| 13 | Save pruning | Enable pruning, set 60 days, enable archive, save | Settings persisted after reload | |

## Custom Metadata Columns

| # | Scenario | Steps | Expected | Pass? |
|---|---|---|---|---|
| 14 | Empty state | Go to Advanced tab | "No custom metadata columns" message, + button | |
| 15 | Add column | Click + | New row with empty name, STRING type, empty mapping | |
| 16 | Set column name | Type "PatientId" | Value updates in table | |
| 17 | Change data type | Select TIMESTAMP | Dropdown updates | |
| 18 | All data types | Open dropdown | STRING, NUMBER, BOOLEAN, TIMESTAMP shown | |
| 19 | Set mapping expression | Type `msg['PID']['PID.3']` | Value updates | |
| 20 | Add second column | Click + | Second row appears | |
| 21 | Remove column | Click delete on first row | Row removed | |
| 22 | Save metadata columns | Add 2 columns, fill names, save | Columns persist after reload | |
| 23 | Empty name filtered | Add column with empty name, save | Empty-name columns not sent to server | |
