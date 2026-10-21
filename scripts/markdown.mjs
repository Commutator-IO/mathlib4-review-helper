/**
 * The small subset of Markdown found in PR descriptions, comments, docstrings
 * and notes/: paragraphs, headings, lists, quotes, fenced code, inline code,
 * emphasis, links, and TeX between `$…$` / `$$…$$`, typeset here by KaTeX.
 * Raw HTML is escaped, never passed through: the text comes from GitHub.
 */
import katex from 'katex';
import { esc, highlightLines } from './lean.mjs';

const tex = (s, displayMode) =>
  katex.renderToString(s, { displayMode, throwOnError: false, strict: 'ignore', output: 'html' });

/** Inline Markdown of one paragraph's text. `ctx.repo` turns `#123` into PR links. */
export function inline(text, ctx = {}) {
  const slots = [];
  const keep = (html) => `\u0000${slots.push(html) - 1}\u0000`;
  let s = text
    .replace(/`([^`\n]+)`/g, (_, c) => keep(`<code>${esc(c)}</code>`))
    .replace(/\$\$([^$]+)\$\$/g, (_, m) => keep(tex(m, true)))
    .replace(/(^|[^\\$])\$([^$\n]+?)\$/g, (_, pre, m) => pre + keep(tex(m, false)))
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, (_, t, u) => keep(`<a href="${esc(u)}">${inline(t, ctx)}</a>`))
    .replace(/<?(https?:\/\/[^\s<>)]+[^\s<>).,;:!?])>?/g, (_, u) => keep(`<a href="${esc(u)}">${esc(u.replace(/^https?:\/\//, ''))}</a>`));
  s = esc(s)
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^\w*])\*([^*\s][^*]*)\*/g, '$1<em>$2</em>')
    .replace(/(^|\s)_([^_\s][^_]*)_(?=\s|$|[.,;:])/g, '$1<em>$2</em>');
  if (ctx.repo) {
    s = s.replace(/(^|[\s(])#(\d{3,6})\b/g, (_, pre, n) => `${pre}<a href="https://github.com/${ctx.repo}/pull/${n}">#${n}</a>`);
    s = s.replace(/(^|[\s(])@([A-Za-z0-9-]{1,39})\b/g, (_, pre, u) => `${pre}<a href="https://github.com/${u}">@${u}</a>`);
  }
  return s.replace(/\u0000(\d+)\u0000/g, (_, i) => slots[i]);
}

/** Block Markdown. */
export function markdown(src, ctx = {}) {
  const lines = src.replace(/\r\n?/g, '\n').replace(/<!--[\s\S]*?-->/g, '').split('\n');
  const out = [];
  let para = [];
  let list = null; // { tag, items: [] }
  const flushPara = () => {
    if (para.length) out.push(`<p>${inline(para.join('\n'), ctx)}</p>`);
    para = [];
  };
  const flushList = () => {
    if (list) out.push(`<${list.tag}>${list.items.map((i) => `<li>${inline(i, ctx)}</li>`).join('')}</${list.tag}>`);
    list = null;
  };
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    const fence = /^\s*(```|~~~)\s*(\w*)/.exec(l);
    if (fence) {
      flushPara(), flushList();
      const body = [];
      for (i++; i < lines.length && !lines[i].trim().startsWith(fence[1]); i++) body.push(lines[i]);
      const code = fence[2] === 'lean' || fence[2] === 'lean4' ? highlightLines(body.join('\n')).join('\n') : esc(body.join('\n'));
      out.push(`<pre class="code"><code>${code}</code></pre>`);
      continue;
    }
    if (/^\s*\$\$\s*$/.test(l)) {
      flushPara(), flushList();
      const body = [];
      for (i++; i < lines.length && !/^\s*\$\$\s*$/.test(lines[i]); i++) body.push(lines[i]);
      out.push(tex(body.join('\n'), true));
      continue;
    }
    const h = /^(#{1,6})\s+(.*)$/.exec(l);
    if (h) {
      flushPara(), flushList();
      const level = Math.min(6, h[1].length + (ctx.shift ?? 2));
      out.push(`<h${level}>${inline(h[2], ctx)}</h${level}>`);
      continue;
    }
    if (/^\s*(---+|\*\*\*+)\s*$/.test(l)) {
      flushPara(), flushList();
      out.push('<hr>');
      continue;
    }
    const q = /^\s*>\s?(.*)$/.exec(l);
    if (q) {
      flushPara(), flushList();
      const body = [q[1]];
      while (i + 1 < lines.length && /^\s*>/.test(lines[i + 1])) body.push(lines[++i].replace(/^\s*>\s?/, ''));
      out.push(`<blockquote>${markdown(body.join('\n'), ctx)}</blockquote>`);
      continue;
    }
    const li = /^\s*([-*+]|\d+[.)])\s+(.*)$/.exec(l);
    if (li) {
      flushPara();
      const tag = /\d/.test(li[1]) ? 'ol' : 'ul';
      if (list && list.tag !== tag) flushList();
      list ??= { tag, items: [] };
      list.items.push(li[2].replace(/^\[( |x|X)\]\s*/, (_, x) => (x === ' ' ? '☐ ' : '☑ ')));
      continue;
    }
    if (list && /^\s{2,}\S/.test(l)) {
      list.items[list.items.length - 1] += '\n' + l.trim();
      continue;
    }
    if (!l.trim()) {
      flushPara(), flushList();
      continue;
    }
    flushList();
    para.push(l);
  }
  flushPara(), flushList();
  return out.join('\n');
}

/**
 * A notes/<number>.md file: front matter (`head: <sha>`), an overview, then
 * one `## <declaration name>` section per declaration.
 */
export function parseNotes(src) {
  const notes = { head: null, overview: '', decls: new Map() };
  let body = src.replace(/\r\n?/g, '\n');
  const fm = /^---\n([\s\S]*?)\n---\n?/.exec(body);
  if (fm) {
    for (const line of fm[1].split('\n')) {
      const m = /^([\w-]+):\s*(.*)$/.exec(line);
      if (m) notes[m[1]] = m[2].trim();
    }
    body = body.slice(fm[0].length);
  }
  const parts = body.split(/^## +(.+)$/m);
  notes.overview = parts[0].trim();
  for (let i = 1; i < parts.length; i += 2) {
    // Two declarations can share a name in different namespaces: keep both, in order.
    const k = parts[i].trim().replace(/^`|`$/g, '');
    (notes.decls.get(k) ?? notes.decls.set(k, []).get(k)).push(parts[i + 1].trim());
  }
  return notes;
}
