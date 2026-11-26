// The engine parses every channel script's message with the channel's inbound data type, so editors type msg and tmp
// from it. No Monaco import, so pages can provide it without loading the editor.

import { createContext, useContext } from 'react';

export const ScriptDataTypeContext = createContext<string | undefined>(undefined);

export type ScriptStage = 'source' | 'destination';

export const FILTER_TRANSFORMER_SURFACE = {
  source: { destinationSet: true, templateContext: 'SOURCE_FILTER_TRANSFORMER' },
  destination: { templateContext: 'DESTINATION_FILTER_TRANSFORMER' },
} as const;

export function useScriptDataType(): string | undefined {
  return useContext(ScriptDataTypeContext);
}

/** Shared by every script editor in a channel. Memory only: the sample can be PHI, so it is never written to storage. */
export interface ScriptTestSample {
  readonly channelId: string | undefined;
  readonly sample: string;
  readonly setSample: (sample: string) => void;
  /** The source transformer's inbound properties as edited, so a test run reads the sample as the channel would deploy (#474). */
  readonly dataTypeProperties: Readonly<Record<string, unknown>>;
}

export const ScriptTestSampleContext = createContext<ScriptTestSample | undefined>(undefined);

export function useScriptTestSample(): ScriptTestSample | undefined {
  return useContext(ScriptTestSampleContext);
}
