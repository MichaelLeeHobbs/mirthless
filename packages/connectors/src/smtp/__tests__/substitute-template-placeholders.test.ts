// ===========================================
// SMTP templates: the placeholder rule
// ===========================================

import { describe, it, expect } from 'vitest';
import { substituteTemplate } from '../smtp-dispatcher.js';
import type { ConnectorMessage } from '../../base.js';

const message: ConnectorMessage = {
  channelId: 'ch-1',
  messageId: 42,
  metaDataId: 1,
  content: 'ignored',
  dataType: 'RAW',
  variables: { x: 'v', none: null, obj: { a: 1 }, big: 10n, ref: '${x}', msg: 'from a variable' },
};

describe('substituteTemplate', () => {
  it.each([
    ['a built-in name', '<${msg}>', '<BODY>'],
    ['a padded built-in name', '<${ messageId }>', '<42>'],
    ['a built-in over a variable of the same name', '<${msg}>', '<BODY>'],
    ['a plain variable', '<${x}>', '<v>'],
    ['a padded variable', '<${ x }>', '<v>'],
    ['a missing name', '<${y}>', '<${y}>'],
    ['a null value', '<${none}>', '<${none}>'],
    ['an object value', '<${obj}>', '<{"a":1}>'],
    ['a bigint value', '<${big}>', '<10>'],
    ['an inherited key', '<${toString}>', '<${toString}>'],
    ['a value containing ${x}', '<${ref}>', '<${x}>'],
    ['content containing ${x}', '<${msg}>', '<BODY>'],
  ])('fills %s by the shared rule', (_label, template, expected) => {
    expect(substituteTemplate(template, 'BODY', message)).toBe(expected);
  });

  it('does not expand placeholders in the content', () => {
    expect(substituteTemplate('${msg}', 'has ${x}', message)).toBe('has ${x}');
  });
});
