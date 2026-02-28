# 04b — Source: HTTP Connector

> HTTP listener source connector form tests.
>
> **Prerequisite
**: Channel with Source Connector Type changed to HTTP on the Summary tab.

| #    | Scenario                     | Steps                                                                 | Expected                                                                         | Result | Notes |
|------|------------------------------|-----------------------------------------------------------------------|----------------------------------------------------------------------------------|--------|-------|
| 4b.1 | Default form loads           | Change Source Connector Type to HTTP on Summary tab, go to Source tab | HTTP form displayed with defaults: host `0.0.0.0`, port `8080`, context path `/` |        |       |
| 4b.2 | Host field editable          | Change host to `127.0.0.1`                                            | Field updates                                                                    |        |       |
| 4b.3 | Port field                   | Change port to `9090`                                                 | Field accepts the value                                                          |        |       |
| 4b.4 | Context path field           | Change to `/api/messages`                                             | Field accepts the value                                                          |        |       |
| 4b.5 | Allowed methods multi-select | Click methods field, select GET and POST                              | Both methods shown as chips                                                      |        |       |
| 4b.6 | Response status code         | Change to `202`                                                       | Field accepts the value                                                          |        |       |
| 4b.7 | Response content type        | Change to `application/json`                                          | Field updates                                                                    |        |       |
| 4b.8 | Settings persist on save     | Modify several fields, save, reload page                              | All HTTP settings preserved exactly                                              |        |       |
