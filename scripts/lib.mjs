import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const DATA = join(ROOT, 'data');
export const config = JSON.parse(readFileSync(join(ROOT, 'config.json'), 'utf8'));

/** A GitHub login: it names a directory, so nothing else gets through. */
export function checkLogin(login) {
  if (!/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/.test(login ?? '')) throw new Error(`not a GitHub login: ${login}`);
  return login;
}

/** The authors to work on: those given on the command line, else every one in config.json. */
export function authorsFrom(args) {
  const list = args?.length ? args : config.authors;
  return list.map(checkLogin);
}

export const dataDir = (author) => join(DATA, checkLogin(author));

/** The snapshot of one author: { index, prs }, or null if there is none. */
export function readSnapshot(author) {
  const dir = dataDir(author);
  if (!existsSync(join(dir, 'index.json'))) return null;
  const index = JSON.parse(readFileSync(join(dir, 'index.json'), 'utf8'));
  const prs = index.numbers.map((n) => JSON.parse(readFileSync(join(dir, 'prs', `${n}.json`), 'utf8')));
  return { index, prs };
}

/** Replace data/<author>/ with one file per PR plus an index. */
export function writeSnapshot(prs, source, author) {
  const dir = dataDir(author);
  rmSync(join(dir, 'prs'), { recursive: true, force: true });
  mkdirSync(join(dir, 'prs'), { recursive: true });
  for (const pr of prs) {
    writeFileSync(join(dir, 'prs', `${pr.number}.json`), JSON.stringify(pr, null, 1) + '\n');
  }
  const index = {
    repo: config.repo,
    author,
    source,
    fetched_at: new Date().toISOString(),
    numbers: prs.map((p) => p.number).sort((a, b) => b - a),
  };
  writeFileSync(join(dir, 'index.json'), JSON.stringify(index, null, 1) + '\n');
  console.log(`data/${author}/: ${prs.length} PRs (${source})`);
}
