# 06b — HTTP Destination Form

## Prerequisites
- On Destinations tab with an HTTP destination selected

| # | Scenario | Steps | Expected | Pass? |
|---|---|---|---|---|
| 1 | Default values | Add destination, switch to HTTP | URL: http://localhost:8080, Method: POST, Content Type: text/plain, Charset: UTF-8, Response Timeout: 30000 | |
| 2 | URL | Change to "https://api.example.com/hl7" | Value updates | |
| 3 | Method | Change to PUT | Dropdown updates | |
| 4 | All methods available | Open method dropdown | GET, POST, PUT, DELETE, PATCH shown | |
| 5 | Content Type | Change to "application/json" | Value updates | |
| 6 | Headers | Enter "Authorization: Bearer token123" | Multiline field accepts value | |
| 7 | Response Timeout | Change to 60000 | Value updates | |
| 8 | Response Timeout zero | Set to 0 | Accepted (means no timeout) | |
| 9 | Charset selection | Change to US-ASCII | Dropdown updates | |
