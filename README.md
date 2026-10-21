# mathlib4 review helper

A static companion site for reviewing the open mathlib4 pull requests of [@mycaule](https://github.com/leanprover-community/mathlib4/pulls?q=is%3Apr+is%3Aopen+author%3Amycaule). It follows [this comment](https://github.com/leanprover-community/mathlib4/pull/44757#issuecomment-6281814848): much of the review feedback so far has been about style, which a tool can point out, and a plain-language version beside the Lean code can let a maintainer check a statement faster.

## What it shows

**The queue** (`index.html`) sorts the PRs into [GTD](https://en.wikipedia.org/wiki/Getting_Things_Done) lists:

| List | Rule |
|---|---|
| Next actions: ready for review | open, not draft, nothing pending on the author; smallest first |
| Almost there | `delegated`, `maintainer-merge`, `ready-to-merge` |
| Waiting for the author | draft, `awaiting-author`, changes requested, CI failing, merge conflict |
| Waiting for another PR | `blocked-by-other-PR` |

Each card shows the size of the PR, how many declarations it touches, how many have a transcription, the style hints, the CI and review state, and your own progress (read from your browser).

**A review page per PR** (`pr/<number>.html`):

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

The heading is the declaration name exactly as written after `theorem`/`def`/…; two declarations with the same name get two sections, in file order. When the PR moves past `head`, the page says the transcriptions were written for an older revision. `npm run build` lists the declarations without a transcription and the sections that match nothing.

The current notes were drafted with an LLM from the diffs. They are a reading aid, not a verified statement: the Lean code is the reference.

## Build

```bash
npm install
npm run fetch      # snapshot of the open PRs into data/, from the GitHub API (set GITHUB_TOKEN)
npm run build      # site into dist/
npm run dev        # build and serve on http://localhost:4173
npm test
```

`config.json` names the repository, the author and the repository that receives issues.

Without API access, `scripts/snapshot-git.mjs` builds the same snapshot from a mathlib4 clone with the PR heads fetched (`git fetch origin +refs/pull/<n>/head:refs/remotes/pr/<n>`) and a TSV of titles and labels; reviews, comments, CI and draft state are then unknown. The committed `data/` was made that way.

The `site` workflow refreshes the snapshot from the API every three hours, builds, and publishes `dist/` on GitHub Pages from `main`. Pages has to be enabled in the repository settings, with *GitHub Actions* as the source. All links are relative, so a custom domain (a `CNAME` in `src/`) works too.
