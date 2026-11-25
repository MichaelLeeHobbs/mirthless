import * as fs from 'node:fs/promises';
import * as path from 'node:path';

/** What a platform or a network mount answers when a directory cannot be synced: Windows, and some shares. */
const NO_DIRECTORY_SYNC: readonly unknown[] = ['EPERM', 'EISDIR', 'EACCES', 'EINVAL', 'ENOTSUP'];

/** The file's content is on disk once this resolves. */
export async function syncFile(filePath: string): Promise<void> {
  const handle = await fs.open(filePath, 'r+');
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

/** The directory's entries (a file created or removed in it) are on disk, where the platform can do that. */
export async function syncDirectory(dir: string): Promise<void> {
  try {
    const handle = await fs.open(dir, 'r');
    try {
      await handle.sync();
    } finally {
      await handle.close();
    }
  } catch (err) {
    if (err instanceof Error && 'code' in err && NO_DIRECTORY_SYNC.includes(err.code)) return;
    throw err;
  }
}

/** `mkdir -p`, with what it created on disk. */
export async function makeDirectory(dir: string): Promise<void> {
  const first = await fs.mkdir(dir, { recursive: true });
  if (first === undefined) return;
  let parent = path.dirname(dir);
  while (parent.length >= path.dirname(first).length) {
    await syncDirectory(parent);
    if (parent === path.dirname(parent)) return;
    parent = path.dirname(parent);
  }
}
