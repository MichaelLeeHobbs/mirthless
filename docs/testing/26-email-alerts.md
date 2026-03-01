# 26 — Email Alerts

## Prerequisites
- Logged in as admin
- At least one channel deployed with an alert configured (EMAIL action)
- SMTP settings configured via Settings page (smtp tab)

## SMTP Settings Configuration

| # | Scenario | Steps | Expected | Pass? |
|---|---|---|---|---|
| 1 | SMTP tab visible in Settings | Navigate to Settings page | 'Smtp' tab appears alongside General, Security, Features | |
| 2 | SMTP host setting editable | Click Smtp tab, enter SMTP host | Field accepts text input, Save enabled | |
| 3 | SMTP port setting editable | Enter port number (e.g. 587) | Field accepts numeric input | |
| 4 | SMTP secure toggle works | Toggle secure boolean switch | Switch toggles between Enabled/Disabled | |
| 5 | SMTP from address editable | Enter sender email address | Field accepts text input | |
| 6 | SMTP auth_user editable | Enter authentication username | Field accepts text input | |
| 7 | SMTP auth_pass masked | View smtp.auth_pass field | Input type is password (dots, not plain text) | |
| 8 | Save SMTP settings | Configure all fields, click Save | Success message, settings persisted | |

## Email Service

| # | Scenario | Steps | Expected | Pass? |
|---|---|---|---|---|
| 9 | Email sent on alert trigger | Configure SMTP + alert with EMAIL action, trigger channel error | Email received at configured recipient(s) | |
| 10 | Multiple recipients | Set alert EMAIL action with multiple recipients | All recipients receive the email | |
| 11 | Email not sent when SMTP host empty | Leave smtp.host blank, trigger alert | Warning logged: "SMTP host is not configured", no email sent | |
| 12 | Alert template substitution | Configure alert body with ${channelId}, ${errorMessage} | Email body contains actual channel ID and error message | |
