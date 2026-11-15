// ===========================================
// TCP/MLLP Form Option Lists
// ===========================================
// Shared select options for the TCP/MLLP source + destination forms.
//
// Values must be TCP_MLLP_CHARSETS and TCP_MLLP_RESPONSE_MODES from the
// core-models schema, which refuses anything else at deploy
// (connector-defaults.test.ts checks they match).

export interface SelectOption {
  readonly value: string;
  readonly label: string;
}

export const MLLP_CHARSETS: ReadonlyArray<SelectOption> = [
  { value: 'utf-8', label: 'UTF-8' },
  { value: 'latin1', label: 'ISO-8859-1 (Latin-1)' },
  { value: 'ascii', label: 'US-ASCII' },
  { value: 'utf16le', label: 'UTF-16LE' },
];

// AUTO_ACK synthesizes an HL7 ACK/NAK from the inbound MSH; PASSTHROUGH returns
// the pipeline/destination response verbatim.
export const MLLP_RESPONSE_MODES: ReadonlyArray<SelectOption> = [
  { value: 'AUTO_ACK', label: 'Auto-generate ACK' },
  { value: 'PASSTHROUGH', label: 'Passthrough (relay downstream response)' },
];
