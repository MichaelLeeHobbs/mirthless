# Manual Test: Message Storage Policies

## Prerequisites
- Server running (`pnpm dev:server`)
- Web UI running (`pnpm dev:web`)
- PostgreSQL running with migrated schema
- Admin user logged in
- At least one channel created with TCP/MLLP source

---

## 1. sourceMap Persistence

- [ ] 1.1 Send HL7 message to TCP/MLLP channel, open message in Message Browser, verify Maps accordion shows sourceMap with remoteAddress
- [ ] 1.2 Send HTTP message, verify sourceMap includes request headers and remote address
- [ ] 1.3 Send message that gets filtered, verify sourceMap is still present in message detail
- [ ] 1.4 Verify sourceMap displays as formatted JSON in ContentViewer

## 2. DEVELOPMENT Storage Mode (Default)

- [ ] 2.1 Create channel with DEVELOPMENT storage mode (default)
- [ ] 2.2 Deploy and send a message
- [ ] 2.3 Verify raw content visible in message detail
- [ ] 2.4 Verify transformed content visible (if transformer configured)
- [ ] 2.5 Verify sent content visible for each destination
- [ ] 2.6 Verify response content visible for each destination
- [ ] 2.7 Verify sourceMap visible in Maps accordion
- [ ] 2.8 Verify error content visible when destination errors

## 3. PRODUCTION Storage Mode

- [ ] 3.1 Change channel to PRODUCTION storage mode, redeploy
- [ ] 3.2 Send a message successfully
- [ ] 3.3 Verify raw content is NOT visible in message detail
- [ ] 3.4 Verify transformed/sent/response content is NOT visible
- [ ] 3.5 Verify connector status (SENT) is still tracked
- [ ] 3.6 Verify statistics still increment (received, sent counters)
- [ ] 3.7 Force a destination error, verify error content IS stored

## 4. RAW Storage Mode

- [ ] 4.1 Change channel to RAW storage mode, redeploy
- [ ] 4.2 Send a message
- [ ] 4.3 Verify raw content IS visible
- [ ] 4.4 Verify transformed/sent/response content is NOT visible
- [ ] 4.5 Force an error, verify error content IS stored

## 5. METADATA Storage Mode

- [ ] 5.1 Change channel to METADATA storage mode, redeploy
- [ ] 5.2 Send a message
- [ ] 5.3 Verify NO content is visible in message detail
- [ ] 5.4 Verify connector status is still tracked
- [ ] 5.5 Verify statistics still increment

## 6. DISABLED Storage Mode

- [ ] 6.1 Change channel to DISABLED storage mode, redeploy
- [ ] 6.2 Send a message
- [ ] 6.3 Verify NO content is visible in message detail
- [ ] 6.4 Verify connector status and statistics still work

## 7. Remove Content on Completion

- [ ] 7.1 Enable removeContentOnCompletion on a DEVELOPMENT mode channel, redeploy
- [ ] 7.2 Send a message, wait for processing to complete
- [ ] 7.3 Verify message detail shows no content (deleted after processed=true)
- [ ] 7.4 Verify statistics were counted before cleanup
- [ ] 7.5 Disable flag, send another message, verify content persists

## 8. Remove Attachments on Completion

- [ ] 8.1 Enable removeAttachmentsOnCompletion on a channel, redeploy
- [ ] 8.2 Send a message with attachments
- [ ] 8.3 Verify attachments removed after processing completes
- [ ] 8.4 Verify message content itself is NOT affected

## 9. Storage Mode Change on Redeploy

- [ ] 9.1 Start with DEVELOPMENT mode, send 5 messages (all content visible)
- [ ] 9.2 Change to PRODUCTION mode, redeploy
- [ ] 9.3 Send 5 more messages, verify new messages have no content except errors
- [ ] 9.4 Verify old messages still have their original content

## 10. Queue Consumer with Storage Policies

- [ ] 10.1 Configure queued destination with PRODUCTION storage mode
- [ ] 10.2 Send messages that go through queue
- [ ] 10.3 Verify queue processing works regardless of storage mode
- [ ] 10.4 Verify statistics increment for queued messages
