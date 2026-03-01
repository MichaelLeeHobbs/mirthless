# 22 — Channel Connector

## Prerequisites
- Logged in as admin or deployer
- At least two channels created (one as source, one as routing target)

## Channel Source Connector Form

| # | Scenario | Steps | Expected | Pass? |
|---|---|---|---|---|
| 1 | Select Channel source type | Edit channel, Source tab, change connector to CHANNEL | Channel source form appears (channelId auto-populated) | |
| 2 | Default values populated | Select CHANNEL connector type | channelId set to current channel's ID | |
| 3 | Save Channel source settings | Save channel, reload | Channel source settings persisted | |

## Channel Destination Connector Form

| # | Scenario | Steps | Expected | Pass? |
|---|---|---|---|---|
| 4 | Add Channel destination | Destinations tab, add destination, change type to CHANNEL | Channel destination form appears with Target Channel and Wait For Response | |
| 5 | Default values populated | Select CHANNEL connector type | targetChannelId empty, waitForResponse=false | |
| 6 | Set target channel | Select or enter target channel ID | Value updates | |
| 7 | Toggle waitForResponse | Toggle on | Switch turns on | |
| 8 | Save Channel destination settings | Save channel, reload | targetChannelId and waitForResponse persisted | |

## Channel Source Connector Runtime

| # | Scenario | Steps | Expected | Pass? |
|---|---|---|---|---|
| 9 | Registration on start | Deploy and start channel with CHANNEL source | Channel registered in static registry (hasChannel returns true) | |
| 10 | Unregistration on stop | Stop channel with CHANNEL source | Channel removed from registry (hasChannel returns false) | |
| 11 | Unregistration on halt | Halt channel with CHANNEL source | Channel removed from registry | |
| 12 | Unregistration on undeploy | Undeploy channel with CHANNEL source | Channel removed from registry, dispatcher cleared | |
| 13 | Receive message from another channel | Channel A sends to Channel B via CHANNEL destination | Channel B source receives the message content | |
| 14 | Missing channelId rejected on deploy | channelId empty, deploy channel | Deploy fails with "Channel ID is required" | |
| 15 | Dispatcher not set rejected on start | Start without calling setDispatcher | Start fails with "Dispatcher not set" error | |

## Channel Destination Connector Runtime

| # | Scenario | Steps | Expected | Pass? |
|---|---|---|---|---|
| 16 | Route message to target channel | Deploy Channel A (CHANNEL dest) and Channel B (CHANNEL source), send message through A | Message dispatched to Channel B, status SENT | |
| 17 | Response contains messageId | waitForResponse=false, send message | Response content contains "messageId=..." | |
| 18 | waitForResponse returns response | waitForResponse=true, target channel returns response | Response content contains the target channel's response value | |
| 19 | Target channel not deployed | targetChannelId points to undeployed channel | Response status ERROR with "not deployed or not registered" message | |
| 20 | Target channel not found | targetChannelId is an invalid UUID | Response status ERROR with "not deployed or not registered" message | |
| 21 | sourceMap populated on target | Send message from Channel A to Channel B | Target channel receives sourceMap with connectorType="CHANNEL", sourceChannelId, sourceMessageId, sourceMetaDataId | |
| 22 | Missing targetChannelId rejected on deploy | targetChannelId empty, deploy channel | Deploy fails with "Target channel ID is required" | |
| 23 | Send aborted | Send with already-aborted AbortSignal | Error: "Send aborted" | |

## Channel Registry

| # | Scenario | Steps | Expected | Pass? |
|---|---|---|---|---|
| 24 | Multiple channels registered | Start three channels with CHANNEL source | All three registered, getRegisteredChannelIds returns all three | |
| 25 | Re-registration replaces callback | Stop and restart channel | New callback replaces old one in registry | |
| 26 | Clear registry | Call clearChannelRegistry | All registrations removed | |
