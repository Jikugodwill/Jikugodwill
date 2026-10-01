import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateContributions } from '../lib/contributions.mjs';
import { aggregateLanguages, selectLanguageRepositories, calculateRepositoryMetrics, rankProjects } from '../lib/repositories.mjs';
import { fetchOwnedPublicRepositories, fetchContributionCalendars, createGitHubClient, fetchProjectActivity } from '../lib/github.mjs';
import { escapeXml, renderTelemetry } from '../lib/render-svg.mjs';

function calendar(counts, start = '2026-09-24') {
  const startTime = Date.parse(`${start}T00:00:00Z`);
  const days = counts.map((contributionCount, index) => ({ date: new Date(startTime + index * 86_400_000).toISOString().slice(0, 10), contributionCount, weekday: new Date(startTime + index * 86_400_000).getUTCDay(), contributionLevel: contributionCount ? 'SECOND_QUARTILE' : 'NONE' }));
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
    return { data: { user: { window: { contributionCalendar: { totalContributions: 0, weeks: [{ contributionDays: calendar([0]).days }] } }, y2025: { contributionCalendar: { totalContributions: 0 } }, y2026: { contributionCalendar: { totalContributions: 0 } } } } };
  }, 'Jikugodwill', { windowDays: 365, yearCount: 4 }, now, '2025-06-01T00:00:00Z');
  assert.equal(body.variables.from, undefined);
  assert.match(body.query, /window: contributionsCollection \{/);
  assert.equal(body.variables.to2026, now.toISOString());
  assert.equal(body.variables.from2024, undefined);
});

test('SVG text safely escapes XML special characters', () => {
  assert.equal(escapeXml('A&B <"x">'), 'A&amp;B &lt;&quot;x&quot;&gt;');
});


test('GitHub levels survive even when equal counts use different authoritative tiers', () => {
  const input = calendar([1, 1]);
  input.days[1].contributionLevel = 'FOURTH_QUARTILE';
  assert.deepEqual(calculateContributions(input).days.map(day => day.level), ['SECOND_QUARTILE', 'FOURTH_QUARTILE']);
});

test('projects include organization work, combine activity types and exclude private/profile names', () => {
  const entry = (name, count, isPrivate = false) => ({ repository: { name: name.split('/')[1], nameWithOwner: name, url: `https://github.com/${name}`, isPrivate }, contributions: { totalCount: count } });
  const activity = { commits: [entry('org/build', 3), entry('me/profile', 99), entry('secret/work', 999, true)], pullRequests: [entry('org/build', 2), entry('org/other', 4)], issues: [], reviews: [entry('org/other', 1)] };
  const result = rankProjects(activity, 4, ['ME/PROFILE']);
  assert.deepEqual(result.map(p => [p.nameWithOwner, p.total]), [['org/build', 5], ['org/other', 5]]);
  assert.equal(result.length, 2);
  assert.equal(result[0].pullRequests, 2);
  assert.deepEqual(rankProjects({ commits: [], pullRequests: [], issues: [], reviews: [] }), []);
});

test('project API uses exactly 90 UTC dates and includes first/popular issues and PRs', async () => {
  let body;
  const result = await fetchProjectActivity(async (_path, b) => { body = b; return { data: { user: { contributionsCollection: { commits: [], pullRequests: [], issues: [], reviews: [] } } } }; }, 'me', new Date('2026-10-01T06:00:00Z'));
  assert.equal(result.start, '2026-07-04');
  assert.equal(body.variables.to, '2026-10-01T06:00:00.000Z');
  assert.match(body.query, /excludeFirst: false, excludePopular: false/);
});

test('SVG omits the duplicate calendar and safely displays project names', () => {
  const input = calendar([1, 1]);
  input.days[1].contributionLevel = 'FOURTH_QUARTILE';
  const contribution = calculateContributions(input);
  const data = { username: 'me', syncedDateUTC: input.end, summary: { totalContributions: 2, currentStreak: 2, longestStreak: 2, bestDay: contribution.bestDay, last30Days: 2, publicRepositories: 1, activeRepositories: 1 }, activeRepositoryDays: 90, years: [], languages: { items: [], repositoryCount: 0 }, window: { start: input.start, end: input.end, days: 2 }, calendar: contribution.days, projectWindow: { days: 90 }, topProjects: [{ nameWithOwner: 'org/A&B', total: 2, commits: 2, pullRequests: 0, issues: 0, reviews: 0 }] };
  const svg = renderTelemetry(data);
  assert.doesNotMatch(svg, /CONTRIBUTION CALENDAR/);
  assert.doesNotMatch(svg, /<title>2026-09-24/);
  assert.match(svg, /org\/A&amp;B/);
  assert.match(svg, /TOP PUBLIC PROJECTS/);
});

