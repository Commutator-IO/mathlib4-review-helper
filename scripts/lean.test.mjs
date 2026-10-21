import assert from 'node:assert/strict';
import { test } from 'node:test';
import { declHead, docstring, hints, highlightLines, parsePatch, segment } from './lean.mjs';
import { inline, parseNotes } from './markdown.mjs';

const patch = `@@ -10,3 +10,14 @@ theorem old_thing : True := by
   trivial

 end Foo
+
+/-- The **thing**. -/
+@[simp]
+theorem new_thing (n : ℕ) : n + 0 = n := by
+  simp
+  rfl
+
+def noDoc : ℕ := 0
+
+-theorem gone : True := trivial
`;

test('parsePatch numbers new and old lines', () => {
  const [h] = parsePatch(patch);
  assert.equal(h.header, 'theorem old_thing : True := by');
  assert.deepEqual(h.lines[0], { k: ' ', s: '  trivial', old: 10, new: 10 });
  const add = h.lines.find((l) => l.s.startsWith('theorem new_thing'));
  assert.equal(add.new, 16);
  assert.equal(add.old, null);
});

test('segment cuts at declarations and keeps their docstring and attributes', () => {
  const [h] = parsePatch(patch);
  const segs = segment(h.lines, h.header);
  const decls = segs.filter((s) => s.kind !== 'other');
  assert.deepEqual(decls.map((s) => [s.kind, s.name]), [['theorem', 'old_thing'], ['theorem', 'new_thing'], ['def', 'noDoc']]);
  assert.ok(decls[0].partial, 'the hunk header names the declaration the hunk starts in');
  assert.match(decls[1].lines[0].s, /^\/--/);
  assert.equal(docstring(decls[1].lines), 'The **thing**.');
});

test('a declaration whose header was rewritten stays one segment', () => {
  const [h] = parsePatch(`@@ -1,3 +1,3 @@
 /-- Doc. -/
-theorem foo [A X] :
+theorem foo [B X] :
     P := by
   simp
`);
  const decls = segment(h.lines).filter((s) => s.kind !== 'other');
  assert.equal(decls.length, 1);
  assert.equal(decls[0].lines.length, 5);
});

test('declHead reads names and leaves anonymous instances unnamed', () => {
  assert.deepEqual(declHead('@[simp] protected lemma Foo.bar : x'), { kind: 'lemma', name: 'Foo.bar' });
  assert.deepEqual(declHead('instance : Foo X := ⟨⟩'), { kind: 'instance', name: '' });
  assert.deepEqual(declHead('noncomputable instance instFoo : Foo X'), { kind: 'instance', name: 'instFoo' });
  assert.equal(declHead('  theorem indented'), null);
  // The module system's visibility modifiers, and `proof_wanted`.
  assert.deepEqual(declHead('public theorem StarHom.foo'), { kind: 'theorem', name: 'StarHom.foo' });
  assert.deepEqual(declHead('@[simp] public noncomputable def bar : X'), { kind: 'def', name: 'bar' });
  assert.deepEqual(declHead('proof_wanted Matrix.baz {K : Type*}'), { kind: 'proof_wanted', name: 'Matrix.baz' });
  assert.equal(declHead('public section'), null);
});

test('hints: non-terminal simp, missing def docstring, not inside comments', () => {
  const [h] = parsePatch(patch);
  const segs = segment(h.lines, h.header);
  const ids = segs.flatMap((s) => hints(s, {}).map((x) => x.id));
  assert.ok(ids.includes('flexible-simp'));
  assert.ok(ids.includes('docstring'));
  const [c] = parsePatch('@@ -1,0 +1,3 @@\n+/-- uses λ and fun x => x\n+in prose -/\n+theorem t : True := trivial\n');
  assert.deepEqual(segment(c.lines).flatMap((s) => hints(s, {}).map((x) => x.id)), []);
});

test('highlighting keeps one string per line through block comments', () => {
  const lines = highlightLines('/- a\nb -/\ntheorem x');
  assert.equal(lines.length, 3);
  assert.match(lines[2], /<span class="kw">theorem<\/span>/);
});

test('inline markdown escapes HTML and typesets TeX', () => {
  assert.equal(inline('<b>x</b>'), '&lt;b&gt;x&lt;/b&gt;');
  assert.match(inline('$x^2$'), /class="katex"/);
  assert.match(inline('see #44757', { repo: 'o/r' }), /href="https:\/\/github.com\/o\/r\/pull\/44757"/);
});

test('parseNotes keeps same-named sections in order', () => {
  const n = parseNotes('---\nhead: abc\nstacked-on: 1\n---\nOverview.\n\n## a\nfirst\n\n## a\nsecond\n');
  assert.equal(n.head, 'abc');
  assert.equal(n['stacked-on'], '1');
  assert.deepEqual(n.decls.get('a'), ['first', 'second']);
});

test('checkLogin accepts GitHub logins and nothing that could leave data/', async () => {
  const { checkLogin } = await import('./lib.mjs');
  assert.equal(checkLogin('mycaule'), 'mycaule');
  assert.equal(checkLogin('a-b-1'), 'a-b-1');
  for (const bad of ['../x', 'a/b', '', '-lead', 'x'.repeat(40), undefined]) assert.throws(() => checkLogin(bad));
});
