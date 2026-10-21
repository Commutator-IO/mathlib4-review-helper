import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const DATA = join(ROOT, 'data');
export const config = JSON.parse(readFileSync(join(ROOT, 'config.json'), 'utf8'));

/** Replace data/ with one file per PR plus an index. */
export function writeSnapshot(prs, source) {
  rmSync(join(DATA, 'prs'), { recursive: true, force: true });
  mkdirSync(join(DATA, 'prs'), { recursive: true });
  for (const pr of prs) {
    writeFileSync(join(DATA, 'prs', `${pr.number}.json`), JSON.stringify(pr, null, 1) + '\n');
  }
  const index = {
    repo: config.repo,
    author: config.author,
    source,
    fetched_at: new Date().toISOString(),
    numbers: prs.map((p) => p.number).sort((a, b) => b - a),
  };
  writeFileSync(join(DATA, 'index.json'), JSON.stringify(index, null, 1) + '\n');
  console.log(`data/: ${prs.length} PRs (${source})`);
}
