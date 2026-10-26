// ===========================================
// Command Search
// ===========================================
// Ranking for the Ctrl+K command palette. Pure functions, no React, so the
// matching rules are easy to test.

/** One thing the palette can do: open a page or run an action. */
export interface Command {
  readonly id: string;
  readonly label: string;
  /** Group heading, e.g. "Pages", "Channels", "Actions". Also searchable. */
  readonly section: string;
  /** Extra words that should find this command, e.g. "new add" for "Create alert". */
  readonly keywords?: string;
}

const WORD_START = 3;
const MID_LABEL = 2;
const SECTION_OR_KEYWORD = 1;

/** How well one query word matches a command, or 0 when it doesn't match. */
function scoreWord(command: Command, word: string): number {
  const label = command.label.toLowerCase();
  const index = label.indexOf(word);
  if (index === 0 || (index > 0 && /[\s\-_/(]/.test(label.charAt(index - 1)))) return WORD_START;
  if (index > 0) return MID_LABEL;
  const extra = `${command.section} ${command.keywords ?? ''}`.toLowerCase();
  return extra.includes(word) ? SECTION_OR_KEYWORD : 0;
}

/**
 * Filter and order commands for a query. Every query word must match the
 * label, section or keywords. A word at the start of a label word ranks above
 * one inside a word, which ranks above a section or keyword match. Ties keep
 * their original order. An empty query returns the list unchanged.
 */
export function rankCommands<T extends Command>(commands: readonly T[], query: string): readonly T[] {
  const words = query.toLowerCase().split(/\s+/).filter((w) => w.length > 0);
  if (words.length === 0) return commands;
  const scored: Array<{ readonly command: T; readonly score: number; readonly order: number }> = [];
  commands.forEach((command, order) => {
    let score = 0;
    for (const word of words) {
      const s = scoreWord(command, word);
      if (s === 0) return;
      score += s;
    }
    scored.push({ command, score, order });
  });
  scored.sort((a, b) => b.score - a.score || a.order - b.order);
  return scored.map((s) => s.command);
}

/** True for Ctrl+K (or Cmd+K on a Mac), the shortcut that opens the palette. */
export function isPaletteShortcut(e: Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'metaKey' | 'shiftKey' | 'altKey'>): boolean {
  return e.key.toLowerCase() === 'k' && (e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey;
}
