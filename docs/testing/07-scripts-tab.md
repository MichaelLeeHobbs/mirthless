# 07 — Scripts Tab

## Prerequisites
- Logged in as admin
- At least one channel created

| # | Scenario | Steps | Expected | Pass? |
|---|---|---|---|---|
| 1 | Tab loads | Go to Scripts tab | 4 accordion sections visible: Deploy, Undeploy, Preprocessor, Postprocessor | |
| 2 | Expand deploy | Click Deploy Script accordion | Monaco editor appears with ~250px height | |
| 3 | Edit deploy script | Type `// deploy code` | Text appears in editor | |
| 4 | Expand undeploy | Click Undeploy Script accordion | Another editor appears | |
| 5 | Edit undeploy script | Type `logger.info('undeployed')` | Text appears | |
| 6 | Expand preprocessor | Click Preprocessor accordion | Editor appears | |
| 7 | Edit preprocessor | Type `var msg = connectorMessage.getRawData();` | Text appears | |
| 8 | Expand postprocessor | Click Postprocessor accordion | Editor appears | |
| 9 | Edit postprocessor | Type `return;` | Text appears | |
| 10 | Save scripts | Click Save | No errors, success message shown | |
| 11 | Reload persists | Reload page, go to Scripts tab | All 4 scripts contain saved values | |
| 12 | Empty scripts | Clear all editors, save, reload | All editors empty (empty string) | |
| 13 | Editor theme | Observe editor | Dark theme (vs-dark) | |
| 14 | Syntax highlighting | Type `function foo() { return 1; }` | JavaScript syntax highlighted | |
| 15 | Multiple open | Expand all 4 accordions | All editors visible simultaneously | |
