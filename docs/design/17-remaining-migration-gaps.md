# 17. The last three migration gaps: MySQL, Delimited, X12

Status: Michael approved the recommended option for all three on 2026-11-13, and all three are built: S19 Delimited (D-257), S20 X12 (D-258), S15 MySQL (D-259). The proposal as written when the suite scored 55/60 follows.

## S15: Database Writer to MySQL (weight 2, doc 12 rank 1)

GalvaniFlow's database connectors speak PostgreSQL only (`pg`). Mirth's are JDBC and reach MySQL, SQL Server, Oracle and others; the production backup has no database channels, but doc 12 ranks this first for other sites. AGENTS.md's "PostgreSQL only" is about GalvaniFlow's own store, not what a connector may talk to.

Options:

1. **A driver per vendor behind the existing connector (recommended).** The connection pool becomes an interface with a `pg` and a `mysql2` implementation, picked by a `vendor` setting the importer fills from the JDBC URL (`jdbc:mysql:` → mysql). Queries keep `${name}` parameters; each driver turns them into its own placeholders (`$1` for pg, `?` for mysql2). SQL Server (`tedious`) and Oracle (`oracledb`, needs Oracle client libraries) can follow the same interface when someone needs them. Cost: M for MySQL. The `FOR UPDATE SKIP LOCKED` claim in the reader exists in MySQL 8 too.
2. **Generic ODBC.** One driver for all vendors through `odbc`. Needs native ODBC drivers installed on the host and a DSN per database: heavy for operators, and the native module is a supply-chain and build burden.
3. **Leave it PostgreSQL-only.** A site with MySQL routes through a JavaScript Writer with its own client, which the sandbox does not allow.

## S19: Delimited data (weight 2, doc 13 N2)

`DELIMITED` is declared but passes through as a string, so a transformer cannot read a CSV by column. Mirth turns delimited text into XML rows; GalvaniFlow has no XML message model for scripts (D-244), so it needs its own shape.

Options:

1. **`msg` is an array of row objects (recommended).** The Delimited settings (column delimiter, record delimiter, quote, header row or column names) parse the content into `[{ mrn, family, given }, ...]`, keyed by the configured names or `column1...`. One row is still an array, so scripts always do `msg[0].mrn` or loop; the outbound side serializes the array back with the same settings. With "Process Batch" on, each row becomes its own message and `msg` is that one row object. S19 would change from `msg.mrn` to `msg[0].mrn` without batch, or keep `msg.mrn` with Process Batch on, matching what Mirth exports for such a channel.
2. **`msg` is one object for one row, an array for several.** Saves `[0]` on the common single-row file, but a script then breaks on the first file with two rows.
3. **Keep the string and let scripts split it.** No work, and every operator writes their own CSV parser.

## S20: X12 (weight 1, doc 13 N1)

No EDI/X12 data type exists. Eligibility (270/271), claims (837) and remits (835) use it.

Options:

1. **An X12 data type on the HL7 path model (recommended).** The parser reads the delimiters from the ISA segment and gives segments and elements the same path API as HL7: `msg.get('NM1[3].9')` (third NM1, ninth element), `msg.set`, `msg.delete`, with components (`:`) as the third level. Scripts and the message browser treat it like HL7. Cost: M; no envelope validation or acknowledgement (999/TA1) in the first step.
2. **X12 to JSON.** Segments become an array of objects. Simple to build, but loses the path API operators already know from HL7 and needs its own serializer rules.
3. **Defer.** X12 sites stay on Mirth.

## Decisions needed

1. S15: build a MySQL driver behind the database connector (option 1), or keep PostgreSQL-only?
2. S19: Delimited `msg` as an array of row objects (option 1)? This also changes S19's script, which resets the suite's baseline.
3. S20: X12 on the HL7 path model (option 1), JSON, or defer?
