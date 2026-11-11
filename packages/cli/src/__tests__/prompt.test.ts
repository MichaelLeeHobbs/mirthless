import { describe, it, expect } from 'vitest';
import { PassThrough } from 'node:stream';
import { ask } from '../lib/prompt.js';

function streams(): { input: PassThrough; output: PassThrough; shown: () => string } {
  const input = new PassThrough();
  const output = new PassThrough();
  const chunks: Buffer[] = [];
  output.on('data', (c: Buffer) => chunks.push(c));
  return { input, output, shown: () => Buffer.concat(chunks).toString('utf8') };
}

describe('ask', () => {
  it('returns the typed answer and shows the question', async () => {
    const s = streams();
    const answer = ask('Username: ', { input: s.input, output: s.output, hidden: false });
    s.input.write('admin\n');

    expect(await answer).toBe('admin');
    expect(s.shown()).toContain('Username: ');
  });

  it('never writes a hidden answer to the terminal', async () => {
    const s = streams();
    const answer = ask('Password: ', { input: s.input, output: s.output, hidden: true });
    s.input.write('s3cret!\n');

    expect(await answer).toBe('s3cret!');
    expect(s.shown()).toContain('Password: ');
    expect(s.shown()).not.toContain('s3cret!');
  });
});
