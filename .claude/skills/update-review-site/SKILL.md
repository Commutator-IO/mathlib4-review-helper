---
name: update-review-site
description: Add a GitHub user's open mathlib4 PRs to the review site, or refresh it - snapshot their PRs, write the plain-language transcriptions (notes/) that are missing or stale, build, check, commit. Use when asked to update or refresh the review site or helper, to add someone's PRs to it ("make a review page for @foo's PRs", "track PRs of user X"), or to catch the notes up after PRs changed.
---

# Update the review site

The site has one queue per author listed in `config.json` (`authors`). For each
author it needs two things: a snapshot of their open PRs in `data/<login>/`
(from the GitHub API, or from git) and a transcription of each declaration in
`notes/<number>.md`. The scheduled workflow refreshes the snapshots on its own;
**the notes are what this skill adds**, so new and updated PRs get explained.

Input: one or more GitHub logins. With none, work on every author in
`config.json`. Run everything from the repository root.

## 1. Set up

```bash
npm ci   # or npm install
```

A login is letters, digits and hyphens (the scripts refuse anything else). If
the login is new, append it to `authors` in `config.json`. Check it really has
open PRs on the repository in `config.json` before going further (step 2 tells
you); if it has none, say so and stop, leaving `config.json` as it was.

## 2. Snapshot the PRs

**From the API (preferred).** Test access first:

```bash
curl -s -o /dev/null -w '%{http_code}\n' https://api.github.com/repos/leanprover-community/mathlib4
```

If that prints 200, run (a token avoids the 60-requests-an-hour anonymous
limit; each PR costs six requests):

```bash
GITHUB_TOKEN=... npm run fetch -- --author <login>
```

**From git (fallback, when the API is blocked).** Reviews, comments, CI and
draft state are then unknown; the site says so, and the next scheduled CI run
replaces the snapshot with API data.

1. List the open PRs: fetch
   `https://github.com/leanprover-community/mathlib4/pulls?q=is%3Apr+is%3Aopen+author%3A<login>`
   (and `&page=2`, … while the page says there are more) and write a TSV,
   one line per PR: `number<TAB>title<TAB>label,label,…` (keep the `t-…` and
   `blocked-by-other-PR` labels). Put it in your scratch directory, not in the repo.
2. A blobless clone with the PR heads (reuse an existing clone if one is there):
   ```bash
   git clone --filter=blob:none --no-checkout --depth 1 https://github.com/leanprover-community/mathlib4 <clone>
   git -C <clone> fetch --depth=400 --filter=blob:none origin master
   git -C <clone> fetch --depth=50 --filter=blob:none origin $(for n in <numbers>; do printf '+refs/pull/%s/head:refs/remotes/pr/%s ' $n $n; done)
   ```
   The proxy may need a generous timeout (several minutes).
3. `node scripts/snapshot-git.mjs --author <login> --mathlib <clone> --meta <tsv>`.
   If `git merge-base` fails for a PR, deepen the master fetch.

## 3. Find what the notes lack

```bash
npm run notes-todo -- --author <login> --out <scratch>/diffs
```

It lists, per PR: no notes file, notes written for an older head, declarations
without a section, sections that match nothing; and writes one
`<scratch>/diffs/<number>.diff` per PR needing work. It also lists notes of PRs
that are no longer open; delete those files only when the user agrees, or when
the PR is merged or closed.

## 4. Write the notes

Every notes file follows [notes-brief.md](notes-brief.md): read it first. It
fixes the format, how headings match declarations, stacked PRs, stale notes
and what a **Check.** may say.

- A handful of PRs: write them yourself.
- More: split them into groups of about 8, by topic (the `t-…` labels), and
  give each group to a parallel subagent, with the path of `notes-brief.md`,
  the diff directory and the PR numbers. Ask each for its list of **Check.**
  lines.

Then re-run `npm run notes-todo -- --author <login>` and fix what it still
lists (usually a heading typed differently from the code) until it prints that
notes cover every declaration.

## 5. Build and check

```bash
npm test
npm run build      # lists any declaration still without a transcription
```

Look at the result: `npm run dev` serves `dist/` on http://localhost:4173;
open `/<login>/index.html` and two or three PR pages (Playwright with
`executablePath: '/opt/pw-browsers/chromium'` if there is no browser at hand).
Make sure the maths renders, every changed declaration has its card, and no
page scrolls sideways at 390px wide.

## 6. Commit

Commit `config.json`, `data/<login>/` and `notes/` with a message naming the
author and the number of PRs and notes, then push to the branch you work on.
Do not push to `main` unless asked: the `site` workflow publishes from `main`.

Report to the user: how many PRs and declarations the author has, how many
notes were written or refreshed, the **Check.** lines worth their attention,
and anything skipped (for example a snapshot taken from git).

## Removing an author

Drop the login from `authors` and delete `data/<login>/`. Their notes are
keyed by PR number and harmless; `npm run notes-todo` then lists them as no
longer open.
