/**
 * What is left to write in notes/ for the PRs in data/: PRs without a notes
 * file, notes written for an older head commit, declarations without a
 * section, and sections that match no declaration. It also spots stacked PRs
 * (a PR whose diff repeats most of another one's), for the `stacked-on:` field.
 *
 *   node scripts/notes-todo.mjs [--author <login> ...] [--out <dir>] [--json]
 *
 * With --out, each PR that needs work gets <dir>/<number>.diff: its title,
 * head commit, what is missing, then the patch of every file. That is the
 * input the notes brief (.claude/skills/update-review-site/notes-brief.md)
 * expects. Exits 0 either way: an empty list is the goal, not a requirement.
 */
import { mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { analyse } from './analyse.mjs';
import { ROOT, authorsFrom, readSnapshot } from './lib.mjs';

const { values: args } = parseArgs({
  options: {
    author: { type: 'string', multiple: true },
    out: { type: 'string' },
    json: { type: 'boolean', default: false },
  },
});

/**
 * Stacked PRs of one author: a PR whose diff repeats most added lines of a
 * smaller PR sits on it. Only the PRs directly below are kept (a stack
 * A on B on C gives A: [B], not [B, C]).
 */
function stacks(prs) {
  const added = new Map(
    prs.map((p) => [
      p.number,
      new Set(p.files.flatMap((f) => f.patch.split('\n').filter((l) => l[0] === '+' && l.trim().length > 8).map((l) => `${f.filename}|${l}`))),
    ]),
  );
  const below = new Map(prs.map((p) => [p.number, new Set()]));
  for (const a of prs) {
    for (const b of prs) {
      const A = added.get(a.number);
      const B = added.get(b.number);
      if (a === b || !B.size || B.size >= A.size) continue;
      let shared = 0;
      for (const x of B) if (A.has(x)) shared++;
      if (shared / B.size > 0.6) below.get(a.number).add(b.number);
    }
  }
  const direct = new Map();
  for (const [a, bs] of below) {
    direct.set(a, [...bs].filter((b) => ![...bs].some((c) => c !== b && below.get(c).has(b))).sort((x, y) => x - y));
  }
  return direct;
}

const todo = [];
for (const author of authorsFrom(args.author)) {
  const snap = readSnapshot(author);
  if (!snap) {
    todo.push({ author, problem: `no snapshot in data/${author}/` });
    continue;
  }
  const stacked = stacks(snap.prs);
  for (const a of snap.prs.map(analyse)) {
    // Anonymous instances are optional: an `## instance` section covers them, in order.
    const missing = a.decls.filter((d) => !d.note && d.name).map((d) => d.name);
    const item = {
      author,
      number: a.pr.number,
      title: a.pr.title,
      head: a.pr.head_sha,
      notes: a.notes ? (a.stale ? 'stale' : 'ok') : 'none',
      notes_head: a.notes?.head ?? null,
      missing,
      unmatched: a.unmatched,
      declarations: a.decls.length,
      stacked_on: stacked.get(a.pr.number),
      notes_stacked_on: a.notes?.['stacked-on']?.split(/[\s,]+/).filter(Boolean).map(Number) ?? [],
    };
    if (item.notes !== 'ok' || missing.length || item.unmatched.length) todo.push(item);
  }
}

// Notes of PRs that are no longer open for any configured author: merged or closed.
const open = new Set();
for (const author of authorsFrom()) for (const n of readSnapshot(author)?.index.numbers ?? []) open.add(n);
const orphans = args.author ? [] : readdirSync(join(ROOT, 'notes')).filter((f) => /^\d+\.md$/.test(f) && !open.has(Number(f.slice(0, -3))));

if (args.out) {
  const dir = resolve(args.out);
  mkdirSync(dir, { recursive: true });
  for (const t of todo.filter((t) => t.number)) {
    const pr = readSnapshot(t.author).prs.find((p) => p.number === t.number);
    let out = `PR #${pr.number}: ${pr.title}\nhead ${pr.head_sha}\n`;
    if (t.notes === 'stale') out += `notes written for ${t.notes_head}: re-check every section against this diff\n`;
    if (t.stacked_on.length) out += `stacked on ${t.stacked_on.map((n) => `#${n}`).join(' ')} (their diffs are in this directory if they need notes too): put \`stacked-on: ${t.stacked_on.join(' ')}\` in the front matter\n`;
    if (t.missing.length) out += `declarations without a section: ${t.missing.join(', ')}\n`;
    if (t.unmatched.length) out += `sections matching no declaration: ${t.unmatched.join(', ')}\n`;
    out += '\n';
    for (const f of pr.files) out += `=== ${f.filename} (${f.status})\n${f.patch}\n\n`;
    writeFileSync(join(dir, `${pr.number}.diff`), out);
  }
}

if (args.json) console.log(JSON.stringify({ todo, orphans }, null, 1));
else if (!todo.length) console.log('notes/ covers every declaration of every PR.');
else {
  for (const t of todo) {
    if (t.problem) {
      console.log(`@${t.author}: ${t.problem}`);
      continue;
    }
    const what = [
      t.notes === 'none' ? 'no notes file' : t.notes === 'stale' ? `notes for ${t.notes_head.slice(0, 7)}, PR at ${t.head.slice(0, 7)}` : '',
      t.missing.length ? `missing: ${t.missing.join(', ')}` : '',
      t.unmatched.length ? `unmatched: ${t.unmatched.join(', ')}` : '',
      t.stacked_on.length ? `stacked on ${t.stacked_on.map((n) => `#${n}`).join(' ')}` : '',
    ].filter(Boolean);
    console.log(`@${t.author} #${t.number} (${t.declarations} decl.): ${what.join('; ')}`);
  }
  if (args.out) console.log(`diffs written to ${args.out}/`);
}
if (!args.json && orphans.length) console.log(`notes of PRs no longer open (can be deleted): ${orphans.join(' ')}`);
