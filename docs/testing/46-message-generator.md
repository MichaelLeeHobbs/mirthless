# 46 — HL7v2 Message Generator

## API Tests

- [ ] `POST /tools/messages` with ADT_A01 generates valid HL7 message
- [ ] `POST /tools/messages` with ORM_O01 generates valid HL7 message
- [ ] `POST /tools/messages` with ORU_R01 generates valid HL7 message
- [ ] `POST /tools/messages` with SIU_S12 generates valid HL7 message
- [ ] Count parameter generates correct number of messages (1-100)
- [ ] Seed parameter produces deterministic output
- [ ] Invalid message type returns validation error
- [ ] Count > 100 returns validation error
- [ ] Requires authentication (401 without token)
- [ ] Requires channels:read permission

## UI Tests

- [ ] Navigate to Tools > Message Generator page
- [ ] Message type dropdown shows all 4 options
- [ ] Count field defaults to 1
- [ ] Seed field is optional
- [ ] Generate button triggers API call
- [ ] Loading spinner shows during generation
- [ ] Generated messages display in Monaco editor (read-only)
- [ ] Copy button copies output to clipboard
- [ ] "Copied!" tooltip appears after copy
- [ ] Error alert shown when generation fails
- [ ] Editor respects dark/light theme
