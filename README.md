# mathlib4 review helper

A static companion site for reviewing open mathlib4 pull requests, one queue per author. It started with the PRs of [@mycaule](https://github.com/leanprover-community/mathlib4/pulls?q=is%3Apr+is%3Aopen+author%3Amycaule) and follows [this comment](https://github.com/leanprover-community/mathlib4/pull/44757#issuecomment-6281814848): much of the review feedback so far has been about style, which a tool can point out, and a plain-language version beside the Lean code can let a maintainer check a statement faster.

## What it shows

**The home page** (`index.html`) lists one queue per author in `config.json`.

**Each queue** (`<login>/index.html`) sorts that author's PRs into [GTD](https://en.wikipedia.org/wiki/Getting_Things_Done) lists:

| List | Rule |
|---|---|
| Next actions: ready for review | open, not draft, nothing pending on the author; smallest first |
| Almost there | `delegated`, `maintainer-merge`, `ready-to-merge` |
| Waiting for the author | draft, `awaiting-author`, changes requested, CI failing, merge conflict |
| Waiting for another PR | `blocked-by-other-PR` |

Each card shows the size of the PR, how many declarations it touches, how many have a transcription, the style hints, the CI and review state, and your own progress (read from your browser).

**A review page per PR** (`<login>/pr/<number>.html`):

- The diff is cut into declarations. Each one shows its Lean code on the left and, on the right, a **plain-language transcription**: the statement in ordinary mathematical language (KaTeX), the proof strategy, and sometimes a point to check.
- **Style hints** on the added lines, for points mathlib reviewers often raise: `fun x =>` rather than `↦`, non-terminal `simp`, `by exact`, blank lines in proofs, a `def` without a docstring, consecutive `rw`s or `intro`s, `←foo` without a space, long proofs, `_root_` names, leftover `sorry`/`exact?`, a new file without its header or module docstring, and so on. They read the text only, so they can misfire. The rules are in `scripts/lean.mjs`.
- The **GitHub conversation**: review comments appear under the line they are attached to, the rest in a collapsible block.
- A **batch review**: mark each declaration *looks right*, *question* or *needs change*, write a note, or select some code and comment on it. *Export review* turns it all into one Markdown comment with links to the exact lines of the head commit, which GitHub unfolds into code snippets. A line comment can also be filed as an issue in this repository. Everything stays in `localStorage` until you paste it.
- Keys: `j`/`k` next/previous declaration, `1` `2` `3` mark, `0` clear, `n` note, `e` export, `?` help.

## Transcriptions

They live in `notes/<number>.md`:

```markdown
---
head: <the PR head commit they were written against>
stacked-on: <optional: a PR whose notes to fall back on>
---
Overview of the PR in plain words.

## declaration_name

The statement in words, with $\TeX$.

**Proof.** The strategy of the Lean proof.

**Check.** Optional: something a reviewer should look at.
```

The heading is the declaration name exactly as written after `theorem`/`def`/…; two declarations with the same name get two sections, in file order; `## instance` sections cover anonymous instances, in order. When the PR moves past `head`, the page says the transcriptions were written for an older revision. `npm run notes-todo` lists what is missing or stale, and the notes of PRs no longer open; with `--out <dir>` it also writes the diff of each PR needing work. The full format is in [`.claude/skills/update-review-site/notes-brief.md`](.claude/skills/update-review-site/notes-brief.md).

The current notes were drafted with an LLM from the diffs. They are a reading aid, not a verified statement: the Lean code is the reference.

## Adding an author, or catching up: the Claude skill

[`.claude/skills/update-review-site`](.claude/skills/update-review-site/SKILL.md) is a Claude Code skill that does the whole update for any GitHub login: add it to `config.json`, snapshot its open PRs (API, or git as a fallback), write the missing or stale transcriptions (fanning out to subagents when there are many), build, check the pages and commit. In Claude Code, in this repository:

```
/update-review-site <login>
```

or just ask, e.g. *"add the PRs of @someone to the review site"*. With no login it refreshes every author.

## Build

```bash
npm install
npm run fetch                      # snapshots into data/<login>/ from the GitHub API (set GITHUB_TOKEN)
npm run fetch -- --author <login>  # one author, listed in config.json or not
npm run notes-todo                 # what notes/ still lacks
npm run build                      # site into dist/
npm run dev                        # build and serve on http://localhost:4173
npm test
```

`config.json` names the repository, the authors and the repository that receives issues.

Without API access, `scripts/snapshot-git.mjs --author <login>` builds the same snapshot from a mathlib4 clone with the PR heads fetched (`git fetch origin +refs/pull/<n>/head:refs/remotes/pr/<n>`) and a TSV of titles and labels; reviews, comments, CI and draft state are then unknown. The committed `data/mycaule/` was made that way.

The `site` workflow refreshes every author's snapshot from the API every three hours (the notes need the skill, or a person), builds, and publishes `dist/` on GitHub Pages from `main`. Pages has to be enabled in the repository settings, with *GitHub Actions* as the source. All links are relative, so a custom domain (a `CNAME` in `src/`) works too.
