// Values must be the core-models CONNECTOR_CHARSETS and QUEUE_CHARSETS, which
// the schemas accept at deploy (connector-defaults.test.ts checks).

interface CharsetOption {
  readonly value: string;
  readonly label: string;
}

export const CHARSET_OPTIONS: ReadonlyArray<CharsetOption> = [
  { value: 'utf-8', label: 'UTF-8' },
  { value: 'latin1', label: 'ISO-8859-1 (Latin-1)' },
  { value: 'ascii', label: 'US-ASCII' },
  { value: 'utf16le', label: 'UTF-16LE' },
];

export const QUEUE_CHARSET_OPTIONS: ReadonlyArray<CharsetOption> = [
  { value: 'utf-8', label: 'UTF-8' },
  { value: 'latin1', label: 'ISO-8859-1 (Latin-1)' },
  { value: 'windows-1252', label: 'Windows-1252' },
  { value: 'base64', label: 'Binary (keep bytes as base64)' },
];
