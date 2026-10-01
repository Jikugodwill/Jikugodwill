import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateContributions } from '../lib/contributions.mjs';
import { aggregateLanguages, selectLanguageRepositories, calculateRepositoryMetrics } from '../lib/repositories.mjs';
import { fetchOwnedPublicRepositories, fetchContributionCalendars, createGitHubClient } from '../lib/github.mjs';
import { escapeXml } from '../lib/render-svg.mjs';

function calendar(counts, start = '2026-09-24') {
  const startTime = Date.parse(`${start}T00:00:00Z`);
  const days = counts.map((contributionCount, index) => ({ date: new Date(startTime + index * 86_400_000).toISOString().slice(0, 10), contributionCount }));
  return { start, end: days.at(-1).date, total: counts.reduce((a, b) => a + b, 0), days };
}

test('current streak allows an unfinished today but not a missing yesterday', () => {
  assert.equal(calculateContributions(calendar([0, 2, 1, 0])).currentStreak, 2);
  assert.equal(calculateContributions(calendar([2, 1, 0, 0])).currentStreak, 0);
  assert.equal(calculateContributions(calendar([0, 2, 1, 3])).currentStreak, 3);
});

test('longest streak and totals include leap day and stay within the window', () => {
  const result = calculateContributions(calendar([1, 2, 0, 5], '2024-02-28'));
  assert.equal(result.days[1].date, '2024-02-29');
  assert.equal(result.longestStreak, 2);
  assert.equal(result.total, 8);
  assert.deepEqual(result.bestDay, { date: '2024-03-02', count: 5 });
  assert.equal(result.last30Days, 8);
});

test('incomplete, duplicate and inconsistent calendars fail instead of becoming zero', () => {
  const missing = calendar([1, 0, 2]);
  missing.days.splice(1, 1);
  assert.throws(() => calculateContributions(missing), /Incomplete/);
  const duplicate = calendar([1, 2]);
  duplicate.days.push(duplicate.days[0]);
  assert.throws(() => calculateContributions(duplicate), /duplicate/);
  assert.throws(() => calculateContributions({ ...calendar([1, 2]), total: 99 }), /total/);
});

test('zero activity has no best day and zero streaks', () => {
  const result = calculateContributions(calendar([0, 0]));
  assert.equal(result.currentStreak, 0);
  assert.equal(result.longestStreak, 0);
  assert.equal(result.bestDay, null);
});

test('language percentages use all languages, including ones outside the display limit', () => {
  const result = aggregateLanguages([{ name: 'a', bytes: { TypeScript: 600, Python: 300, CSS: 100 } }], 2);
  assert.equal(result.totalBytes, 1000);
  assert.deepEqual(result.items.map(item => item.percent), [60, 30]);
  assert.deepEqual(aggregateLanguages([], 6).items, []);
});

test('repository filters exclude forks, private repos, archives and named exclusions', () => {
  const repos = [{ name: 'Good' }, { name: 'Fork', fork: true }, { name: 'Archive', archived: true }, { name: 'Secret', private: true }, { name: 'Jikugodwill' }];
  assert.deepEqual(selectLanguageRepositories(repos, ['jikugodwill']).map(repo => repo.name), ['Good']);
});

test('active repos measure recent pushes, not deployments', () => {
  const repos = [{ pushed_at: '2026-09-30' }, { pushed_at: '2026-09-30', fork: true }, { pushed_at: '2026-01-01' }, { pushed_at: '2026-10-02' }];
  assert.deepEqual(calculateRepositoryMetrics(repos, new Date('2026-10-01T00:00:00Z'), 90), { publicRepositories: 4, activeRepositories: 1 });
});

test('repository pagination continues past 100 entries', async () => {
  const paths = [];
  const repo = { owner: { login: 'Jikugodwill' }, private: false };
  const result = await fetchOwnedPublicRepositories(async path => { paths.push(path); return paths.length === 1 ? Array.from({ length: 100 }, () => repo) : [repo]; }, 'Jikugodwill');
  assert.equal(result.length, 101);
  assert.match(paths[1], /page=2/);
});

test('GraphQL partial errors fail the refresh', async () => {
  const request = createGitHubClient('fake-test-token', async () => new Response(JSON.stringify({ errors: [{ message: 'Access denied' }] }), { status: 200 }));
  await assert.rejects(() => request('/graphql', { query: 'query {}' }), /Access denied/);
});

test('year queries respect account creation and stop the current year at now', async () => {
  const now = new Date('2026-10-01T06:00:00Z');
  let body;
  await fetchContributionCalendars(async (_path, requestBody) => {
    body = requestBody;
    return { data: { user: { window: { contributionCalendar: { totalContributions: 0, weeks: [] } }, y2025: { contributionCalendar: { totalContributions: 0 } }, y2026: { contributionCalendar: { totalContributions: 0 } } } } };
  }, 'Jikugodwill', { windowDays: 365, yearCount: 4 }, now, '2025-06-01T00:00:00Z');
  assert.equal(body.variables.from, '2025-10-02T00:00:00.000Z');
  assert.equal(body.variables.to2026, now.toISOString());
  assert.equal(body.variables.from2024, undefined);
});

test('SVG text safely escapes XML special characters', () => {
  assert.equal(escapeXml('A&B <"x">'), 'A&amp;B &lt;&quot;x&quot;&gt;');
});
