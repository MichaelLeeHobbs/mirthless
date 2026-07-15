// ===========================================
// TCP/MLLP Form Option Lists
// ===========================================
// Shared select options for the TCP/MLLP source + destination forms.
//
// charset values MUST be valid Node BufferEncoding tokens: the connector
// registry casts props['charset'] straight to BufferEncoding with no
// normalization (unlike the File connectors, which run normalizeEncoding).
// A human-friendly label like "ISO-8859-1" would reach Node's Buffer API
// verbatim and throw — so we constrain the control to real tokens.

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

// responseMode values MUST match MLLP_RESPONSE_MODE in the connectors package.
// AUTO_ACK synthesizes an HL7 ACK/NAK from the inbound MSH; PASSTHROUGH returns
// the pipeline/destination response verbatim.
export const MLLP_RESPONSE_MODES: ReadonlyArray<SelectOption> = [
  { value: 'AUTO_ACK', label: 'Auto-generate ACK' },
  { value: 'PASSTHROUGH', label: 'Passthrough (relay downstream response)' },
];
