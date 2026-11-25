import * as fs from 'node:fs/promises';
import { isMissing } from './file-roots.js';

function nameTaken(from: string, to: string): Error {
  return new Error(`"${to}" already exists, so "${from}" was not moved there`);
}

async function isSameFile(a: string, b: string): Promise<boolean> {
  try {
    const [first, second] = await Promise.all([fs.lstat(a, { bigint: true }), fs.lstat(b, { bigint: true })]);
    return first.ino === second.ino && first.dev === second.dev;
  } catch {
    return false;
  }
}

/** Where there are no hard links (FAT, some network shares, another user's file), a name taken in between is replaced. */
async function checkThenRename(from: string, to: string): Promise<void> {
  const taken = await fs.lstat(to).then(() => true, (err: unknown) => {
    if (isMissing(err)) return false;
    throw err;
  });
  if (taken) throw nameTaken(from, to);
  await fs.rename(from, to);
}

/** Rejects, leaving both files as they are, when `to` exists: a rename would replace it. */
export async function moveWithoutReplacing(from: string, to: string): Promise<void> {
  try {
    await fs.link(from, to);
  } catch (err) {
    if (err instanceof Error && 'code' in err && err.code === 'EEXIST') throw nameTaken(from, to);
    await checkThenRename(from, to);
    return;
  }
  try {
    await fs.unlink(from);
  } catch (err) {
    // Gone under its old name already: it is where it should be.
    if (isMissing(err)) return;
    // Two names of one file: a later write to one would change the other. Only a copy that
    // still has its first name is taken away.
    if (await isSameFile(from, to)) await fs.unlink(to);
    throw err;
  }
}
