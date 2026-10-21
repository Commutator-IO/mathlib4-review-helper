/**
 * Offline snapshot of the PRs, from a local mathlib4 clone instead of the
 * GitHub API. Useful where the API is not reachable (no token, a sandbox).
 *
 *   node scripts/snapshot-git.mjs --mathlib ../mathlib4 --meta meta.tsv
 *
 * The clone must have the PR heads fetched as refs/remotes/pr/<number>:
 *
 *   git fetch origin +refs/pull/<n>/head:refs/remotes/pr/<n> ...
 *
 * `meta.tsv` gives what git does not know: one line per PR,
 * `number<TAB>title<TAB>label,label`. Reviews, comments, CI state and the
 * draft flag are unknown in a git snapshot; the site shows them as such.
 * The files written have the same shape as those of fetch.mjs.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { config, writeSnapshot } from './lib.mjs';

const { values: args } = parseArgs({
  options: {
    mathlib: { type: 'string' },
    meta: { type: 'string' },
    base: { type: 'string', default: 'origin/master' },
  },
});
if (!args.mathlib || !args.meta) {
  console.error('usage: snapshot-git.mjs --mathlib <clone> --meta <meta.tsv>');
  process.exit(2);
}

const git = (...a) =>
  execFileSync('git', ['-C', args.mathlib, ...a], { encoding: 'utf8', maxBuffer: 64 << 20 }).trimEnd();

const meta = readFileSync(args.meta, 'utf8')
  .split('\n')
  .filter((l) => l.trim())
  .map((l) => {
    const [number, title, labels = ''] = l.split('\t');
    return { number: Number(number), title, labels: labels.split(',').filter(Boolean) };
  });

const prs = meta.map(({ number, title, labels }) => {
  const head = git('rev-parse', `refs/remotes/pr/${number}`);
  const base = git('merge-base', args.base, head);
  const files = git('diff', '--numstat', base, head)
    .split('\n')
    .filter(Boolean)
    .map((l) => {
      const [add, del, filename] = l.split('\t');
      const status = git('diff', '--name-status', base, head, '--', filename).split('\t')[0];
      // GitHub's `patch` field starts at the first hunk header.
      const diff = git('diff', '-U3', base, head, '--', filename);
      const patch = diff.slice(diff.indexOf('\n@@') + 1);
      return {
        filename,
        status: { A: 'added', M: 'modified', D: 'removed' }[status[0]] ?? 'modified',
        additions: Number(add),
        deletions: Number(del),
        patch,
      };
    });
  const updated = git('log', '-1', '--format=%cI', head);
  return {
    number,
    title,
    url: `https://github.com/${config.repo}/pull/${number}`,
    author: config.author,
    draft: null,
    labels,
    body: '',
    head_sha: head,
    base_sha: base,
    created_at: null,
    updated_at: updated,
    commits: Number(git('rev-list', '--count', `${base}..${head}`)),
    files,
    reviews: null,
    comments: null,
    review_comments: null,
    checks: null,
  };
});

writeSnapshot(prs, 'git');
