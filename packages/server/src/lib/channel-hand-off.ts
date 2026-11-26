// A Channel Writer's send waits for the target channel's whole pipeline, so a server stop can end it
// after the target recorded the message. The target records it on the sender's message as well
// (`CONTENT_TYPE.HAND_OFF`), and the send removes that once it returns: a send that finds one was
// interrupted, and does not send again what the target delivered (D-393).

import { setTimeout as pause } from 'node:timers/promises';
import { z } from 'zod/v4';
import { tryCatch, type Result } from 'stderr-lib';
import { idSchema, wholeNumberSchema } from '@galvanigraph/core-models';
import type { DestinationResponse, HandOff } from '@galvanigraph/engine';

// A queued send's message id is the text Postgres returns for a bigint.
const messageIdSchema = wholeNumberSchema(1);
const handOffSchema = z.object({ channelId: idSchema, messageId: messageIdSchema, metaDataId: messageIdSchema });
const handedToSchema = z.object({ channelId: idSchema, messageId: messageIdSchema });
type HandedTo = z.infer<typeof handedToSchema>;

/** A target that reads the same input again finishes its message with one of these, as a live send would see it delivered. */
const DELIVERED: ReadonlySet<string> = new Set(['SENT', 'FILTERED']);
const POLL_MS = 1_000;

/** The send a Channel Writer's source map names (channel-dispatcher.ts), or null. */
export function handOffIn(sourceMap: Readonly<Record<string, unknown>>): HandOff | null {
  if (sourceMap['connectorType'] !== 'CHANNEL') return null;
  const parsed = handOffSchema.safeParse({
    channelId: sourceMap['sourceChannelId'], messageId: sourceMap['sourceMessageId'], metaDataId: sourceMap['sourceMetaDataId'],
  });
  return parsed.success ? parsed.data : null;
}

export interface HandOffStore {
  readonly handedTo: (send: HandOff) => Promise<Result<string | null>>;
  readonly forget: (send: HandOff) => Promise<Result<void>>;
  readonly sourceState: (channelId: string, messageId: number) => Promise<Result<{ readonly processed: boolean; readonly status: string | null } | null>>;
  readonly isStarted: (channelId: string) => boolean;
  readonly onRepeat: (send: HandOff, to: HandedTo) => void;
  readonly onUnread: (send: HandOff, error: Error) => void;
  /** Until the next look at an unfinished target message; resolves early when the signal aborts. */
  readonly pause: (signal: AbortSignal) => Promise<void>;
}

export function pauseBeforeNextLook(signal: AbortSignal): Promise<void> {
  return pause(POLL_MS, undefined, { signal }).catch(() => undefined);
}

export interface ChannelSend {
  readonly key: HandOff;
  /** The channel the destination sends to now; null when that cannot be told, or for a first send, which nothing came before. */
  readonly target: string | null;
  readonly halt: AbortSignal;
  /** The halt and the send's time limit. */
  readonly deadline: AbortSignal;
  readonly send: () => Promise<Result<DestinationResponse>>;
}

const HALTED = 'HALTED';

/**
 * Sends, unless an interrupted send of the same destination was delivered by the target. When unsure,
 * it sends: a target message that failed, is gone, or is not finished once its channel stops, is sent again.
 */
export async function sendOnce(channelSend: ChannelSend, store: HandOffStore): Promise<Result<DestinationResponse>> {
  const earlier = await deliveredBefore(channelSend, store);
  if (earlier === HALTED) return { ok: false, value: null, error: new Error('Interrupted: the channel was halted') } as Result<DestinationResponse>;
  const result = earlier === null
    ? await channelSend.send()
    : { ok: true as const, value: { status: 'SENT' as const, content: `messageId=${String(earlier.messageId)}` }, error: null };
  const forgotten = await store.forget(channelSend.key);
  if (!forgotten.ok) store.onUnread(channelSend.key, forgotten.error);
  return result;
}

async function deliveredBefore({ key, target, halt, deadline }: ChannelSend, store: HandOffStore): Promise<HandedTo | null | typeof HALTED> {
  if (target === null) return null;
  const stored = await store.handedTo(key);
  if (!stored.ok) {
    store.onUnread(key, stored.error);
    return null;
  }
  const to = stored.value === null ? null : parsedHandedTo(stored.value);
  // Sent to another channel now: a live send would go there.
  if (to === null || to.channelId !== target) return null;
  for (;;) {
    const state = await store.sourceState(to.channelId, to.messageId);
    if (!state.ok) {
      store.onUnread(key, state.error);
      return null;
    }
    const found = state.value;
    if (found !== null && DELIVERED.has(found.status ?? '')) {
      store.onRepeat(key, to);
      return to;
    }
    if (found === null || found.processed || found.status === 'ERROR') return null;
    if (halt.aborted) return HALTED;
    // Not finished, and nothing finishes it now.
    if (deadline.aborted || !store.isStarted(to.channelId)) return null;
    await store.pause(deadline);
  }
}

function parsedHandedTo(text: string): HandedTo | null {
  const parsed = tryCatch((): unknown => JSON.parse(text));
  if (!parsed.ok) return null;
  const read = handedToSchema.safeParse(parsed.value);
  return read.success ? read.data : null;
}
