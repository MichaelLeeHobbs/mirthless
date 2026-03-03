# 43 — Monaco Sandbox TypeScript Definitions Manual Test Checklist

## IntelliSense in Script Editors
- [ ] Channel Scripts tab: typing `msg.` shows autocomplete
- [ ] Channel Scripts tab: typing `logger.` shows info/warn/error/debug
- [ ] Filter Rule editor (JavaScript): `parseHL7(` shows signature
- [ ] Transformer Step editor (JavaScript): `channelMap.` autocompletes
- [ ] Code Template editor: `createACK(` shows parameters
- [ ] Global Scripts page: `tmp.` autocompletes as Record
- [ ] All editors show `sourceMap`, `connectorMap`, `responseMap`, `globalChannelMap`

## ScriptEditor Wrapper
- [ ] All 5 editor locations use ScriptEditor component
- [ ] Editor renders in vs-dark theme
- [ ] Editor supports JavaScript language
- [ ] Editor options: no minimap, line numbers on, word wrap on
- [ ] Typing produces onChange callbacks
- [ ] Editor heights match original (250px, 200px, 100%)

## Type Definition Content
- [ ] Hl7MessageProxy interface includes get, set, delete, toString
- [ ] Hl7MessageProxy includes messageType, messageControlId
- [ ] Hl7MessageProxy includes getSegmentCount, getSegmentString
- [ ] SandboxLogger interface with info/warn/error/debug
- [ ] parseHL7 function declaration with correct signature
- [ ] createACK function declaration with 3 params
- [ ] All 9 global variables declared
