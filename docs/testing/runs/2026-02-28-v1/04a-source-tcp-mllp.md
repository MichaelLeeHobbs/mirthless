# 04a — Source: TCP/MLLP Connector

> TCP/MLLP listener source connector form tests.
>
> **Prerequisite**: Channel with Source Connector Type set to TCP_MLLP (default for new channels).

| #     | Scenario                    | Steps                                                   | Expected                                                                                 | Result | Notes |
|-------|-----------------------------|---------------------------------------------------------|------------------------------------------------------------------------------------------|--------|-------|
| 4a.1  | Default form loads          | Create new channel (default TCP_MLLP), go to Source tab | TCP/MLLP form displayed with defaults: host `0.0.0.0`, port `6661`, max connections `10` | pass   |       |
| 4a.2  | Host field editable         | Change host to `127.0.0.1`                              | Field updates                                                                            | pass   |       |
| 4a.3  | Port field — valid value    | Change port to `2575`                                   | Field accepts the value                                                                  | pass   |       |
| 4a.4  | Port field — min/max        | Try port `0` and `65536`                                | Validation prevents values outside 1-65535                                               | pass   |       |
| 4a.5  | Max connections field       | Change to `20`                                          | Field accepts the value                                                                  | pass   |       |
| 4a.6  | Keep connection open switch | Toggle the switch off and on                            | Switch state changes visually                                                            | pass   |       |
| 4a.7  | Charset dropdown            | Click charset field                                     | Shows: UTF-8, ISO-8859-1, US-ASCII                                                       | pass   |       |
| 4a.8  | Transmission mode dropdown  | Click transmission mode field                           | Shows: MLLP, RAW, DELIMITED                                                              | pass   |       |
| 4a.9  | Receive timeout field       | Set to `30000`                                          | Field accepts the value                                                                  | pass   |       |
| 4a.10 | Buffer size field           | Set to `131072`                                         | Field accepts the value                                                                  | pass   |       |
| 4a.11 | Settings persist on save    | Modify several fields, save, reload page                | All TCP/MLLP settings preserved exactly                                                  | pass   |       |
