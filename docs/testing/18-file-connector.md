# 18 — File Connector

## Prerequisites
- Logged in as admin or deployer
- At least one channel created

## File Source Connector Form

| # | Scenario | Steps | Expected | Pass? |
|---|---|---|---|---|
| 1 | Select File source type | Edit channel, Source tab, change connector to FILE | File source form appears with Directory, File Filter, Sort By, Polling Interval | |
| 2 | Default values populated | Select FILE connector type | directory empty, fileFilter=*, pollingIntervalMs=5000, sortBy=NAME, charset=UTF-8, binary=false, checkFileAge=true, fileAgeMs=1000, postAction=DELETE | |
| 3 | Set directory path | Type `/data/inbound` | Value updates | |
| 4 | Set file filter | Type `*.hl7` | Value updates | |
| 5 | Change sort by | Select DATE | Dropdown updates | |
| 6 | Change polling interval | Enter 10000 | Value updates | |
| 7 | Change charset | Select ISO-8859-1 | Dropdown updates | |
| 8 | Toggle binary mode | Toggle on | Switch turns on | |
| 9 | Toggle check file age off | Toggle off | Minimum File Age field disappears | |
| 10 | Toggle check file age on | Toggle on | Minimum File Age field reappears with previous value | |
| 11 | Set file age | Enter 5000 | Value updates | |
| 12 | Change post action to MOVE | Select MOVE | Move-To Directory field appears | |
| 13 | Set move-to directory | Type `/data/processed` | Value updates | |
| 14 | Change post action to NONE | Select NONE | Move-To Directory field disappears | |
| 15 | Change post action to DELETE | Select DELETE | Move-To Directory field hidden | |
| 16 | Save file source settings | Save channel, reload | All file source settings persisted | |

## File Destination Connector Form

| # | Scenario | Steps | Expected | Pass? |
|---|---|---|---|---|
| 17 | Add File destination | Destinations tab, add destination, change type to FILE | File destination form appears | |
| 18 | Default values populated | Select FILE connector type | directory empty, outputPattern=${messageId}.txt, charset=UTF-8, binary=false, tempFileEnabled=true, appendMode=false | |
| 19 | Set output directory | Type `/data/outbound` | Value updates | |
| 20 | Set output pattern | Type `${timestamp}_${messageId}.hl7` | Value updates | |
| 21 | Change charset | Select US-ASCII | Dropdown updates | |
| 22 | Toggle binary mode | Toggle on | Switch turns on | |
| 23 | Toggle temp file off | Toggle off | Switch turns off | |
| 24 | Toggle append mode on | Toggle on | Switch turns on | |
| 25 | Save file destination settings | Save channel, reload | All file destination settings persisted | |

## File Source Connector Runtime

| # | Scenario | Steps | Expected | Pass? |
|---|---|---|---|---|
| 26 | Poll reads files from directory | Deploy channel with FILE source, place .hl7 file in directory | File content dispatched as message | |
| 27 | File filter applies | Place *.txt and *.hl7 files, filter is *.hl7 | Only .hl7 files processed | |
| 28 | File age check works | Place file, check immediately | File skipped if younger than fileAgeMs | |
| 29 | Post-action DELETE | Process file with postAction=DELETE | File removed from source directory | |
| 30 | Post-action MOVE | Process file with postAction=MOVE | File moved to moveToDirectory | |
| 31 | Post-action NONE | Process file with postAction=NONE | File remains in source directory | |
| 32 | Sort by NAME | Place b.hl7 then a.hl7 | a.hl7 processed first | |
| 33 | Sort by DATE | Place old.hl7 then new.hl7 | old.hl7 processed first | |
| 34 | Empty directory | Poll with no files | No messages dispatched, no errors | |
| 35 | Directory does not exist | Configure non-existent path | Error logged, channel stays running | |

## File Destination Connector Runtime

| # | Scenario | Steps | Expected | Pass? |
|---|---|---|---|---|
| 36 | Write message to file | Send message through FILE destination | File created in output directory | |
| 37 | Output pattern substitution | Use ${messageId} in pattern | File named with actual message ID | |
| 38 | Temp file rename | tempFileEnabled=true | .tmp file written, then renamed to final name | |
| 39 | Direct write | tempFileEnabled=false | File written directly (no temp file) | |
| 40 | Append mode | appendMode=true, send two messages | Second message appended to same file | |
| 41 | Directory auto-created | Output directory does not exist | Directory created automatically | |
| 42 | Write error | Output directory read-only | Error status returned, message marked ERROR | |
