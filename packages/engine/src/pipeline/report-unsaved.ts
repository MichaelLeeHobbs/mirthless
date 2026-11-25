import type { Result } from '@galvanigraph/core-util';
import type { StoreFailure } from './message-processor.js';

/** For writes made after the message can no longer be failed cleanly: waits for them and reports one that did not succeed. */
export async function reportUnsaved(
  writes: ReadonlyArray<Promise<Result<unknown>>>,
  unsaved: Omit<StoreFailure, 'errorMessage'>,
  onStoreFailure: ((failure: StoreFailure) => void) | undefined,
): Promise<void> {
  const failed = (await Promise.all(writes)).find((r) => !r.ok);
  if (failed && !failed.ok) onStoreFailure?.({ ...unsaved, errorMessage: failed.error.message });
}
