/**
 * Build the site into dist/ from data/<author>/ (the PR snapshots) and
 * notes/ (the plain-language transcriptions), for every author in config.json.
 *
 *   index.html                 the list of queues, one per author
 *   <author>/index.html        the queue: that author's PRs sorted into GTD lists
 *   <author>/pr/<number>.html  one review page per PR: Lean code beside its transcription
 */
import { createHash } from 'node:crypto';
import { cpSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ALMOST, BUCKETS, TOPIC, analyse, verdicts } from './analyse.mjs';
import { ROOT, authorsFrom, config, readSnapshot } from './lib.mjs';
import { docstring, esc, highlightLines } from './lean.mjs';
import { inline, markdown } from './markdown.mjs';

const DIST = join(ROOT, 'dist');
// The author whose pages are being written: { author, index }.
let site = null;
const ctx = { repo: config.repo };
const short = (sha) => sha?.slice(0, 7) ?? '';
const blob = (pr, path, a, b) => `https://github.com/${config.repo}/blob/${pr.head_sha}/${path}#L${a}${b && b !== a ? `-L${b}` : ''}`;
const diffAnchor = (pr, path) => `${pr.url}/files#diff-${createHash('sha256').update(path).digest('hex')}`;
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;

function ago(iso) {
  if (!iso) return '';
  const d = (Date.parse(site.index.fetched_at) - Date.parse(iso)) / 864e5;
  return d < 1 ? 'today' : d < 2 ? 'yesterday' : `${Math.floor(d)} days ago`;
}

// ---------------------------------------------------------------------------
// HTML

function page({ title, body, depth = 0, cls = '', script = '' }) {
  const up = depth ? '../'.repeat(depth) : '';
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<link rel="stylesheet" href="${up}vendor/katex/katex.min.css">
<link rel="stylesheet" href="${up}style.css">
<link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'><text y='13' font-size='13'>∀</text></svg>">
</head>
<body class="${cls}">
<header class="top"><a class="brand" href="${up}index.html">${esc(config.siteTitle)}</a><span class="who">${site ? `open PRs by <a href="https://github.com/${config.repo}/pulls?q=is%3Apr+is%3Aopen+author%3A${site.author}">@${esc(site.author)}</a> on ` : ''}${esc(config.repo)}</span><button class="theme" type="button" title="Toggle dark mode" aria-label="Toggle dark mode">◐</button></header>
${body}
<footer class="foot">${site ? `Snapshot ${esc(site.index.fetched_at.slice(0, 16).replace('T', ' '))} UTC from ${site.index.source === 'api' ? 'the GitHub API' : 'git (no reviews, CI or draft state)'} · ` : ''}<a href="${up}about.html">About</a> · <a href="https://github.com/${config.issuesRepo}">Source</a></footer>
<script src="${up}app.js"></script>
${script}
</body>
</html>
`;
}

function chips(a) {
  const { pr, bucket: b } = a;
  const out = [];
  for (const l of pr.labels) {
    const c = TOPIC.test(l) ? 'topic' : l === 'blocked-by-other-PR' || l === 'awaiting-author' ? 'warn' : ALMOST.includes(l) ? 'good' : 'label';
    if (l === 'new-contributor' || l === 'LLM-generated') continue;
    out.push(`<span class="chip ${c}">${esc(l)}</span>`);
  }
  if (pr.draft) out.push('<span class="chip warn">draft</span>');
  if (pr.checks) out.push(`<span class="chip ci-${pr.checks.state}" title="${pr.checks.success}/${pr.checks.total} checks passed">CI ${esc(pr.checks.state)}</span>`);
  for (const [who, st] of verdicts(pr)) {
    if (st === 'APPROVED') out.push(`<span class="chip good">✓ ${esc(who)}</span>`);
    if (st === 'CHANGES_REQUESTED') out.push(`<span class="chip warn">✗ ${esc(who)}</span>`);
  }
  // The reasons not already shown by a label (a blocked PR carries its label).
  if (b.id !== 'blocked') for (const w of b.why) if (!out.some((o) => o.includes(`>${w}<`))) out.push(`<span class="chip warn">${esc(w)}</span>`);
  return out.join(' ');
}

function card(a) {
  const { pr } = a;
  const talk = (pr.comments?.filter((c) => !/\[bot\]$/.test(c.author ?? '')).length ?? 0) + (pr.review_comments?.length ?? 0);
  return `<li class="card" data-pr="${pr.number}" data-decls="${a.decls.length}" data-topic="${esc(pr.labels.filter((l) => TOPIC.test(l)).join(' '))}" data-head="${pr.head_sha}">
  <a class="card-link" href="pr/${pr.number}.html">
    <span class="num">#${pr.number}</span>
    <span class="title">${inline(pr.title)}</span>
  </a>
  <div class="meta">
    <span class="size" title="lines added / removed"><span class="add">+${a.additions}</span> <span class="del">−${a.deletions}</span></span>
    <span>${plural(a.decls.length, 'declaration')}</span>
    <span title="declarations with a plain-language transcription">${a.covered}/${a.decls.length} transcribed${a.stale ? ' <span class="stale" title="written for an earlier revision">(older rev.)</span>' : ''}</span>
    ${a.hintCount ? `<span class="hint-count">${plural(a.hintCount, 'hint')}</span>` : ''}
    ${talk ? `<span>💬 ${talk}</span>` : ''}
    <span class="when">updated ${ago(pr.updated_at)}</span>
    <span class="progress" hidden></span>
  </div>
  <div class="chips">${chips(a)}</div>
</li>`;
}

function indexPage(all) {
  const topics = [...new Set(all.flatMap((a) => a.pr.labels.filter((l) => TOPIC.test(l))))].sort();
  const lists = BUCKETS.map((b) => {
    const items = all.filter((a) => a.bucket.id === b.id).sort((x, y) => x.additions - y.additions || y.pr.number - x.pr.number);
    if (!items.length) return '';
    return `<section class="bucket" id="${b.id}"><h2>${esc(b.title)} <span class="count">${items.length}</span></h2><p class="blurb">${esc(b.blurb)}</p><ol class="cards">${items.map(card).join('\n')}</ol></section>`;
  }).join('\n');
  const totalAdd = all.reduce((n, a) => n + a.additions, 0);
  const totalDecls = all.reduce((n, a) => n + a.decls.length, 0);
  const body = `<main class="queue" data-repo="${config.repo}">
<section class="intro">
  <p class="crumbs"><a href="../index.html">← all queues</a></p>
  <h1>Review queue of <a href="https://github.com/${site.author}">@${esc(site.author)}</a></h1>
  <p>${plural(all.length, 'open PR')}, ${totalAdd} added lines, ${plural(totalDecls, 'declaration')}. Each review page puts the Lean code of every declaration beside a plain-language transcription of what it states and how it is proved, flags style points a bot can see, and lets you mark each declaration, comment on a selection of code and export the lot as one Markdown review to paste on GitHub. Your marks stay in this browser.</p>
  <div class="filters">
    <input type="search" id="q" placeholder="Filter by title or number" aria-label="Filter">
    <select id="topic" aria-label="Topic"><option value="">All topics</option>${topics.map((t) => `<option>${esc(t)}</option>`).join('')}</select>
    <label><input type="checkbox" id="hide-done"> Hide PRs I have finished</label>
  </div>
</section>
${lists}
</main>`;
  return page({ title: `@${site.author} · Review queue · ${config.siteTitle}`, body, depth: 1, script: '<script src="../queue.js"></script>' });
}

function codeLines(pr, file, sg, threads) {
  const kept = sg.lines.filter((l) => l.k !== '-');
  const hl = highlightLines(kept.map((l) => l.s).join('\n'));
  const byLine = new Map();
  for (const h of sg.hints) (byLine.get(h.line) ?? byLine.set(h.line, []).get(h.line)).push(h);
  let j = 0;
  return sg.lines
    .map((l) => {
      const html = l.k === '-' ? highlightLines(l.s)[0] : hl[j++];
      const hs = l.new ? byLine.get(l.new) : null;
      const no = l.k === '-' ? `<span class="no">−</span>` : `<a class="no" href="${blob(pr, file.filename, l.new)}" title="Open line ${l.new} on GitHub">${l.new}</a>`;
      const cls = { '+': 'add', '-': 'del', ' ': 'ctx' }[l.k] + (hs ? ' hinted' : '');
      const t = l.new ? threads.get(l.new) : null;
      return `<div class="ln ${cls}"${l.new ? ` data-line="${l.new}"` : ''}${hs ? ` title="${esc(hs.map((h) => h.msg).join('\n'))}"` : ''}>${no}<span class="src">${html || ' '}</span></div>${t ? threadHtml(t) : ''}`;
    })
    .join('');
}

function threadHtml(comments) {
  return `<div class="thread">${comments
    .map((c) => `<div class="tc"><div class="tc-head"><b>${esc(c.author ?? '')}</b> · <a href="${esc(c.url)}">${esc((c.created_at ?? '').slice(0, 10))}</a></div>${markdown(c.body, ctx)}</div>`)
    .join('')}</div>`;
}

function hintList(hs) {
  if (!hs.length) return '';
  return `<ul class="hints">${hs
    .map((h) => `<li><span class="hl">L${h.line}</span> ${inline(h.msg)} <a href="${h.ref}" title="Style guide">guide</a></li>`)
    .join('')}</ul>`;
}

function prPage(a) {
  const { pr, notes } = a;
  // Inline review threads, by file and new-file line.
  const threads = new Map();
  const outdated = [];
  for (const c of pr.review_comments ?? []) {
    if (c.outdated || !c.line) {
      outdated.push(c);
      continue;
    }
    const f = threads.get(c.path) ?? threads.set(c.path, new Map()).get(c.path);
    (f.get(c.line) ?? f.set(c.line, []).get(c.line)).push(c);
  }

  const toc = [];
  const files = a.files
    .map((file) => {
      const ft = threads.get(file.filename) ?? new Map();
      const hunks = file.hunks
        .map((h) => {
          const segs = h.segs
            .filter((sg) => sg.lines.some((l) => l.s.trim() !== ''))
            .map((sg) => {
              const code = `<div class="code">${codeLines(pr, file, sg, ft)}</div>`;
              if (sg.kind === 'other' || !sg.changed) {
                return `<div class="seg other${sg.changed ? ' changed' : ''}">${code}${hintList(sg.hints)}</div>`;
              }
              const first = sg.lines.find((l) => l.new)?.new;
              const last = sg.lines.findLast((l) => l.new)?.new;
              const id = `d-${(sg.name || sg.kind).replace(/[^\w.'-]/g, '_')}-${first}`;
              const label = sg.name || `(anonymous ${sg.kind})`;
              const added = sg.lines.every((l) => l.k !== ' ' || l.s.trim() === '');
              toc.push({ id, label, key: sg.key, kind: sg.kind, note: !!sg.note, hints: sg.hints.length });
              const doc = docstring(sg.lines.filter((l) => l.k !== '-'));
              const explain = sg.note
                ? `<div class="note">${sg.shared ? '<p class="muted small">Shared note for the declarations of this PR without their own:</p>' : ''}${markdown(sg.note, ctx)}</div>`
                : `<div class="note missing"><p class="muted">No transcription for this declaration yet.</p>${doc ? `<p class="muted">Its docstring:</p><blockquote>${markdown(doc, ctx)}</blockquote>` : ''}</div>`;
              return `<article class="decl" id="${id}" data-key="${esc(sg.key)}" data-name="${esc(label)}" data-file="${esc(file.filename)}" data-from="${first}" data-to="${last}">
<div class="decl-code">
  <div class="decl-title"><span class="kind">${sg.kind}</span> <code>${esc(label)}</code> <span class="tag">${sg.lines.every((l) => l.k === '-' || !l.s.trim()) ? 'removed' : sg.partial ? 'body changed' : added ? 'new' : 'changed'}</span><a class="gh" href="${blob(pr, file.filename, first, last)}">L${first}–${last}</a></div>
  ${code}
</div>
<aside class="decl-side">
  ${explain}
  ${hintList(sg.hints)}
  <div class="review" role="group" aria-label="Your verdict">
    <button type="button" data-v="ok" title="Looks right (1)">✓ Looks right</button>
    <button type="button" data-v="question" title="Question (2)">? Question</button>
    <button type="button" data-v="change" title="Needs change (3)">✗ Needs change</button>
  </div>
  <textarea class="decl-note" rows="2" placeholder="Your note on this declaration (goes into the export)"></textarea>
  <ul class="line-comments"></ul>
</aside>
</article>`;
            })
            .join('\n');
          return `<div class="hunk"><div class="hunk-head">${h.header ? `<code>${esc(h.header)}</code>` : ''}</div>${segs}</div>`;
        })
        .join('\n');
      return `<section class="file"><h2><a href="${diffAnchor(pr, file.filename)}" title="This file in the PR diff">${esc(file.filename)}</a> <span class="size"><span class="add">+${file.additions}</span> <span class="del">−${file.deletions}</span></span>${file.status === 'added' ? ' <span class="chip">new file</span>' : ''}</h2>${hintList(file.fileHints)}${hunks}</section>`;
    })
    .join('\n');

  const convo = [
    ...(pr.reviews ?? []).filter((r) => r.body || r.state !== 'COMMENTED').map((r) => ({ ...r, what: r.state.toLowerCase().replace('_', ' ') })),
    ...(pr.comments ?? []).map((c) => ({ ...c, what: 'comment' })),
    ...outdated.map((c) => ({ ...c, what: `on ${c.path}:${c.line} (outdated)` })),
  ].sort((x, y) => (x.created_at ?? '').localeCompare(y.created_at ?? ''));
  const convoHtml = convo.length
    ? `<details class="box"><summary>Conversation on GitHub <span class="count">${convo.length}</span></summary>${convo
        .map((c) => `<div class="tc${/\[bot\]$/.test(c.author ?? '') ? ' bot' : ''}"><div class="tc-head"><b>${esc(c.author ?? '')}</b> · ${esc(c.what)} · <a href="${esc(c.url ?? pr.url)}">${esc((c.created_at ?? '').slice(0, 10))}</a></div>${markdown(c.body || '', ctx)}</div>`)
        .join('')}</details>`
    : pr.comments === null
      ? '<p class="muted small">This snapshot was taken from git: the GitHub conversation is not included.</p>'
      : '';

  const body = `<main class="pr" data-pr="${pr.number}" data-head="${pr.head_sha}" data-url="${pr.url}" data-repo="${config.repo}" data-issues="${config.issuesRepo}" data-title="${esc(pr.title)}">
<section class="pr-head">
  <p class="crumbs"><a href="../index.html#${a.bucket.id}">← queue</a></p>
  <h1><a href="${pr.url}">#${pr.number}</a> ${inline(pr.title)}</h1>
  <div class="chips">${chips(a)}</div>
  <p class="meta"><span class="size"><span class="add">+${a.additions}</span> <span class="del">−${a.deletions}</span></span> · ${plural(pr.files.length, 'file')} · ${plural(pr.commits ?? 0, 'commit')} · head <code>${short(pr.head_sha)}</code> · updated ${ago(pr.updated_at)} · <a href="${pr.url}/files">Files changed on GitHub</a></p>
</section>
${notes?.overview ? `<section class="overview"><h2>In plain words</h2>${markdown(notes.overview, ctx)}${a.stale ? `<p class="warn small">The transcriptions were written for revision <code>${short(notes.head)}</code>; the PR is now at <code>${short(pr.head_sha)}</code>. Check them against the code.</p>` : ''}<p class="muted small">Transcriptions are drafted with an LLM from the diff and are a reading aid, not a verified statement: the Lean code is the reference.</p></section>` : ''}
${pr.body ? `<details class="box"><summary>PR description</summary>${markdown(pr.body, ctx)}</details>` : ''}
${convoHtml}
<nav class="toc box" aria-label="Declarations"><h2>Declarations <span class="count">${toc.length}</span></h2><ol>${toc
    .map((t) => `<li data-key="${esc(t.key)}"><a href="#${t.id}"><span class="dot"></span><span class="kind">${t.kind}</span> <code>${esc(t.label)}</code></a>${t.hints ? ` <span class="hint-count">${t.hints}</span>` : ''}${t.note ? '' : ' <span class="muted small">no transcription</span>'}</li>`)
    .join('')}</ol><p class="keys small muted">Keys: <kbd>j</kbd>/<kbd>k</kbd> next/previous declaration · <kbd>1</kbd> looks right · <kbd>2</kbd> question · <kbd>3</kbd> needs change · <kbd>0</kbd> clear · <kbd>n</kbd> note · <kbd>e</kbd> export. Select code to comment on it.</p></nav>
${files}
</main>
<div class="bar" role="region" aria-label="Review progress">
  <span class="bar-progress">0/${toc.length} declarations checked</span>
  <button type="button" class="export-btn">Export review…</button>
</div>
<dialog class="export">
  <form method="dialog">
    <h2>Your review, as Markdown</h2>
    <p class="small muted">Paste it as a comment or a review on the PR. Line links to the head commit unfold into code snippets on GitHub.</p>
    <textarea readonly rows="16"></textarea>
    <div class="row"><button type="button" class="copy">Copy</button><a class="open-pr" target="_blank" rel="noopener">Open the PR</a><a class="open-issue" target="_blank" rel="noopener">File as an issue in ${esc(config.issuesRepo)}</a><button value="close">Close</button></div>
  </form>
</dialog>`;
  return page({ title: `#${pr.number} ${pr.title} · ${config.siteTitle}`, body, depth: 2, cls: 'review-page', script: '<script src="../../review.js"></script>' });
}

function aboutPage() {
  const body = `<main class="prose">
<h1>About</h1>
<p>This site is a companion for reviewing open pull requests on ${esc(config.repo)}, one queue per author. It started with the PRs of @mycaule and follows <a href="${config.context}">this comment</a>: much of the review feedback so far has been about style, which a tool can point out, and a plain-language version beside the Lean code can let a maintainer check a statement faster.</p>
<h2>What each review page shows</h2>
<ul>
<li><strong>Declarations beside their meaning.</strong> The diff is cut into declarations. Each one gets its Lean code on the left and, on the right, a transcription of the statement in ordinary mathematical language, the proof strategy, and sometimes a point to check. The transcriptions live in <code>notes/&lt;number&gt;.md</code>. They are drafted with an LLM from the diff, so they are a reading aid and can be wrong: the Lean code is the reference.</li>
<li><strong>Style hints.</strong> A first pass over the added lines for points mathlib reviewers often raise: <code>fun x =&gt;</code> instead of <code>↦</code>, non-terminal <code>simp</code>, <code>by exact</code>, blank lines in proofs, missing docstrings on definitions, consecutive <code>rw</code>s, long proofs, <code>_root_</code> names, and so on. They read the text only and can misfire.</li>
<li><strong>The GitHub conversation.</strong> Review comments appear under the line they are attached to; the rest is in a collapsible block.</li>
<li><strong>A batch review.</strong> Mark each declaration as looks right, question or needs change, add a note, or select some code and comment on it. The export turns it all into one Markdown comment with links to the exact lines. Everything stays in your browser (localStorage) until you paste it.</li>
</ul>
<h2>The queue</h2>
<p>Each author's queue sorts the PRs the <a href="https://en.wikipedia.org/wiki/Getting_Things_Done">Getting Things Done</a> way: next actions (ready for review, smallest first), almost there, waiting for the author (draft, CI, requested changes, conflicts), waiting for another PR. Draft state, reviews and CI come from the GitHub API snapshot, refreshed by a scheduled workflow.</p>
<h2>Source</h2>
<p><a href="https://github.com/${config.issuesRepo}">${esc(config.issuesRepo)}</a>. The same approach could carry over to the <a href="https://github.com/leanprover-community/queueboard-core">queueboard</a>.</p>
</main>`;
  return page({ title: `About · ${config.siteTitle}`, body });
}

// ---------------------------------------------------------------------------

function rootPage(queues) {
  const rows = queues
    .map(({ author, index, all }) => {
      const ready = all.filter((a) => a.bucket.id === 'ready').length;
      const lines = all.reduce((n, a) => n + a.additions, 0);
      return `<li class="card"><a class="card-link" href="${author}/index.html"><span class="title">@${esc(author)}</span></a><div class="meta"><span>${plural(all.length, 'open PR')}</span><span>${ready} ready for review</span><span>${lines} added lines</span><span>${all.reduce((n, a) => n + a.covered, 0)}/${all.reduce((n, a) => n + a.decls.length, 0)} declarations transcribed</span><span class="when">snapshot ${esc(index.fetched_at.slice(0, 10))}</span></div></li>`;
    })
    .join('\n');
  const body = `<main class="queue">
<section class="intro">
  <h1>Review queues</h1>
  <p>Open pull requests on <a href="https://github.com/${config.repo}">${esc(config.repo)}</a>, one queue per author. Each review page puts the Lean code of every declaration beside a plain-language transcription, flags style points a bot can see, and turns your marks and comments into one Markdown review.</p>
</section>
<ol class="cards authors">${rows}</ol>
</main>`;
  return page({ title: config.siteTitle, body });
}

rmSync(DIST, { recursive: true, force: true });
mkdirSync(DIST, { recursive: true });
const queues = [];
for (const author of authorsFrom()) {
  const snap = readSnapshot(author);
  if (!snap) {
    console.log(`@${author}: no snapshot in data/${author}/ (run npm run fetch -- --author ${author})`);
    continue;
  }
  site = { author, index: snap.index };
  const all = snap.prs.map(analyse);
  mkdirSync(join(DIST, author, 'pr'), { recursive: true });
  writeFileSync(join(DIST, author, 'index.html'), indexPage(all));
  for (const a of all) writeFileSync(join(DIST, author, 'pr', `${a.pr.number}.html`), prPage(a));
  queues.push({ author, index: snap.index, all });
}
site = null;
writeFileSync(join(DIST, 'index.html'), rootPage(queues));
writeFileSync(join(DIST, 'about.html'), aboutPage());
for (const f of readdirSync(join(ROOT, 'src'))) cpSync(join(ROOT, 'src', f), join(DIST, f));
const katex = join(ROOT, 'node_modules', 'katex', 'dist');
mkdirSync(join(DIST, 'vendor', 'katex', 'fonts'), { recursive: true });
cpSync(join(katex, 'katex.min.css'), join(DIST, 'vendor', 'katex', 'katex.min.css'));
for (const f of readdirSync(join(katex, 'fonts')).filter((f) => f.endsWith('.woff2'))) {
  cpSync(join(katex, 'fonts', f), join(DIST, 'vendor', 'katex', 'fonts', f));
}
writeFileSync(join(DIST, '.nojekyll'), '');

// Report what the notes do not cover, so a stale or mistyped heading shows up.
let warned = 0;
const every = queues.flatMap((q) => q.all);
for (const a of every) {
  // Anonymous instances are optional: an `## instance` section covers them, in order.
  const missing = a.decls.filter((d) => !d.note && d.name).map((d) => d.name);
  if (!a.notes) console.log(`#${a.pr.number}: no notes/${a.pr.number}.md`), warned++;
  else {
    if (a.stale) console.log(`#${a.pr.number}: notes written for ${short(a.notes.head)}, PR at ${short(a.pr.head_sha)}`), warned++;
    if (missing.length) console.log(`#${a.pr.number}: no transcription for ${missing.join(', ')}`), warned++;
    if (a.unmatched.length) console.log(`#${a.pr.number}: notes for unknown declarations ${a.unmatched.join(', ')}`), warned++;
  }
}
console.log(`dist/: ${plural(queues.length, 'queue')}, ${every.length} PR pages, ${every.reduce((n, a) => n + a.decls.length, 0)} declarations${warned ? `, ${warned} note warnings above (npm run notes-todo for details)` : ''}`);
