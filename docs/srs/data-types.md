# Data types

How message content in each format is read, shown to scripts, changed, written, split, checked and acknowledged. Area code `DATA`. How a script runs is in [scripting.md](scripting.md), what a connector does with bytes on the wire is in [connectors.md](connectors.md), and when a message is accepted or refused is in [pipeline.md](pipeline.md).

## Every format (GEN)

| ID | Requirement | Pri | Verify | Status |
|---|---|---|---|---|
| DATA-GEN-01 | The system shall send on, character for character as received, the content of a message that no script, template or setting changed, in every data type. | P1 | Test | Proposed |
| DATA-GEN-02 | The system shall never change a value because of what it looks like: text is not turned into a number, boolean or date and is not trimmed (`000123`, `02134` and `1.0` reach a script as written), and a JSON number reaches a script without losing a digit. | P1 | Test | Proposed |
| DATA-GEN-03 | When a message, after its preprocessors have run, cannot be read as its channel's inbound data type, the system shall keep the text as received, give the message the status ERROR with a reason, run no filter or transformer on it, and send it to no destination. | P1 | Test | Proposed |
| DATA-GEN-04 | The reason or warning the system records, logs or alerts with when it cannot read a message, or tolerates a fault in it, shall name the fault and its position and quote no text from the message. | P1 | Test | Proposed |
| DATA-GEN-05 | A value that a script or an acknowledgement puts into an HL7 v2 or X12 message shall never add a field, element or segment to it: the delimiters and line breaks that would do so are encoded, or the write is refused with an error where the format has no encoding. | P1 | Test | Proposed |
| DATA-GEN-06 | The system shall write each destination's content in the outbound data type set for that destination, and shall mark that destination ERROR rather than send content it cannot write in that type. | P2 | Test | Proposed |

- DATA-GEN-01: source: docs/user/scripting-api.md "How a changed message is written back"; D-208; #344 property 1.
- DATA-GEN-02: source: D-208 ("Message values are never converted because of what they look like"); docs/user/scripting-api.md "How a changed message is written back".
- DATA-GEN-03: source: D-020 (pipeline order), AGENTS.md "Fail safe, not silent"; the stored ERROR and reason are in the pipeline code. Conflict: D-020 and docs/design/02-engine.md put preprocessing first, as Mirth does, while the code checks the format before the preprocessor runs, so a preprocessor cannot repair a malformed message; intent (D-020) kept.
- DATA-GEN-04: source: #189 ("a stable code and a position, never a field value, because message content is PHI"); AGENTS.md "No credential logging". The logging rule for the whole product belongs to the Security area; this row covers the readers of each format.
- DATA-GEN-05: source: D-218; D-224; D-258 (`set` refuses a value holding a delimiter); docs/user/scripting-api.md `set` and `setText`.
- DATA-GEN-06: source: docs/user/capabilities.md "Convert to the channel's outbound data type" (No); docs/progress/ROADMAP.md "Apply a channel's outbound data type"; docs/design/04-transformer-sandbox.md (serialize by outbound type).

## HL7 v2 (HL7)

| ID | Requirement | Pri | Verify | Status |
|---|---|---|---|---|
| DATA-HL7-01 | The system shall read an HL7 v2 message by the delimiters its own MSH-1 and MSH-2 declare (3, 4 or 5 distinct MSH-2 characters), and shall write it back with them; a message whose MSH-2 is anything else cannot be read (DATA-GEN-03). | P1 | Test | Proposed |
| DATA-HL7-02 | The system shall end an HL7 v2 segment at a carriage return, at a carriage return and line feed, or at a line feed before a line that starts as a segment or is blank, and shall keep any other line feed as part of its field. | P1 | Test | Proposed |
| DATA-HL7-03 | The system shall let a script read, replace and delete any segment occurrence, field, repetition, component and subcomponent of an HL7 v2 message, Z-segments included, by a path whose numbers all count from 1 as in the HL7 standard. | P1 | Test | Proposed |
| DATA-HL7-04 | When a script changes one part of an HL7 v2 message, the system shall leave every other field, repetition and component exactly as received, empty and trailing ones included; segment endings, written as carriage returns, are the only other difference. | P1 | Test | Proposed |
| DATA-HL7-05 | Free text that a script writes through the free-text call shall read back as the same text through it, and reading shall decode the delimiter escapes, the line-break escape `\.br\` and hexadecimal escapes (in the character set MSH-18 names), keeping every escape it does not know as written. | P1 | Test | Proposed |
| DATA-HL7-06 | The system shall let a script tell an absent or empty HL7 v2 field from an explicit null (`""`), and write an explicit null, without comparing text. | P2 | Test | Proposed |
| DATA-HL7-07 | The system shall record on the message, readable by scripts and in the message browser, a stable code and a position for each departure from the HL7 v2 standard that it tolerates, among them text before MSH, a bare line feed kept as content, a leftover end-of-block byte, an unknown escape and a lowercase segment ID. | P2 | Test | Proposed |
| DATA-HL7-08 | The system should check HL7 v2 messages against a conformance profile chosen for a channel and, as the channel is set, either refuse a message that does not conform or record what does not conform. | P3 | Test | Proposed |

- DATA-HL7-01: source: D-292 (three-character MSH-2); docs/user/capabilities.md "HL7 v2 messages read and edited by path" (Yes). The 3 to 5 distinct characters limit is in the parser code.
- DATA-HL7-02: source: the parser and its tests (#187 is cited there); D-254 batch splitting uses the same rule. #192 says any later reader must keep it.
- DATA-HL7-03: source: docs/user/capabilities.md "HL7 v2 messages read and edited by path" (Yes); docs/user/scripting-api.md "HL7 helpers"; D-032; D-224.
- DATA-HL7-04: source: #344 properties 2 and 3; D-224; docs/progress/ROADMAP.md "Known Issues" ("roundtrip transforms incomplete"). #344 also sets the corpus that proves it: each common message type, versions 2.1 to 2.8, non-default delimiters, every escape, malformed input real senders produce.
- DATA-HL7-05: source: D-218; #194 (hex escapes by MSH-18, shipped); #191 (`\.br\`, open); docs/user/scripting-api.md "HL7 helpers". #194's per-channel setting for code-point escapes (`\X2019\`) is not in this row: it is an owner's choice.
- DATA-HL7-06: source: #190; docs/progress/ROADMAP.md V10.
- DATA-HL7-07: source: #189; docs/progress/ROADMAP.md V10. An alert when a feed starts producing warnings (#189) belongs to the Monitoring area.
- DATA-HL7-08: source: docs/user/capabilities.md "Validate HL7 against a conformance profile" (No); docs/progress/ROADMAP.md V10.

## HL7 v2 acknowledgements (ACK)

| ID | Requirement | Pri | Verify | Status |
|---|---|---|---|---|
| DATA-ACK-01 | An HL7 v2 acknowledgement the system builds shall address the sender (MSH-3 and MSH-4 swapped with MSH-5 and MSH-6), echo the received MSH-10 whole in MSA-2, and carry a control ID of its own, at most 20 characters, that no other acknowledgement from that server has. | P1 | Test | Proposed |
| DATA-ACK-02 | An HL7 v2 acknowledgement the system builds shall use the sender's delimiters and MSH-12 version, and shall put an error code where that version defines it: ERR-1 before version 2.5, ERR-3 with a severity in ERR-4 from 2.5 on. | P1 | Test | Proposed |

- DATA-ACK-01: source: D-292; docs/user/scripting-api.md "createACK"; docs/user/capabilities.md "Build HL7 v2 acknowledgements" (Yes). When AA or AE is the answer belongs to the Connectors and Pipeline areas.
- DATA-ACK-02: source: D-292.

## Batches (BAT)

| ID | Requirement | Pri | Verify | Status |
|---|---|---|---|---|
| DATA-BAT-01 | With batch processing on, the system shall turn an HL7 v2 batch into one message per MSH, in file order, dropping only the FHS, BHS, BTS and FTS segments, and shall refuse the whole batch when any other segment comes before the first MSH. | P1 | Test | Proposed |
| DATA-BAT-02 | The system shall process every message of a batch even when one fails, and shall then report an error, never a success, to the batch's source. | P1 | Test | Proposed |
| DATA-BAT-03 | With batch processing on, the system shall turn delimited text into one message per row and an X12 interchange into one message per transaction set, each keeping its envelope's identifiers readable; on a data type it cannot split, the channel shall refuse to deploy. | P2 | Test | Proposed |
| DATA-BAT-04 | The memory the system uses to read an HL7 v2 batch file should depend on the largest message in it and not on the size of the file, while messages keep file order and a failure partway leaves a record of which messages were processed. | P3 | Analysis | Proposed |

- DATA-BAT-01: source: docs/user/capabilities.md "Split an HL7 v2 batch into messages" (Yes); D-254. The refusal is in the splitter's tests.
- DATA-BAT-02: source: D-254. Conflict: docs/design/02-engine.md "Batch response aggregation" answers with the last or first failed message's response, or an HL7 batch acknowledgement; D-254 (later) kept.
- DATA-BAT-03: source: docs/progress/ROADMAP.md S19 ("Process Batch per row", not yet) and S20 ("X12 batch splitting", not yet); docs/design/17-remaining-migration-gaps.md (option 1, one row one message); D-254 (batch on another data type refuses to deploy). The X12 unit, one transaction set, is assumed.
- DATA-BAT-04: source: #192 (parked until peak memory is measured and a target set).

## XML and JSON (DOC)

| ID | Requirement | Pri | Verify | Status |
|---|---|---|---|---|
| DATA-DOC-01 | When a script changes part of an XML or JSON message, the system shall write the rest as it arrived: in XML the element order, comments, CDATA sections, namespace prefixes, XML declaration and whitespace; in JSON the key order and the spelling of every number the script left alone. | P1 | Test | Proposed |
| DATA-DOC-02 | The system shall read no external entity or document that an XML message names, and shall refuse (DATA-GEN-03) an XML message whose entities expand to more than 1,000,000 characters. | P1 | Test | Proposed |

- DATA-DOC-01: source: D-225; docs/user/scripting-api.md "How a changed message is written back"; docs/user/capabilities.md "XML messages" and "JSON messages". docs/progress/ROADMAP.md "Known Issues" lists the one exception today: the line break after the XML declaration.
- DATA-DOC-02: source: the XML reader's limits in code (no document states them); the importer's same rule is MIG-IMP-03.

## Delimited and fixed-width text (TAB)

| ID | Requirement | Pri | Verify | Status |
|---|---|---|---|---|
| DATA-TAB-01 | The system shall give scripts delimited text, and fixed-width text with the column widths set for the channel, as a list of rows whose values are read by column name, one row included, with the delimiters, quote, escape and column names set for the channel. | P1 | Test | Proposed |
| DATA-TAB-02 | When a script changes a row, the system shall write every column of every row back in the order it was read, whatever the column names, and each value shall read back the same even when it holds a delimiter, a quote or a line break; a set of column names that would prevent this shall refuse to deploy. | P1 | Test | Proposed |

- DATA-TAB-01: source: D-257; docs/design/17-remaining-migration-gaps.md S19; docs/user/capabilities.md "Delimited (CSV) messages read by column name" (no fixed-width columns); docs/progress/ROADMAP.md S19. Fixed-width alone would be P2.
- DATA-TAB-02: source: #372; D-257 ("whatever the writer produces reads back the same").

## X12 (EDI)

| ID | Requirement | Pri | Verify | Status |
|---|---|---|---|---|
| DATA-EDI-01 | The system shall read an X12 interchange by the delimiters its fixed-width ISA segment declares, let a script read, replace and delete any segment occurrence, element and component by path, and write it back with the same delimiters and line breaks; an interchange whose ISA is not fixed-width cannot be read (DATA-GEN-03). | P1 | Test | Proposed |
| DATA-EDI-02 | The system shall check the envelopes of an X12 interchange (control numbers and counts of ISA/IEA, GS/GE and ST/SE), mark a message that fails the check ERROR, and answer the sender with a TA1 and 999 that report the result when the channel asks for them. | P2 | Test | Proposed |

- DATA-EDI-01: source: D-258; docs/user/capabilities.md "X12 messages read and edited by path" (Partial); docs/design/17-remaining-migration-gaps.md S20.
- DATA-EDI-02: source: docs/progress/ROADMAP.md S20 ("Not yet: envelope validation, 999/TA1 acknowledgements"); docs/user/capabilities.md "X12 messages read and edited by path"; docs/design/18-voice-of-the-user.md (DT5, X12 as a differentiator).

## FHIR, HL7 v3, DICOM and NCPDP (OTH)

| ID | Requirement | Pri | Verify | Status |
|---|---|---|---|---|
| DATA-OTH-01 | The system shall give scripts a FHIR JSON message as a parsed object, under the same rules as JSON (DATA-GEN-02, DATA-DOC-01). | P2 | Test | Proposed |
| DATA-OTH-02 | The system shall give scripts an HL7 v3 or CDA message as a parsed document they can read and edit, under the same rules as XML (DATA-GEN-02, DATA-DOC-01, DATA-DOC-02). | P2 | Test | Proposed |
| DATA-OTH-03 | The system shall let scripts read the tags of a received DICOM object by tag number and keyword, and send on an object they did not change with its bytes unchanged. | P2 | Test | Proposed |
| DATA-OTH-04 | The system should let a script read and edit NCPDP Telecommunication messages by segment and field, and write back unchanged whatever the script left alone. | P3 | Test | Proposed |
| DATA-OTH-05 | The system should check FHIR messages against FHIR R4 and a chosen profile, as a step a channel can turn on, and refuse or record what does not conform as the channel is set; a resource of another FHIR version shall be refused, not guessed. | P3 | Test | Proposed |

- DATA-OTH-01: source: #349 item 2; docs/user/capabilities.md "FHIR messages" (Partial); docs/progress/ROADMAP.md V12.
- DATA-OTH-02: source: docs/progress/ROADMAP.md N2; docs/user/capabilities.md "HL7 v3 and CDA messages" (Partial); D-225 names CDA as the reason for keeping element order. Conflict: ROADMAP also lists "HL7v3/CDA specialized parsing" under Someday; the numbered item (N2) kept.
- DATA-OTH-03: source: docs/progress/ROADMAP.md N2; docs/user/capabilities.md "DICOM to XML" (No). Changed from "DICOM to XML": the need is reading tags, and D-244 gives scripts no XML model. Writing tags is not asked for by any source.
- DATA-OTH-04: source: docs/progress/ROADMAP.md N1; docs/user/capabilities.md "NCPDP pharmacy messages" (No); docs/design/13-non-connector-gap-analysis.md open decision 4 (on first real need).
- DATA-OTH-05: source: #349 item 4 and its acceptance ("R4 only at first; another version is refused, not guessed"); docs/progress/ROADMAP.md B7, V12; docs/user/capabilities.md "Validate and map FHIR in the pipeline" (No).

## Character sets and binary (CHR)

| ID | Requirement | Pri | Verify | Status |
|---|---|---|---|---|
| DATA-CHR-01 | The system shall read and write every character of a character set a connector offers (UTF-8, ISO-8859-1, Windows-1252, US-ASCII, UTF-16LE, as that connector lists) as that character set defines it on every runtime version it supports, and shall refuse to deploy a channel whose character set the runtime decodes wrongly. | P1 | Test | Proposed |
| DATA-CHR-02 | The system shall never replace a byte or character in silence: text not valid in the character set it is read in is refused, or stored with a flag on the message, and a message holding a character the outgoing character set lacks ends in ERROR instead of being sent with another character. | P1 | Test | Proposed |
| DATA-CHR-03 | The system shall carry a binary message (a PDF, an image) from a source that accepts one to a destination that writes one with its bytes unchanged. | P2 | Test | Proposed |

- DATA-CHR-01: source: #391; docs/user/connector-reference.md `charset` and `bodyCharset` rows; D-219 (a character set that cannot be decoded refuses to deploy).
- DATA-CHR-02: source: D-334 (HTTP refuses), D-270 (Kafka and AMQP flag), #369; AGENTS.md "Messages must never be silently lost, duplicated, or corrupted". The outgoing half has no source but that principle. Conflict: D-334 refuses and D-270 stores with a flag; both kept, as each decision gives its reason.
- DATA-CHR-03: source: docs/user/capabilities.md "Binary messages over TCP and HTTP" (Partial); docs/progress/ROADMAP.md 10; #342 item 4. Which connectors accept and write binary belongs to the Connectors area.
