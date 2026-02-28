# 06a — TCP/MLLP Destination Form

## Prerequisites
- On Destinations tab with a TCP/MLLP destination selected

| # | Scenario | Steps | Expected | Pass? |
|---|---|---|---|---|
| 1 | Default values | Add new TCP/MLLP destination | Host: localhost, Port: 6661, Send Timeout: 10000, Keep Connection: on, Charset: UTF-8, Mode: MLLP, Buffer: 65536 | |
| 2 | Remote Host | Change to "lab.example.com" | Value updates | |
| 3 | Remote Port | Change to 7777 | Value updates | |
| 4 | Port min | Set to 0 | Input enforces min=1 | |
| 5 | Port max | Set to 99999 | Input enforces max=65535 | |
| 6 | Send Timeout | Change to 30000 | Value updates | |
| 7 | Send Timeout zero | Set to 0 | Accepted (means no timeout) | |
| 8 | Keep Connection Open | Toggle off | Switch turns off | |
| 9 | Charset selection | Change to ISO-8859-1 | Dropdown updates | |
| 10 | Transmission Mode | Change to RAW | Dropdown updates | |
| 11 | Buffer Size | Change to 131072 | Value updates | |
