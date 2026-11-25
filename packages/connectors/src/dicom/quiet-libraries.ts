// The connector reports failures itself. At info dcmjs-dimse prints every association, and at warn
// the dcmjs it runs on prints values, such as a UID that it cuts short (#321).

import { createRequire } from 'node:module';
import pkg from 'dcmjs-dimse';

interface LibraryLog {
  setLevel(level: 'error' | 'silent'): void;
  getLogger(name: string): LibraryLog;
}

pkg.log.setLevel('warn');

// Its own copy, whatever other version is installed.
const requireOfDimse = createRequire(createRequire(import.meta.url).resolve('dcmjs-dimse'));
const dcmjs = requireOfDimse('dcmjs') as { readonly log: LibraryLog };
dcmjs.log.setLevel('error');
// Prints bytes of a dataset it cannot read as a value representation and a length.
dcmjs.log.getLogger('validation.dcmjs').setLevel('silent');
