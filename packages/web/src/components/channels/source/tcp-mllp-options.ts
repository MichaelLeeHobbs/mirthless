// ===========================================
// TCP/MLLP Form Option Lists
// ===========================================
// Response modes for the TCP/MLLP source form; the charsets are
// CHARSET_OPTIONS in ../common/charset-options.ts.
//
// Values must be TCP_MLLP_RESPONSE_MODES from the core-models schema, which
// refuses anything else at deploy (connector-defaults.test.ts checks they match).

export interface SelectOption {
  readonly value: string;
  readonly label: string;
}

// AUTO_ACK synthesizes an HL7 ACK/NAK from the inbound MSH; PASSTHROUGH returns
// the pipeline/destination response verbatim.
export const MLLP_RESPONSE_MODES: ReadonlyArray<SelectOption> = [
  { value: 'AUTO_ACK', label: 'Auto-generate ACK' },
  { value: 'PASSTHROUGH', label: 'Passthrough (relay downstream response)' },
];
