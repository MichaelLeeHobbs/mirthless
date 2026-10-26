import { describe, it, expect } from 'vitest';
import { rankCommands, isPaletteShortcut, type Command } from '../command-search.js';

const COMMANDS: readonly Command[] = [
  { id: 'dash', label: 'Dashboard', section: 'Pages' },
  { id: 'alerts', label: 'Alerts', section: 'Pages' },
  { id: 'new-alert', label: 'Create alert', section: 'Actions', keywords: 'new add' },
  { id: 'adt-msg', label: 'ADT Inbound messages', section: 'Channels' },
  { id: 'lab', label: 'Lab results to EHR', section: 'Channels' },
];

const ids = (list: readonly Command[]): string[] => list.map((c) => c.id);

describe('rankCommands', () => {
  it('returns everything in order for an empty or blank query', () => {
    expect(ids(rankCommands(COMMANDS, ''))).toEqual(ids(COMMANDS));
    expect(ids(rankCommands(COMMANDS, '   '))).toEqual(ids(COMMANDS));
  });

  it('ranks a word-start match above a match inside a word', () => {
    expect(ids(rankCommands(COMMANDS, 'al'))).toEqual(['alerts', 'new-alert']);
    expect(ids(rankCommands(COMMANDS, 'ert'))).toEqual(['alerts', 'new-alert']);
  });

  it('ranks a label match above a section or keyword match', () => {
    expect(ids(rankCommands(COMMANDS, 'new'))).toEqual(['new-alert']);
    expect(ids(rankCommands(COMMANDS, 'channels'))).toEqual(['adt-msg', 'lab']);
  });

  it('requires every word to match, in any order and case', () => {
    expect(ids(rankCommands(COMMANDS, 'MESSAGES adt'))).toEqual(['adt-msg']);
    expect(ids(rankCommands(COMMANDS, 'adt lab'))).toEqual([]);
  });

  it('returns nothing when no command matches', () => {
    expect(rankCommands(COMMANDS, 'zzz')).toEqual([]);
  });
});

describe('isPaletteShortcut', () => {
  const key = (k: string, mods: Partial<Record<'ctrlKey' | 'metaKey' | 'shiftKey' | 'altKey', boolean>> = {}): Parameters<typeof isPaletteShortcut>[0] =>
    ({ key: k, ctrlKey: false, metaKey: false, shiftKey: false, altKey: false, ...mods });

  it('accepts Ctrl+K and Cmd+K', () => {
    expect(isPaletteShortcut(key('k', { ctrlKey: true }))).toBe(true);
    expect(isPaletteShortcut(key('K', { metaKey: true }))).toBe(true);
  });

  it('rejects a bare K and K with Shift or Alt', () => {
    expect(isPaletteShortcut(key('k'))).toBe(false);
    expect(isPaletteShortcut(key('k', { ctrlKey: true, shiftKey: true }))).toBe(false);
    expect(isPaletteShortcut(key('k', { ctrlKey: true, altKey: true }))).toBe(false);
  });

  it('rejects other keys with Ctrl', () => {
    expect(isPaletteShortcut(key('j', { ctrlKey: true }))).toBe(false);
  });
});
