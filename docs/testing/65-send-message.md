# 65 — Send Message Dialog

> Send a raw message to a channel for testing/troubleshooting purposes.

## Prerequisites
- Server running (`pnpm dev:server`)
- Web UI running (`pnpm dev:web`)
- Authenticated as admin user
- At least one channel deployed and started

## Send Message Dialog

| #    | Scenario                          | Steps                                                           | Expected                                                            | Result | Notes |
|------|-----------------------------------|-----------------------------------------------------------------|---------------------------------------------------------------------|--------|-------|
| 65.1 | Dialog opens from context menu    | Right-click a started channel, select "Send Message"            | Send Message dialog opens                                           |        |       |
| 65.2 | Monaco editor visible             | Open Send Message dialog                                        | Dialog contains Monaco editor for message input                     |        |       |
| 65.3 | Send succeeds                     | Enter valid message content, click Send                         | Dialog closes, success toast displayed                              |        |       |
| 65.4 | Message appears in browser        | After successful send, navigate to Message Browser for channel  | Sent message appears in the message list                            |        |       |
| 65.5 | Send to stopped channel           | Attempt to send message to a STOPPED channel                    | Error notification displayed (channel not accepting messages)       |        |       |
| 65.6 | Send to undeployed channel        | Attempt to send message to an UNDEPLOYED channel                | Error notification displayed (channel not deployed)                 |        |       |
| 65.7 | Send empty message                | Open dialog, leave editor empty, click Send                     | Validation error prevents send (empty message not allowed)          |        |       |
| 65.8 | Dialog closes after success       | Send a valid message                                            | Dialog automatically closes after successful send                   |        |       |
| 65.9 | Dialog shows error on failure     | Send message when server returns an error (e.g., network issue) | Error message displayed within dialog or as toast, dialog stays open|        |       |

## Edge Cases

| #     | Scenario                          | Steps                                                           | Expected                                                            | Result | Notes |
|-------|-----------------------------------|-----------------------------------------------------------------|---------------------------------------------------------------------|--------|-------|
| 65.10 | Large message                     | Paste a large message (>1MB) into editor, click Send            | Message sends or clear error if size limit exceeded                 |        |       |
| 65.11 | Special characters                | Send message with unicode, newlines, and special chars          | Message content preserved exactly as entered                        |        |       |
| 65.12 | Cancel/close without sending      | Open dialog, type content, click Cancel or close (X)            | Dialog closes, no message sent, no notification                     |        |       |
