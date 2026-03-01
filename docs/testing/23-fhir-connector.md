# 23 — FHIR Connector

## Prerequisites
- Logged in as admin or deployer
- At least one channel created
- FHIR R4 server accessible (or use a test FHIR server like HAPI FHIR)

## FHIR Destination Connector Form

| # | Scenario | Steps | Expected | Pass? |
|---|---|---|---|---|
| 1 | Add FHIR destination | Destinations tab, add destination, change type to FHIR | FHIR destination form appears with Base URL, Resource Type, Method, Auth, Format | |
| 2 | Default values populated | Select FHIR connector type | baseUrl empty, resourceType="Patient", method="POST", authType="NONE", authUsername empty, authPassword empty, authToken empty, authHeaderName empty, authApiKey empty, format="json", timeout=30000, headers empty | |
| 3 | Set base URL | Type `https://fhir.example.com/r4` | Value updates | |
| 4 | Change resource type | Select or type `Observation` | Value updates | |
| 5 | Change method to PUT | Select PUT | Dropdown updates | |
| 6 | Change auth type to BASIC | Select BASIC | Username and Password fields appear | |
| 7 | Set basic auth username | Type `admin` | Value updates | |
| 8 | Set basic auth password | Type password | Value masked with dots, value updates | |
| 9 | Change auth type to BEARER | Select BEARER | Token field appears | |
| 10 | Set bearer token | Type `eyJhbGci...` | Value updates | |
| 11 | Change auth type to API_KEY | Select API_KEY | Header Name and API Key fields appear | |
| 12 | Set API key header name | Type `X-API-Key` | Value updates | |
| 13 | Set API key value | Type `my-secret-key` | Value updates | |
| 14 | Change auth type to NONE | Select NONE | Auth fields hidden | |
| 15 | Change format to XML | Select xml | Dropdown updates | |
| 16 | Set custom timeout | Enter 60000 | Value updates | |
| 17 | Save FHIR settings | Save channel, reload | All FHIR destination settings persisted | |

## FHIR Destination Connector Runtime

| # | Scenario | Steps | Expected | Pass? |
|---|---|---|---|---|
| 18 | POST resource (JSON) | Deploy channel, send FHIR Patient JSON | POST to baseUrl/Patient, Content-Type: application/fhir+json, status SENT with response body | |
| 19 | PUT resource | method=PUT, send FHIR resource | PUT request sent to baseUrl/resourceType | |
| 20 | JSON format headers | format=json | Content-Type and Accept set to application/fhir+json | |
| 21 | XML format headers | format=xml | Content-Type and Accept set to application/fhir+xml | |
| 22 | Basic auth header | authType=BASIC, username/password set | Authorization header contains "Basic base64(user:pass)" | |
| 23 | Bearer auth header | authType=BEARER, token set | Authorization header contains "Bearer token" | |
| 24 | API key auth header | authType=API_KEY, headerName=X-API-Key, apiKey=secret | Custom header X-API-Key set to "secret" | |
| 25 | No auth header | authType=NONE | No Authorization header sent | |
| 26 | Server returns 201 Created | FHIR server accepts resource | Response status SENT with server response body | |
| 27 | Server returns 400 Bad Request | Send invalid FHIR resource | Response status ERROR with "FHIR 400: Bad Request" error message | |
| 28 | Server returns 500 Internal Server Error | FHIR server error | Response status ERROR with "FHIR 500: Internal Server Error" message | |
| 29 | Connection failure | Configure unreachable base URL | Error returned, message marked ERROR | |
| 30 | Missing base URL rejected on deploy | baseUrl empty, deploy channel | Deploy fails with "FHIR base URL is required" | |
| 31 | Invalid base URL rejected on deploy | baseUrl="not-a-url", deploy | Deploy fails with "Invalid base URL" error | |
| 32 | Missing resource type rejected on deploy | resourceType empty, deploy channel | Deploy fails with "FHIR resource type is required" | |
| 33 | Missing basic auth credentials rejected | authType=BASIC, username or password empty, deploy | Deploy fails with "Basic auth requires username and password" | |
| 34 | Missing bearer token rejected | authType=BEARER, token empty, deploy | Deploy fails with "Bearer auth requires a token" | |
| 35 | Missing API key fields rejected | authType=API_KEY, headerName or apiKey empty, deploy | Deploy fails with "API key auth requires headerName and apiKey" | |
| 36 | URL construction | baseUrl=`https://fhir.example.com/r4/`, resourceType=Patient | Request sent to `https://fhir.example.com/r4/Patient` (trailing slash handled) | |
| 37 | Timeout enforcement | Set timeout=1000, FHIR server delays >1s | Request aborted, error returned | |
