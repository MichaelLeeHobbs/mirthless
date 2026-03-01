# 21 — SMTP Connector

## Prerequisites
- Logged in as admin or deployer
- At least one channel created
- SMTP server accessible (or use a test mail server like MailHog)

## SMTP Destination Connector Form

| # | Scenario | Steps | Expected | Pass? |
|---|---|---|---|---|
| 1 | Add SMTP destination | Destinations tab, add destination, change type to SMTP | SMTP destination form appears with host, port, TLS, auth, from/to/cc/bcc, subject, body, content type, attach content | |
| 2 | Default values populated | Select SMTP connector type | host empty, port=587, secure=false, authUser empty, authPass empty, from empty, to empty, cc empty, bcc empty, subject empty, bodyTemplate="${msg}", contentType="text/plain", attachContent=false | |
| 3 | Set SMTP host | Type `smtp.example.com` | Value updates | |
| 4 | Set SMTP port | Enter 465 | Value updates | |
| 5 | Toggle TLS/secure | Toggle on | Switch turns on | |
| 6 | Set auth username | Type `user@example.com` | Value updates | |
| 7 | Set auth password | Type password | Value masked with dots, value updates | |
| 8 | Set from address | Type `noreply@example.com` | Value updates | |
| 9 | Set to recipients | Type `admin@example.com, ops@example.com` | Value updates | |
| 10 | Set CC recipients | Type `cc@example.com` | Value updates | |
| 11 | Set BCC recipients | Type `bcc@example.com` | Value updates | |
| 12 | Set subject | Type `Alert: ${channelId}` | Value updates | |
| 13 | Set body template | Type `Message content: ${msg}` | Value updates | |
| 14 | Change content type to HTML | Select text/html | Dropdown updates | |
| 15 | Toggle attach content | Toggle on | Switch turns on | |
| 16 | Save SMTP settings | Save channel, reload | All SMTP destination settings persisted | |

## SMTP Destination Connector Runtime

| # | Scenario | Steps | Expected | Pass? |
|---|---|---|---|---|
| 17 | Successful email send | Deploy channel, send message through SMTP destination | Email sent, response content contains messageId and accepted/rejected counts | |
| 18 | Template substitution in subject | Subject: `Alert for ${channelId}`, send message | Subject contains actual channel ID | |
| 19 | Template substitution in body | Body: `Content: ${msg}, ID: ${messageId}` | Body contains message content and message ID | |
| 20 | HTML content type | contentType=text/html, body contains HTML tags | Email sent with HTML body (not text body) | |
| 21 | Plain text content type | contentType=text/plain | Email sent with text body | |
| 22 | Attach message content | attachContent=true | Email includes attachment named "message.txt" with message content | |
| 23 | Multiple recipients | to=`a@x.com, b@x.com` | Email delivered to all recipients | |
| 24 | CC and BCC populated | cc and bcc fields set | Email includes CC and BCC headers | |
| 25 | Missing host rejected on deploy | Host empty, deploy channel | Deploy fails with "SMTP host is required" | |
| 26 | Missing from rejected on deploy | From empty, deploy channel | Deploy fails with "From address is required" | |
| 27 | Missing to rejected on deploy | To empty, deploy channel | Deploy fails with "To address is required" | |
| 28 | Invalid port rejected on deploy | Port=0 or port=70000, deploy channel | Deploy fails with "Port must be between 1 and 65535" | |
| 29 | Connection failure | Configure unreachable SMTP host | Error status returned, message marked ERROR | |
| 30 | Transport closed after send | Send message | Transport close() called after sendMail completes (success or error) | |
