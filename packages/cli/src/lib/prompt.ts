// ===========================================
// CLI Prompt
// ===========================================
// Asks one question on the terminal. A hidden answer (a password) is never
// echoed back.

import { createInterface } from 'node:readline/promises';
import { Writable } from 'node:stream';

/** Where to read the answer from and show the question. */
export interface AskOptions {
  readonly input: NodeJS.ReadableStream;
  readonly output: NodeJS.WritableStream;
  readonly hidden: boolean;
}

/**
 * Ask a question and return the answer.
 *
 * @param question - Text shown before the cursor.
 * @param options - Streams to use, and whether to hide what is typed.
 */
export async function ask(question: string, options: AskOptions): Promise<string> {
  let muted = false;
  const output = new Writable({
    write(chunk: Buffer | string, _encoding, done): void {
      if (!muted) options.output.write(chunk);
      done();
    },
  });
  const rl = createInterface({ input: options.input, output, terminal: true });
  try {
    const answer = rl.question(question);
    // readline writes the question synchronously, then echoes each keystroke.
    muted = options.hidden;
    const value = await answer;
    if (options.hidden) options.output.write('\n');
    return value;
  } finally {
    rl.close();
  }
}
