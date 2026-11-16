// ===========================================
// Script channel context
// ===========================================
// The channel editor provides its inbound data type here, so every script
// editor inside it types msg and tmp the way the engine parses them (the engine
// parses every channel script's message with the channel's inbound data type).
// No Monaco import, so pages can provide it without loading the editor.

import { createContext, useContext } from 'react';

/** The channel's inbound data type, or undefined outside a channel. */
export const ScriptDataTypeContext = createContext<string | undefined>(undefined);

/** Where a filter rule or transformer step runs. */
export type ScriptStage = 'source' | 'destination';

/**
 * The script surface of a filter or transformer: source scripts can choose
 * destinations, and each stage has its own code template context.
 */
export const FILTER_TRANSFORMER_SURFACE = {
  source: { destinationSet: true, templateContext: 'SOURCE_FILTER_TRANSFORMER' },
  destination: { templateContext: 'DESTINATION_FILTER_TRANSFORMER' },
} as const;

/** The data type scripts in this channel receive. */
export function useScriptDataType(): string | undefined {
  return useContext(ScriptDataTypeContext);
}

/**
 * The sample message for test runs, shared by every script editor in a channel
 * so it is pasted once. Held in memory only: it can be PHI, so it is never
 * written to storage. Absent outside a channel, where scripts have no Run button.
 */
export interface ScriptTestSample {
  readonly channelId: string | undefined;
  readonly sample: string;
  readonly setSample: (sample: string) => void;
}

export const ScriptTestSampleContext = createContext<ScriptTestSample | undefined>(undefined);

export function useScriptTestSample(): ScriptTestSample | undefined {
  return useContext(ScriptTestSampleContext);
}
