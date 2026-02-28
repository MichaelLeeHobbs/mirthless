# 04 — Channel Source Tab (General)

> Connector type switching, unsupported connector behavior, and response settings.
>
> For connector-specific form tests, see:
> - [04a-source-tcp-mllp.md](./04a-source-tcp-mllp.md)
> - [04b-source-http.md](./04b-source-http.md)

## Connector Type Switching

| #    | Scenario                          | Steps                                                      | Expected                                                            | Result | Notes |
|------|-----------------------------------|------------------------------------------------------------|---------------------------------------------------------------------|--------|-------|
| 4.1  | Type change resets properties     | Configure TCP/MLLP settings, switch to HTTP on Summary tab | Source tab shows HTTP form with HTTP defaults, TCP/MLLP values gone | pass   |       |
| 4.2  | Unsupported connector placeholder | Change to FILE connector on Summary tab, go to Source tab  | Shows "FILE connector settings are not yet available" message       | pass   |       |
| 4.3  | Type change marks form dirty      | Switch connector type                                      | Save button becomes enabled                                         | pass   |       |

## Response Settings

| #    | Scenario               | Steps                              | Expected                                                                                              | Result | Notes |
|------|------------------------|------------------------------------|-------------------------------------------------------------------------------------------------------|--------|-------|
| 4.4  | Response mode dropdown | On Source tab, click Response Mode | Shows: NONE, AUTO_BEFORE, AUTO_AFTER_TRANSFORMER, AUTO_AFTER_DESTINATIONS, POSTPROCESSOR, DESTINATION | pass   |       |
| 4.5  | Response mode persists | Change to NONE, save, reload       | Value persists as NONE                                                                                | pass   |       |
| 4.6  | Default response mode  | Create new channel                 | Response mode defaults to AUTO_AFTER_DESTINATIONS                                                     | pass   |       |
