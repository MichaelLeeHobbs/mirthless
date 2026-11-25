# Shared data

Named data that every channel's scripts can use, whoever wrote the channel: the global map, the global channel map, the configuration map, collections, data sources and resources. Area code `SHR`. The script functions that reach them belong to Scripting (`SCR`), who may read and change them to Access control (`ACC`), what reading and changing them records to Audit (`AUD`), the passwords stored for them to Security (`SEC`), and what a backup holds to Operations (`OPS`).

## Global map and global channel map (MAP)

| ID | Requirement | Pri | Verify | Status |
|---|---|---|---|---|
| SHR-MAP-01 | When a script ends, the system shall write back to the one global map that all channels share only the keys the script added, changed or removed, so that a key another message changed while the script ran keeps that change. | P1 | Test | Proposed |
| SHR-MAP-02 | The system shall keep every global map entry across an orderly stop and start of the server, with a text value still text and a number, true/false value, list or object still that type. | P1 | Test | Proposed |
| SHR-MAP-03 | After an unexpected stop, the system shall have lost no global map change made more than 10 seconds before the stop, except a change it had already reported in the server log as not yet saved, by its key and without its value. | P1 | Test | Proposed |
| SHR-MAP-04 | When a person adds, changes, deletes or clears global map entries, the system shall give the result to every script that starts afterwards in any running channel, without a redeploy, and shall not let an earlier script's unsaved change to the same key replace it. | P1 | Test | Proposed |
| SHR-MAP-05 | The system shall keep a channel's global channel map from message to message and across a stop and start of that channel, show it to no other channel, and empty it when the channel is undeployed, redeployed or the server restarts. | P1 | Test | Proposed |

- SHR-MAP-01: source: D-214; docs/user/scripting-api.md "Maps". Two scripts that change the same key at the same time: the later write wins, which no source makes a requirement.
- SHR-MAP-02: source: docs/user/capabilities.md "Global map kept across restarts" (Yes); D-214 for the types.
- SHR-MAP-03: source: docs/user/capabilities.md "Global map kept across restarts" (Yes, "changes reach the database every 5 seconds, so a crash can lose the last few seconds"). The 10 seconds is the 5-second interval plus time for the write; the report of a failed save is from code only.
- SHR-MAP-04: source: D-214; the rule about an earlier script's change is from the comments and tests of the global map code (#92).
- SHR-MAP-05: source: docs/user/scripting-api.md "Maps" ("persists across messages within a deployment"); D-191 for Mirth parity; that a stop and start keeps it is from code only.

## Configuration map (CFG)

| ID | Requirement | Pri | Verify | Status |
|---|---|---|---|---|
| SHR-CFG-01 | The system shall give a channel, in its scripts and in the references its connector settings make to configuration map entries, the values as they were when the channel was last deployed or the server last started, so that an edited value reaches a channel at its next deploy or the next server start and not before. | P1 | Test | Proposed |
| SHR-CFG-02 | The system shall not copy global map or configuration map entries into the variables it stores with a message. | P1 | Test | Proposed |

- SHR-CFG-01: source: docs/user/scripting-api.md "Maps" ("Configuration values loaded at deploy time"); D-246 (references in connector settings); D-328 (read live at every deploy, startup redeploy included, and not kept in the deployment record).
- SHR-CFG-02: source: D-247 ("because they can hold credentials").

## Collections (COL)

| ID | Requirement | Pri | Verify | Status |
|---|---|---|---|---|
| SHR-COL-01 | When a script stores a record in a collection, the system shall add a new record and never replace an existing one, and shall report success only once the record would survive a crash of the server. | P1 | Test | Proposed |
| SHR-COL-02 | The system shall let a script in any channel find records by exact value or any of a list of values on any of the collection's indexed fields, all conditions together, and return either the newest match or the matches in order of creation. | P1 | Test | Proposed |
| SHR-COL-03 | The system shall refuse, with an error in the script and nothing stored or changed, a record with a field the collection does not index or with content over 1 MiB (1,048,576 bytes). | P1 | Test | Proposed |
| SHR-COL-04 | When a record is updated by its identifier, the system shall change only the parts the update names (the fields, the content or the expiry), so that two simultaneous updates of different parts of one record are both kept. | P1 | Test | Proposed |
| SHR-COL-05 | When several scripts delete the same record, the system shall tell exactly one of them that it deleted the record and the others that the record was already gone. | P1 | Test | Proposed |
| SHR-COL-06 | The system shall give each new record the lifetime its writer names, or else the collection's default lifetime, which may be "never expires", and a later change of the default shall not alter existing records. | P1 | Test | Proposed |
| SHR-COL-07 | The system shall not return a record to a script or a person after its lifetime has ended. | P1 | Test | Proposed |
| SHR-COL-08 | The system shall permanently delete a record within 24 hours after its lifetime has ended, whether or not scheduled message pruning is turned on. | P1 | Test | Proposed |
| SHR-COL-09 | When a script's search that gives no limit matches more than 1,000 records, the system shall fail the search with an error that says so, instead of returning part of the matches or all of them. | P2 | Test | Proposed |

- SHR-COL-01: source: D-177 point 2 (append-only, so high-volume writes do not race); D-204; docs/design/10-collections.md "Model".
- SHR-COL-02: source: D-177 point 3; docs/user/scripting-api.md "Collections"; docs/design/10-collections.md "Query surface" (no ranges, joins or partial keys in the first version).
- SHR-COL-03: source: docs/design/10-collections.md "Security / limits" and docs/testing/66-collections.md ("Storing a payload > 1 MiB throws"); a collection indexes 1 to 32 fields, from code only.
- SHR-COL-04: source: D-204 ("A script `update` changes only the keys given"); the simultaneous case is from code only.
- SHR-COL-05: source: docs/user/scripting-api.md "Collections" (`delete` returns true, or false if already gone) and its order and report matching example; that exactly one caller is told is from code only.
- SHR-COL-06: source: D-177 point 5; docs/testing/66-collections.md "TTL / Pruning".
- SHR-COL-07: source: docs/design/10-collections.md "Model" ("default record lifetime"). D-377: a script does not find an expired record; a person still sees it on the records page, marked, until it is pruned.
- SHR-COL-08: source: D-177 point 5; docs/design/10-collections.md "TTL". The 24 hours is the daily pruner schedule. conflict: the design reuses the pruner schedule, which is off until an administrator turns it on, while a collection promises a lifetime with no such condition; the lifetime kept.
- SHR-COL-09: source: code only: a script may ask for at most 1,000 records, and a search that asks for no limit has none. Compare ROADMAP "Apply row limits in the database" for data sources.

## Data sources (DSR)

| ID | Requirement | Pri | Verify | Status |
|---|---|---|---|---|
| SHR-DSR-01 | The system shall let a script query a database only through a data source that someone with the permission for it has defined, naming it, with the script neither supplying nor being given its address, user name or password. | P1 | Test | Proposed |
| SHR-DSR-02 | The system shall make a new data source read-only unless the person defining it says otherwise, and shall fail any statement that would write through a read-only one, with nothing changed in the database. | P1 | Test | Proposed |
| SHR-DSR-03 | The system shall pass the values a script gives beside its SQL to the database as values only, never as part of the SQL text. | P1 | Test | Proposed |
| SHR-DSR-04 | The system shall cancel a query that runs longer than its data source's time limit (30 seconds unless set between 0.1 and 600 seconds), at the database too, and raise an error in the script. | P1 | Test | Proposed |
| SHR-DSR-05 | When a query gives more rows than its data source allows (10,000 unless set between 1 and 1,000,000), the system shall raise an error in the script and return no rows, having held at most one row more than that limit in memory. | P1 | Test | Proposed |
| SHR-DSR-06 | When a data source is changed or deleted, the system shall use the new definition, or refuse the query naming the missing data source, from the next query on, without a redeploy of any channel. | P1 | Test | Proposed |

- SHR-DSR-01: source: D-178 points 1 and 2; docs/design/11-datasources.md "Security summary" (reachable databases limited to configured sources); docs/user/capabilities.md "Named database connections for scripts (Data Sources)" (Yes).
- SHR-DSR-02: source: D-178 point 3; D-186 (several statements in one call cannot leave the read-only mode).
- SHR-DSR-03: source: D-178 point 6; docs/user/scripting-api.md "Data Sources" ("Parameterized only"). A script that builds its SQL text from message values is not protected by this.
- SHR-DSR-04: source: D-178 point 6; docs/design/11-datasources.md "Data model" (30 s); the range is from code only.
- SHR-DSR-05: source: D-178 point 6 (fail loud, never silent truncation); ROADMAP "Apply row limits in the database, not after the fetch" for the memory bound; the range is from code only.
- SHR-DSR-06: source: docs/design/11-datasources.md "Pool manager"; docs/testing/67-datasources.md "Script Bridge Tests".

## Resources (RES)

| ID | Requirement | Pri | Verify | Status |
|---|---|---|---|---|
| SHR-RES-01 | The system shall give a script the current text of the resource it names, with an edit visible to the next read without a redeploy, and give it an empty result, not an error, when no resource has that name. | P1 | Test | Proposed |

- SHR-RES-01: source: docs/user/capabilities.md "Named files scripts read by name (Resources)" (Yes); docs/user/scripting-api.md "Optional IO bridges"; docs/user/access-control.md `resources:write` ("an edit changes what they receive").

## All shared data (GEN)

| ID | Requirement | Pri | Verify | Status |
|---|---|---|---|---|
| SHR-GEN-01 | The system shall refuse to deploy a channel when it cannot read the global map or the configuration map, with an error that names which. | P1 | Test | Proposed |
| SHR-GEN-02 | The system shall start a script that uses neither map at most 10% slower with 10 MB of entries in the global and configuration maps than with both empty. | P2 | Test | Proposed |

- SHR-GEN-01: source: D-207 (the config map, the global map and others that fail to load block the deploy). What happens to a running version whose redeploy fails is a Channels rule.
- SHR-GEN-02: source: ROADMAP "Stop copying the global and configuration maps into every script run" (review item L22). The sizes are the drafter's.
