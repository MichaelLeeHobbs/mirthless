// Values must be the core-models TCP_MLLP_RESPONSE_MODES, which deploy enforces (connector-defaults.test.ts checks).

export interface SelectOption {
  readonly value: string;
  readonly label: string;
}

export const MLLP_RESPONSE_MODES: ReadonlyArray<SelectOption> = [
  { value: 'AUTO_ACK', label: 'Auto-generate ACK' },
  { value: 'PASSTHROUGH', label: 'Passthrough (relay downstream response)' },
];
