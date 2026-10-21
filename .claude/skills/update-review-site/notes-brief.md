# Brief: plain-language transcriptions for mathlib4 PRs

You are writing companion notes for the review site in this repository. For
each Lean declaration a PR adds or changes, the site shows the Lean code on the
left and YOUR plain-language transcription on the right, so a mathlib reviewer
can check quickly that the formal statement says what it should, and see the
proof strategy.

## Inputs

- One diff per PR, `<diff dir>/<number>.diff`, written by
  `npm run notes-todo -- --author <login> --out <diff dir>`. Its first lines
  give the PR title, the head commit (`head <sha>`) and what is missing:
  declarations without a section, sections matching no declaration, or notes
  written for an older head.
- An existing `notes/<number>.md`, if there is one: keep what is still right.
- For context, if a mathlib4 clone with the PR heads is at hand (see SKILL.md),
  read the whole file at the PR head with
  `git -C <clone> show refs/remotes/pr/<number>:<path>`. If the clone is
  blobless each `git show` downloads one blob: fine, but never `git grep` the
  whole tree or check it out. Without a clone, work from the diff.

## Output

Write `notes/<number>.md` in exactly this format (UTF-8, English):

```
---
head: <the sha from the diff's `head` line>
stacked-on: <OPTIONAL: number of a PR this one is stacked on, see below>
---
<Overview: 2-5 sentences. What the PR adds mathematically, in plain words,
and where it fits (what existing mathlib notion it builds on).>

## <declaration name exactly as written after the keyword>

<Statement in plain mathematical language, with every hypothesis that
matters (typeclass assumptions summarised: "for a commutative ring $R$",
"for a field $K$"...). LaTeX between $...$ (inline) or $$...$$ (display);
KaTeX renders it. Say the mathematics, do not just restate Lean names.>

**Proof.** <one to three sentences: the strategy the Lean proof actually
follows (key lemmas, induction on what, which reduction). For a def write
**Definition.** instead, saying what is constructed; for an instance, what
instance and why it holds.>

**Check.** <OPTIONAL, only when you noticed something concrete a reviewer
should look at in this declaration: a hypothesis that looks unnecessary or
too strong, a statement weaker or stronger than its docstring claims, a name
against mathlib naming conventions, a missing docstring on a def or main
theorem, a notably long or fragile proof, a lemma probably already in mathlib
(only if fairly confident, and say "probably"). Omit the line otherwise.>
```

## Rules

- One `## ` section per declaration (theorem, lemma, def, abbrev, structure,
  class, inductive, named instance) that the diff ADDS or CHANGES, in file
  order. The heading is the bare name exactly as typed after the keyword
  (`_root_.Foo.bar` stays as typed; no backticks, no namespace added by you):
  the site matches headings to code by that text.
- Two declarations with the same name (e.g. a Monad and a Comonad version in
  different namespaces) get two sections with the same heading, in file order.
- Anonymous instances are optional. To cover them, use the heading
  `## instance`, one per anonymous instance, in file order.
- A declaration whose statement is unchanged but whose proof or docstring
  changed still gets a short section: "Statement unchanged: …", then what
  changed. A removed declaration gets one line saying what replaces it.
- A PR stacked on another one (its diff includes the other PR's changes, often
  labelled `blocked-by-other-PR` and saying so in its description): put
  `stacked-on: <number>` in the front matter and write sections only for the
  declarations the lower PR does not have. The site borrows the rest from the
  lower PR's notes.
- Notes written for an older head (`notes written for <sha>` in the diff):
  re-read every section against the current code, fix what changed, delete
  sections of declarations that are gone, and set `head:` to the new sha.
- Be accurate. Read the Lean statement carefully (coercions, `Fin n`,
  `Finset.range`, truncated subtraction on ℕ, `≤` vs `<`, which ring an
  equation lives in). If the docstring and the statement disagree, say so in
  **Check.**
- Be concise: a reviewer reads dozens of these. No praise, no filler.
- Write nothing but the notes files you were given. When done, reply with
  the files written and, per PR, one line naming any **Check.** raised.
