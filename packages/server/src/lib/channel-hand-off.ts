// A Channel Writer's send waits for the target channel's whole pipeline, so a server stop can end it
// after the target recorded the message. The target records it on the sender's message as well
// (`CONTENT_TYPE.HAND_OFF`), and the send removes that once it returns: a send that finds one was
// interrupted, and does not make a second message in the target (D-403).

import { setTimeout as pause } from 'node:timers/promises';
import { z } from 'zod/v4';
import { tryCatch, type Result } from 'stderr-lib';
import { idSchema, wholeNumberSchema } from '@galvanigraph/core-models';
import type { DestinationResponse, HandOff } from '@galvanigraph/engine';

// A queued send's message id is the text Postgres returns for a bigint.
const positiveWholeNumber = wholeNumberSchema(1);
const handOffSchema = z.object({ channelId: idSchema, messageId: positiveWholeNumber, metaDataId: positiveWholeNumber });
const handedToSchema = z.object({ channelId: idSchema, messageId: positiveWholeNumber });
type HandedTo = z.infer<typeof handedToSchema>;

/** A source status the pipeline writes only when it is done with the message; any failure in it, reported or hidden, is ERROR. */
const FINISHED: ReadonlySet<string> = new Set(['SENT', 'FILTERED', 'ERROR']);
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
  /** The halt and how long to wait for an unfinished target message. The send after it has a time limit of its own. */
  readonly waitUntil: AbortSignal;
  readonly send: () => Promise<Result<DestinationResponse>>;
}

const HALTED = 'HALTED';

interface Earlier {
  readonly to: HandedTo;
  readonly failed: boolean;
}

/**
 * Sends, unless the target finished the message an interrupted send of the same destination handed it:
 * then the send reads as that message did, as a send that returned would have (D-393). When unsure, it
 * sends: a target message that is gone, or is not finished once its channel stops, is sent again.
 */
export async function sendOnce(channelSend: ChannelSend, store: HandOffStore): Promise<Result<DestinationResponse>> {
  const earlier = await finishedBefore(channelSend, store);
  if (earlier === HALTED) return { ok: false, value: null, error: new Error('Interrupted: the channel was halted') } as Result<DestinationResponse>;
  const result = earlier === null ? await channelSend.send() : { ok: true as const, value: asSent(earlier), error: null };
  // A failure that may be retried made no message in the target: a record left by an interrupted send still names its message.
  const settled = result.ok && (result.value.status === 'SENT' || result.value.final === true);
  if (!settled) return result;
  const forgotten = await store.forget(channelSend.key);
  if (!forgotten.ok) store.onUnread(channelSend.key, forgotten.error);
  return result;
}

function asSent({ to, failed }: Earlier): DestinationResponse {
  const id = String(to.messageId);
  return failed
    ? { status: 'ERROR', content: '', errorMessage: `Target channel ${to.channelId} recorded message ${id}, from a send a server stop interrupted, with an ERROR status`, final: true }
    : { status: 'SENT', content: `messageId=${id}` };
}

async function finishedBefore({ key, target, halt, waitUntil }: ChannelSend, store: HandOffStore): Promise<Earlier | null | typeof HALTED> {
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
    if (found !== null && FINISHED.has(found.status ?? '')) {
      store.onRepeat(key, to);
      return { to, failed: found.status === 'ERROR' };
    }
    if (found === null || found.processed) return null;
    if (halt.aborted) return HALTED;
    // Not finished, and nothing finishes it now.
    if (waitUntil.aborted || !store.isStarted(to.channelId)) return null;
    await store.pause(waitUntil);
  }
}

function parsedHandedTo(text: string): HandedTo | null {
  const parsed = tryCatch((): unknown => JSON.parse(text));
  if (!parsed.ok) return null;
  const read = handedToSchema.safeParse(parsed.value);
  return read.success ? read.data : null;
}
