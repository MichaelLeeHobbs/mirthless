export interface Command {
  readonly id: string;
  readonly label: string;
  readonly section: string;
  readonly keywords?: string;
}

const WORD_START = 3;
const MID_LABEL = 2;
const SECTION_OR_KEYWORD = 1;

function scoreWord(command: Command, word: string): number {
  const label = command.label.toLowerCase();
  const index = label.indexOf(word);
  if (index === 0 || (index > 0 && /[\s\-_/(]/.test(label.charAt(index - 1)))) return WORD_START;
  if (index > 0) return MID_LABEL;
  const extra = `${command.section} ${command.keywords ?? ''}`.toLowerCase();
  return extra.includes(word) ? SECTION_OR_KEYWORD : 0;
}

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

export function isPaletteShortcut(e: Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'metaKey' | 'shiftKey' | 'altKey'>): boolean {
  return e.key.toLowerCase() === 'k' && (e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey;
}
