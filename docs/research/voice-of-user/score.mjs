// Usage: node docs/research/voice-of-user/score.mjs docs/research/voice-of-user/data [--check|--json]
// Scores each theme (clusters.mjs) from its entries and prints a ranking, a coverage check (every entry in exactly one theme), or JSON.
// Score = 4 x research streams that found it + 2 x log2(1 + sources) + log2(1 + votes/stars) + engines named (max 6).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CLUSTERS, AREAS } from './clusters.mjs';

const FILES = {
  'mirth-github': 'MG', 'oie-bridgelink': 'OB', 'qa-forums': 'QA', 'commercial-reviews': 'CR',
  'social-blogs': 'SB', 'workarounds-paywalls': 'WP', 'oss-modern': 'OS',
};
const dir = process.argv[2];
const mode = process.argv[3] ?? '--rank';

const entries = new Map();
for (const [base, p] of Object.entries(FILES)) {
  let text;
  try { text = readFileSync(join(dir, `${base}.jsonl`), 'utf8'); } catch { continue; }
  text.split(/\r?\n/).filter((l) => l.trim()).forEach((l, i) => entries.set(`${p}${i + 1}`, JSON.parse(l)));
}

const normEngine = (e) => {
  const s = e.toLowerCase();
  if (s.includes('mirth') || s === 'nextgen connect') return 'mirth';
  if (s.includes('intersystems') || s.includes('healthshare') || s.includes('iris') || s.includes('ensemble')) return 'intersystems';
  if (s === 'any' || s === 'all' || s === 'general') return null;
  return s.split(/[ (]/)[0];
};

const seen = new Map();
const scored = CLUSTERS.map((cl) => {
  const streams = new Set();
  const engines = new Set();
  let sources = 0;
  let reactions = 0;
  const evidence = [];
  for (const key of cl.entries) {
    const e = entries.get(key);
    if (!e) { console.error(`missing entry ${key} in ${cl.id}`); continue; }
    if (seen.has(key)) console.error(`duplicate ${key} in ${cl.id} and ${seen.get(key)}`);
    seen.set(key, cl.id);
    streams.add(key.replace(/\d+$/, ''));
    for (const en of e.engines ?? []) { const n = normEngine(en); if (n) engines.add(n); }
    const s = e.signal ?? {};
    sources += Number(s.sources ?? 0);
    reactions += Number(s.reactions ?? s.stars ?? 0);
    evidence.push({ key, url: (e.evidence ?? [])[0], sources: Number(s.sources ?? 0) });
  }
  const score = 4 * streams.size + 2 * Math.log2(1 + sources) + Math.log2(1 + reactions) + Math.min(engines.size, 6);
  evidence.sort((a, b) => b.sources - a.sources);
  return { ...cl, streams: [...streams].sort(), engines: [...engines].sort(), sources, reactions, score: Math.round(score * 10) / 10, evidence };
}).sort((a, b) => b.score - a.score);

if (mode === '--check') {
  const missing = [...entries.keys()].filter((key) => !seen.has(key));
  console.log(`entries ${entries.size}, assigned ${seen.size}, unassigned ${missing.length}`);
  for (const key of missing) {
    const e = entries.get(key);
    console.log(`${key} ${e.category} ${(e.signal?.sources ?? 0)}/${e.signal?.reactions ?? e.signal?.stars ?? 0} ${String(e.title).slice(0, 100)}`);
  }
} else if (mode === '--json') {
  console.log(JSON.stringify(scored.map(({ evidence, ...rest }) => ({ ...rest, evidence: evidence.slice(0, 3) })), null, 1));
} else {
  scored.forEach((s, i) => console.log(`${i + 1}. ${s.score} ${s.id} [${s.verdict}/${s.status}] streams=${s.streams.length} src=${s.sources} react=${s.reactions} eng=${s.engines.length} ${s.title.slice(0, 80)}`));
  console.log(Object.keys(AREAS).length, 'areas');
}
