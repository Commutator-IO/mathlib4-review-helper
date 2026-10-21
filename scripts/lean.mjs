/**
 * Lean 4 for the review pages: a highlighter, a parser for unified-diff
 * patches, the split of a hunk into declarations, and style hints.
 *
 * None of this elaborates Lean. The split and the hints read the text only,
 * so they are heuristics: good on mathlib-style code, wrong now and then.
 */

export const esc = (s) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// ---------------------------------------------------------------------------
// Highlighting

const KEYWORDS = new Set(
  `theorem lemma def abbrev instance structure class inductive example opaque axiom where
  extends deriving namespace section end variable open export universe noncomputable private
  protected partial unsafe nonrec mutual scoped local attribute set_option in import
  fun λ let have show from by at with match if then else do return for calc suffices
  termination_by decreasing_by omit include irreducible_def proof_wanted public meta module macro syntax notation
  infix infixl infixr prefix postfix elab`.split(/\s+/),
);

const TACTICS = new Set(
  `simp simp_all simpa simp_rw dsimp rw rwa erw rfl exact exacts apply refine refine' intro
  intros rintro obtain rcases cases induction constructor use exists left right ext funext
  congr gcongr ring ring_nf field_simp linarith nlinarith positivity omega norm_num decide
  native_decide aesop tauto trivial contradiction exfalso by_contra by_cases push_neg split
  split_ifs specialize generalize subst symm trans calc conv change convert convert_to
  unfold delta infer_instance inferInstance haveI letI classical filter_upwards measurability
  continuity fun_prop bound norm_cast push_cast exact_mod_cast assumption apply_fun choose
  lift peel nth_rw nth_rewrite rewrite set clear revert refine_lift first try repeat all_goals
  any_goals iterate on_goal focus sorry module abel group noncomm_ring linear_combination
  polyrith interval_cases fin_cases mono compute_degree monicity exists`.split(/\s+/),
);

/**
 * Tokens of a Lean source: [{ t: class | '', s: text }]. Block comments nest,
 * as in Lean; doc comments (`/--`, `/-!`) get their own class.
 */
export function tokenize(src) {
  const out = [];
  let i = 0;
  const push = (t, s) => {
    if (!s) return;
    const last = out[out.length - 1];
    if (last && last.t === t) last.s += s;
    else out.push({ t, s });
  };
  while (i < src.length) {
    const c = src[i];
    const rest = src.slice(i, i + 3);
    if (rest.startsWith('/-')) {
      let depth = 1;
      let j = i + 2;
      while (j < src.length && depth) {
        if (src.startsWith('/-', j)) (depth++, (j += 2));
        else if (src.startsWith('-/', j)) (depth--, (j += 2));
        else j++;
      }
      push(rest === '/--' || rest === '/-!' ? 'doc' : 'com', src.slice(i, j));
      i = j;
    } else if (rest.startsWith('--')) {
      const j = src.indexOf('\n', i);
      const end = j < 0 ? src.length : j;
      push('com', src.slice(i, end));
      i = end;
    } else if (c === '"') {
      let j = i + 1;
      while (j < src.length && src[j] !== '"' && src[j] !== '\n') j += src[j] === '\\' ? 2 : 1;
      push('str', src.slice(i, j + 1));
      i = j + 1;
    } else if (c === '@' && src[i + 1] === '[') {
      let depth = 0;
      let j = i + 1;
      for (; j < src.length; j++) {
        if (src[j] === '[') depth++;
        else if (src[j] === ']' && !--depth) break;
      }
      push('attr', src.slice(i, j + 1));
      i = j + 1;
    } else if (/[0-9]/.test(c) && !/[\p{L}_.'!?₀-₉]/u.test(src[i - 1] ?? ' ')) {
      const m = /^[0-9]+(\.[0-9]+)?/.exec(src.slice(i));
      push('num', m[0]);
      i += m[0].length;
    } else if (/[\p{L}_«]/u.test(c)) {
      const m = /^(«[^»]*»|[\p{L}_][\p{L}\p{N}_'!?₀-₉ₐ-ₜᵢ-ᵪ]*)(\.(«[^»]*»|[\p{L}_][\p{L}\p{N}_'!?₀-₉ₐ-ₜᵢ-ᵪ]*))*/u.exec(
        src.slice(i),
      );
      const w = m[0];
      const t = KEYWORDS.has(w)
        ? 'kw'
        : TACTICS.has(w)
          ? 'tac'
          : /^(Type|Sort|Prop)$/.test(w)
            ? 'sort'
            : /^[A-Z]/.test(w)
              ? 'cap'
              : '';
      push(t, w);
      i += w.length;
    } else if ('·↦←→↔⟨⟩∀∃∑∏∫∘≤≥≠⁻¹⊆∈∉∣'.includes(c) || ':=|'.includes(c)) {
      push('op', c);
      i++;
    } else {
      push('', c);
      i++;
    }
  }
  return out;
}

/** Highlighted HTML of a source, one string per line. */
export function highlightLines(src) {
  const lines = [''];
  for (const { t, s } of tokenize(src)) {
    s.split('\n').forEach((part, k) => {
      if (k) lines.push('');
      if (part) lines[lines.length - 1] += t ? `<span class="${t}">${esc(part)}</span>` : esc(part);
    });
  }
  return lines;
}

// ---------------------------------------------------------------------------
// Patches

/**
 * Hunks of a GitHub `patch`: [{ header, lines: [{ k: '+'|'-'|' ', s, old, new }] }].
 * `new` is the line number in the PR's version of the file (null for removed
 * lines), `old` in the base version.
 */
export function parsePatch(patch) {
  const hunks = [];
  let h = null;
  let o = 0;
  let n = 0;
  for (const raw of patch.split('\n')) {
    const m = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@(.*)/.exec(raw);
    if (m) {
      o = +m[1];
      n = +m[2];
      h = { header: m[3].trim(), lines: [] };
      hunks.push(h);
    } else if (h && raw.startsWith('\\')) {
      // "\ No newline at end of file"
    } else if (h) {
      const k = raw[0] === '+' || raw[0] === '-' ? raw[0] : ' ';
      const s = raw.slice(1);
      if (k === '+') h.lines.push({ k, s, old: null, new: n++ });
      else if (k === '-') h.lines.push({ k, s, old: o++, new: null });
      else h.lines.push({ k, s, old: o++, new: n++ });
    }
  }
  // A patch ending with a newline leaves an empty context line behind.
  const last = hunks.at(-1)?.lines;
  if (last?.length && last.at(-1).k === ' ' && last.at(-1).s === '' && patch.endsWith('\n')) last.pop();
  return hunks;
}

// ---------------------------------------------------------------------------
// Declarations

const MODIFIERS = '(?:(?:public|private|protected|noncomputable|nonrec|partial|unsafe|scoped|meta)\\s+)*';
const DECL_RE = new RegExp(
  `^(?:@\\[[^\\]]*\\]\\s*)*${MODIFIERS}(theorem|lemma|def|abbrev|instance|structure|class|inductive|example|opaque|axiom|irreducible_def|proof_wanted)\\b\\s*(?:\\([^)]*\\)\\s*)?(«[^»]*»|[^\\s:({\\[⦃]*)`,
);
/** Column-0 lines that still belong to the declaration above them. */
const CONTINUATION = /^(\||where\b|deriving\b|termination_by\b|decreasing_by\b|\)|\]|\})/;

export function declHead(s) {
  const m = DECL_RE.exec(s);
  if (!m) return null;
  let name = m[2];
  if (m[1] === 'instance' || m[1] === 'example') {
    // An unnamed instance: `instance : Foo` or `instance [h : X] : Foo`.
    if (!name || name.startsWith('[') || name === ':') name = '';
  }
  return { kind: m[1], name };
}

/**
 * Split the lines of a hunk into segments: declarations (with the doc
 * comment and attributes above them) and the rest. Removed lines stay
 * where they fall.
 */
export function segment(lines, header = '') {
  const segs = [];
  let cur = null;
  let lead = null; // index where a doc comment or attribute run started
  let inDoc = false;
  const open = (start, kind, name) => {
    if (cur) cur.end = start;
    cur = { start, end: lines.length, kind, name };
    segs.push(cur);
  };
  lines.forEach((l, i) => {
    const s = l.s;
    if (inDoc) {
      if (s.includes('-/')) inDoc = false;
      return;
    }
    if (/^\/--/.test(s)) {
      lead ??= i;
      if (!s.slice(3).includes('-/')) inDoc = true;
      return;
    }
    const d = declHead(s);
    if (d) {
      open(lead ?? i, d.kind, d.name);
      lead = null;
      return;
    }
    if (/^@\[[^\]]*\]\s*$/.test(s)) {
      lead ??= i;
      return;
    }
    if (s === '' || /^\s/.test(s) || CONTINUATION.test(s)) return;
    // Another top-level command: `end`, `namespace`, `variable`, `/-!`, ...
    lead = null;
    if (!cur || cur.kind !== 'other') open(i, 'other', '');
  });
  if (!segs.length || segs[0].start > 0) segs.unshift({ start: 0, end: segs[0]?.start ?? lines.length, kind: 'other', name: '' });
  // Trailing blank lines go with the next segment, so a declaration ends on its last line.
  for (const sg of segs) {
    while (sg.end - 1 > sg.start && lines[sg.end - 1].s.trim() === '' && sg.kind !== 'other') sg.end--;
  }
  const out = [];
  segs.forEach((sg, k) => {
    out.push(sg);
    const next = segs[k + 1];
    const until = next ? next.start : lines.length;
    if (sg.end < until) out.push({ start: sg.end, end: until, kind: 'other', name: '' });
  });
  const res = out
    .filter((sg) => sg.end > sg.start)
    .map((sg) => ({ ...sg, lines: lines.slice(sg.start, sg.end) }));
  // A declaration whose header line was rewritten shows as a removed head and an added one:
  // put them back together.
  for (let k = res.length - 1; k > 0; k--) {
    const [a, b] = [res[k - 1], res[k]];
    if (a.kind !== 'other' && a.kind === b.kind && a.name === b.name && a.lines.every((l) => l.k === '-' || /^(\/--|@\[)/.test(l.s) || l.k === ' ' && !declHead(l.s))) {
      res.splice(k - 1, 2, { ...a, end: b.end, lines: a.lines.concat(b.lines) });
    }
  }
  // A hunk that starts inside a declaration: git names it in the hunk header.
  const d = declHead(header);
  if (d && res[0]?.kind === 'other' && /^\s/.test(res[0].lines[0].s)) {
    Object.assign(res[0], { kind: d.kind, name: d.name, partial: true });
  }
  return res;
}

/** The text of the doc comment opening a declaration, without the delimiters. */
export function docstring(lines) {
  const src = lines.map((l) => l.s).join('\n');
  const m = /^\/--\s?([\s\S]*?)\s*-\//m.exec(src);
  return m ? m[1].replace(/^ {0,4}/gm, '') : null;
}

// ---------------------------------------------------------------------------
// Style hints

const STYLE = 'https://leanprover-community.github.io/contribute/style.html';
const DOC = 'https://leanprover-community.github.io/contribute/doc.html';
const NAMING = 'https://leanprover-community.github.io/contribute/naming.html';

/** Code part of a source: comments and strings blanked out, so the patterns do not fire in them. */
function codeOf(s) {
  return tokenize(s)
    .map(({ t, s }) => (t === 'com' || t === 'doc' || t === 'str' ? s.replace(/[^\n]/g, ' ') : s))
    .join('');
}

/** The code part of each line of a segment, read as one source so multi-line comments count. */
function codeLines(lines) {
  const kept = lines.filter((l) => l.k !== '-');
  // Backquoted spans are blanked too: outside comments Lean barely uses them, and they are
  // how a docstring cut by the hunk boundary (so not seen as a comment) quotes code.
  const code = codeOf(kept.map((l) => l.s).join('\n'))
    .split('\n')
    .map((c) => c.replace(/`[^`]*`/g, (m) => ' '.repeat(m.length)));
  const out = new Map(kept.map((l, i) => [l, code[i]]));
  for (const l of lines) if (!out.has(l)) out.set(l, codeOf(l.s));
  return out;
}

const LINE_RULES = [
  { id: 'long-line', test: (s) => [...s].length > 100, msg: 'Line longer than 100 characters.', ref: STYLE },
  { id: 'trailing-space', test: (s) => /\s$/.test(s), msg: 'Trailing whitespace.', ref: STYLE },
  { id: 'lambda', code: true, test: (s) => /λ/.test(s), msg: 'Use `fun` rather than `λ`.', ref: STYLE },
  { id: 'fun-arrow', code: true, test: (s) => /\bfun\b[^↦\n]*?=>/.test(s), msg: 'Mathlib writes `fun x ↦ …` rather than `fun x => …`.', ref: STYLE },
  { id: 'dollar', code: true, test: (s) => /\s\$\s/.test(s), msg: 'Use `<|` rather than `$`.', ref: STYLE },
  { id: 'refine-prime', code: true, test: (s) => /\brefine'/.test(s), msg: "`refine'` is deprecated: use `refine` with `?_`.", ref: STYLE },
  { id: 'succ', code: true, test: (s) => /(\.succ\b|\bNat\.succ\b)(?!['_])/.test(s) && !/Order\.succ/.test(s), msg: 'Prefer `n + 1` to `Nat.succ n` / `n.succ` in statements.', ref: STYLE },
  { id: 'debug', code: true, test: (s) => /(\bsorry\b|\bnative_decide\b|\bexact\?|\bapply\?|\bsimp\?|\brw\?|#check|#eval|#print|\bdbg_trace\b)/.test(s), msg: 'Leftover debugging or forbidden tactic.', ref: STYLE },
  { id: 'heartbeats', code: true, test: (s) => /set_option\s+maxHeartbeats/.test(s), msg: '`maxHeartbeats` bump: mathlib asks for a comment justifying it, or a faster proof.', ref: STYLE },
  { id: 'ascii-dot', test: (s) => /^\s*\.\s/.test(s), msg: 'Focusing dot should be `·`, not `.`.', ref: STYLE },
  { id: 'arrow-space', code: true, test: (s) => /←[^\s]/.test(s), msg: 'Put a space after `←`: `rw [← foo]`.', ref: STYLE },
  { id: 'type-underscore', code: true, test: (s) => /\bType _/.test(s), msg: 'Use `Type*` rather than `Type _` for universe-polymorphic variables.', ref: STYLE },
  { id: 'open-classical', code: true, test: (s) => /^open\s+(.*\s)?Classical\b/.test(s) && !/\bin\s*$/.test(s), msg: 'Global `open Classical`: prefer `open scoped Classical in` or the `classical` tactic.', ref: STYLE },
  { id: 'linter-off', code: true, test: (s) => /set_option\s+linter\.[\w.]+\s+false/.test(s), msg: 'A linter is switched off: worth a justification.', ref: STYLE },
  { id: 'deprecated-since', code: true, test: (s) => /@\[[^\]]*\bdeprecated\b/.test(s) && !/since\s*:=/.test(s), msg: 'Deprecation without `(since := "YYYY-MM-DD")`.', ref: STYLE },
  { id: 'erw', code: true, test: (s) => /\berw\b/.test(s), msg: '`erw` often hides a missing lemma or a defeq abuse; worth a look.', ref: STYLE },
];

/**
 * Hints on the added lines of one segment: [{ line, id, msg, ref }]. `line`
 * is the new-file line number.
 */
export function hints(seg, file) {
  const out = [];
  const add = (l, id, msg, ref) => out.push({ line: l.new, id, msg, ref });
  const lines = seg.lines;
  const codes = codeLines(lines);
  lines.forEach((l, i) => {
    if (l.k !== '+') return;
    const code = codes.get(l);
    for (const r of LINE_RULES) if (r.test(r.code ? code : l.s)) add(l, r.id, r.msg, r.ref);
    // Look ahead in the new version only.
    const next = lines.slice(i + 1).find((x) => x.k !== '-' && x.s.trim() !== '');
    const ind = (x) => /^\s*/.exec(x.s)[0].length;
    if (/^\s+(simp|simp_all)\b(?!\s+only)(?![?!])/.test(code) && !/<;>|;/.test(code) && next && ind(next) === ind(l) && seg.kind !== 'other') {
      add(l, 'flexible-simp', 'Non-terminal `simp`: make it `simp only [...]` (`simp?` prints the list) so later steps do not break when the simp set changes.', STYLE);
    }
    if (next && /^\s+intro\b/.test(code) && /^\s+intro\b/.test(codes.get(next)) && ind(next) === ind(l) && next.k === '+') {
      add(l, 'intro-intro', 'Consecutive `intro`s can be merged: `intro x y`.', STYLE);
    }
    if (next && /^\s+rw \[[^\]]*\]\s*$/.test(code) && /^\s+rw \[/.test(codes.get(next)) && ind(next) === ind(l) && next.k === '+') {
      add(l, 'rw-rw', 'Consecutive `rw`s can be merged into one.', STYLE);
    }
    if (l.s.trim() === '' && seg.kind !== 'other' && next && ind(next) > 0 && i > 0) {
      add(l, 'blank-in-proof', 'Blank line inside a declaration: mathlib style keeps proofs without empty lines.', STYLE);
    }
  });
  if (seg.kind !== 'other' && lines.some((l) => l.k === '+')) {
    const body = lines.filter((l) => l.k !== '-');
    const src = body.map((l) => l.s).join('\n');
    const first = body.find((l) => declHead(l.s)) ?? body[0];
    if (['def', 'abbrev', 'structure', 'class', 'inductive', 'opaque'].includes(seg.kind) && !/\/--/.test(src) && first.k === '+') {
      add(first, 'docstring', `Every \`${seg.kind}\` needs a docstring (the \`docBlame\` linter).`, DOC);
    }
    const tail = body.filter((l) => l.s.trim());
    const by = tail.findIndex((l) => /:= by\s*$/.test(codes.get(l)));
    if (by >= 0 && by === tail.length - 2 && /^\s+exact\s/.test(tail.at(-1).s) && tail.at(-1).k === '+') {
      add(tail.at(-1), 'by-exact', '`by exact t` can be the term `t`.', STYLE);
    }
    if (/:= by exact\s/.test(codes.get(tail.at(-1)) ?? '') && tail.at(-1).k === '+') {
      add(tail.at(-1), 'by-exact', '`by exact t` can be the term `t`.', STYLE);
    }
    const statement = codes.get(first) ?? '';
    if ((seg.kind === 'theorem' || seg.kind === 'lemma') && /\)\s*:\s*∀/.test(statement) && first.k === '+') {
      add(first, 'forall-statement', 'Statement starts with `∀`: mathlib usually puts these variables before the colon, as arguments.', STYLE);
    }
    if (/^(_root_\.)/.test(seg.name) && first.k === '+') {
      add(first, 'root-name', '`_root_` name: check the declaration sits in the right namespace (and file).', NAMING);
    }
    const added = lines.filter((l) => l.k === '+' && l.s.trim()).length;
    if (added > 30) {
      add(first, 'long-proof', `${added} added lines in one declaration: reviewers often ask to split long proofs into lemmas.`, STYLE);
    }
    if ((seg.kind === 'theorem' || seg.kind === 'lemma') && /[A-Z]/.test((seg.name.split('.').at(-1) ?? '')[0] ?? '')) {
      add(first, 'naming', 'Theorem names are `snake_case` and start in lower case.', NAMING);
    }
  }
  return out;
}

/** Hints on a whole new file: header and module docstring. */
export function fileHints(file, hunks) {
  if (file.status !== 'added' || !file.filename.endsWith('.lean')) return [];
  const src = hunks.flatMap((h) => h.lines.map((l) => l.s)).join('\n');
  const out = [];
  if (!/Copyright \(c\)/.test(src) || !/^Authors?:/m.test(src))
    out.push({ line: 1, id: 'header', msg: 'New file without the copyright header (`Copyright (c) …`, `Released under Apache 2.0 license …`, `Authors: …`).', ref: STYLE });
  if (!/^\/-!/m.test(src)) out.push({ line: 1, id: 'module-doc', msg: 'New file without a module docstring `/-! # Title … -/`.', ref: DOC });
  return out;
}
