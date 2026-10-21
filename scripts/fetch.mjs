/**
 * Snapshot of the author's open PRs from the GitHub REST API, into data/.
 *
 *   GITHUB_TOKEN=... node scripts/fetch.mjs
 *
 * A token is optional for a public repository but the anonymous rate limit
 * (60 requests an hour) is too low for more than a handful of PRs: each PR
 * costs six requests. In GitHub Actions the workflow's GITHUB_TOKEN is enough.
 */
import { config, writeSnapshot } from './lib.mjs';

const API = 'https://api.github.com';
const headers = {
  accept: 'application/vnd.github+json',
  'x-github-api-version': '2022-11-28',
  'user-agent': 'mathlib4-review-helper',
};
if (process.env.GITHUB_TOKEN) headers.authorization = `Bearer ${process.env.GITHUB_TOKEN}`;

async function get(path) {
  const res = await fetch(API + path, { headers });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} on GET ${path}\n${await res.text()}`);
  return res.json();
}

/** Every page of a list endpoint. */
async function all(path) {
  const out = [];
  const sep = path.includes('?') ? '&' : '?';
  for (let page = 1; ; page++) {
    const items = await get(`${path}${sep}per_page=100&page=${page}`);
    const list = Array.isArray(items) ? items : items.check_runs ?? items.items;
    out.push(...list);
    if (list.length < 100) return out;
  }
}

/** Run `fn` over `xs`, `n` at a time, keeping the order. */
async function pool(xs, n, fn) {
  const out = new Array(xs.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: n }, async () => {
      while (next < xs.length) {
        const i = next++;
        out[i] = await fn(xs[i]);
      }
    }),
  );
  return out;
}

const comment = (c) => ({
  author: c.user?.login,
  created_at: c.created_at,
  body: c.body ?? '',
  url: c.html_url,
});

/** Summary of the check runs on the head commit: counts and the failing names. */
function summariseChecks(runs) {
  const s = { total: runs.length, success: 0, failure: 0, pending: 0, failing: [] };
  for (const r of runs) {
    if (r.status !== 'completed') s.pending++;
    else if (['success', 'neutral', 'skipped'].includes(r.conclusion)) s.success++;
    else {
      s.failure++;
      s.failing.push({ name: r.name, url: r.html_url });
    }
  }
  s.state = s.failure ? 'failure' : s.pending ? 'pending' : s.total ? 'success' : 'none';
  return s;
}

const [owner, repo] = config.repo.split('/');
const found = await all(
  `/search/issues?q=${encodeURIComponent(`repo:${config.repo} is:pr is:open author:${config.author}`)}`,
);
console.log(`${found.length} open PRs by ${config.author} on ${config.repo}`);

const prs = await pool(found, 4, async ({ number }) => {
  const base = `/repos/${owner}/${repo}`;
  const pr = await get(`${base}/pulls/${number}`);
  const [files, reviews, comments, reviewComments, checks] = await Promise.all([
    all(`${base}/pulls/${number}/files`),
    all(`${base}/pulls/${number}/reviews`),
    all(`${base}/issues/${number}/comments`),
    all(`${base}/pulls/${number}/comments`),
    all(`${base}/commits/${pr.head.sha}/check-runs`),
  ]);
  return {
    number,
    title: pr.title,
    url: pr.html_url,
    author: pr.user.login,
    draft: pr.draft,
    labels: pr.labels.map((l) => l.name),
    body: pr.body ?? '',
    head_sha: pr.head.sha,
    base_sha: pr.base.sha,
    created_at: pr.created_at,
    updated_at: pr.updated_at,
    commits: pr.commits,
    mergeable_state: pr.mergeable_state,
    files: files.map((f) => ({
      filename: f.filename,
      status: f.status,
      additions: f.additions,
      deletions: f.deletions,
      patch: f.patch ?? '',
    })),
    reviews: reviews
      .filter((r) => r.state !== 'PENDING')
      .map((r) => ({ ...comment(r), state: r.state, created_at: r.submitted_at })),
    comments: comments.map(comment),
    review_comments: reviewComments.map((c) => ({
      ...comment(c),
      path: c.path,
      line: c.line ?? c.original_line,
      outdated: c.line == null,
      in_reply_to: c.in_reply_to_id ?? null,
    })),
    checks: summariseChecks(checks),
  };
});

writeSnapshot(prs, 'api');
