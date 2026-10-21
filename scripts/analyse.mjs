/**
 * What the site knows about one PR: its diff cut into declarations, the
 * transcription of each (notes/<number>.md), the style hints, and which GTD
 * list it belongs to. Shared by the build and by notes-todo.mjs.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from './lib.mjs';
import { fileHints, hints, parsePatch, segment } from './lean.mjs';
import { parseNotes } from './markdown.mjs';

// ---------------------------------------------------------------------------
// What each PR needs next

export const TOPIC = /^t-/;
export const ALMOST = ['ready-to-merge', 'maintainer-merge', 'delegated', 'auto-merge-after-CI', 'bors'];

/** Latest review state per reviewer (comments do not override a verdict). */
export function verdicts(pr) {
  const by = new Map();
  for (const r of pr.reviews ?? []) {
    if (r.author === pr.author) continue;
    if (r.state === 'COMMENTED' && by.has(r.author)) continue;
    by.set(r.author, r.state);
  }
  return by;
}

export function bucket(pr) {
  const v = [...verdicts(pr).values()];
  const why = [];
  if (pr.labels.includes('blocked-by-other-PR')) return { id: 'blocked', why: ['blocked by another PR'] };
  if (pr.draft) why.push('draft');
  if (pr.labels.includes('awaiting-author')) why.push('awaiting-author');
  if (v.includes('CHANGES_REQUESTED')) why.push('changes requested');
  if (pr.checks?.state === 'failure') why.push('CI failing');
  if (pr.mergeable_state === 'dirty') why.push('merge conflict');
  if (why.length) return { id: 'author', why };
  if (pr.labels.some((l) => ALMOST.includes(l))) return { id: 'almost', why: pr.labels.filter((l) => ALMOST.includes(l)) };
  return { id: 'ready', why: [] };
}

export const BUCKETS = [
  { id: 'ready', title: 'Next actions: ready for review', blurb: 'Open, not draft, nothing pending on the author. Smallest first: each one is a short session.' },
  { id: 'almost', title: 'Almost there', blurb: 'A maintainer has delegated or marked them for merge.' },
  { id: 'author', title: 'Waiting for the author', blurb: 'Draft, CI red, changes requested or a merge conflict. Nothing to review until it moves.' },
  { id: 'blocked', title: 'Waiting for another PR', blurb: 'Stacked on a PR that has to land first.' },
];

// ---------------------------------------------------------------------------
// One PR, analysed

export function analyse(pr) {
  const notesPath = join(ROOT, 'notes', `${pr.number}.md`);
  const notes = existsSync(notesPath) ? parseNotes(readFileSync(notesPath, 'utf8')) : null;
  // A stacked PR (`stacked-on: <number> [<number>…]` in its notes) borrows the sections of
  // the PRs below it, and of the PRs below those, for the declarations it repeats.
  const borrow = (n, seen) => {
    const p = join(ROOT, 'notes', `${n}.md`);
    if (seen.has(n) || !existsSync(p)) return;
    seen.add(n);
    const below = parseNotes(readFileSync(p, 'utf8'));
    for (const [k, v] of below.decls) if (k !== '*' && !notes.decls.has(k)) notes.decls.set(k, v);
    for (const m of (below['stacked-on'] ?? '').split(/[\s,]+/).filter(Boolean)) borrow(m, seen);
  };
  if (notes?.['stacked-on']) {
    const seen = new Set([String(pr.number)]);
    for (const m of notes['stacked-on'].split(/[\s,]+/).filter(Boolean)) borrow(m, seen);
  }

  // Sections are consumed in order, so same-named declarations get their own.
  const taken = new Map();
  const take = (k) => {
    const i = taken.get(k) ?? 0;
    const list = notes.decls.get(k);
    if (i >= list.length) return null;
    taken.set(k, i + 1);
    return list[i];
  };
  const noteFor = (name) => {
    if (!notes || !name) return null;
    const bare = (n) => n.replace(/^_root_\./, '');
    const last = (n) => bare(n).split('.').at(-1);
    for (const match of [(k) => k === name, (k) => bare(k) === bare(name), (k) => last(k) === last(name)]) {
      for (const k of notes.decls.keys()) {
        if (!match(k)) continue;
        const v = take(k);
        if (v) return v;
      }
    }
    return null;
  };
  const files = pr.files.map((file) => {
    const hunks = parsePatch(file.patch).map((h) => ({
      ...h,
      segs: segment(h.lines, h.header).map((sg) => {
        const changed = sg.lines.some((l) => l.k !== ' ' && l.s.trim() !== '');
        const key = `${file.filename}::${sg.name || sg.kind}@${sg.lines.find((l) => l.new)?.new ?? 0}`;
        const own = sg.kind === 'other' ? null : noteFor(sg.name || (sg.kind === 'instance' ? 'instance' : ''));
        // `## *` describes, once, the change shared by every declaration without its own section
        // (a rename, a generalisation across a refactor).
        const shared = !own && sg.kind !== 'other' && changed ? notes?.decls.get('*')?.[0] ?? null : null;
        return { ...sg, changed, key, hints: hints(sg, file), note: own ?? shared, shared: !!shared };
      }),
    }));
    return { ...file, hunks, fileHints: fileHints(file, hunks) };
  });
  const decls = files.flatMap((f) => f.hunks.flatMap((h) => h.segs.filter((s) => s.kind !== 'other' && s.changed)));
  const unmatched = notes ? [...notes.decls].filter(([k, v]) => k !== '*' && (taken.get(k) ?? 0) < v.length).map(([k]) => k) : [];
  const hintCount = files.reduce((n, f) => n + f.fileHints.length + f.hunks.reduce((m, h) => m + h.segs.reduce((k, s) => k + s.hints.length, 0), 0), 0);
  return {
    pr,
    notes,
    files,
    decls,
    unmatched,
    hintCount,
    covered: decls.filter((d) => d.note).length,
    stale: notes?.head && notes.head !== pr.head_sha,
    bucket: bucket(pr),
    additions: pr.files.reduce((n, f) => n + f.additions, 0),
    deletions: pr.files.reduce((n, f) => n + f.deletions, 0),
  };
}
