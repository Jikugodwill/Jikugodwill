import { readFile, mkdir, writeFile, rename } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { createGitHubClient, fetchOwnedPublicRepositories, fetchContributionCalendars, fetchRepositoryLanguages, fetchProjectActivity } from './lib/github.mjs';
import { calculateContributions } from './lib/contributions.mjs';
import { selectLanguageRepositories, calculateRepositoryMetrics, aggregateLanguages, rankProjects } from './lib/repositories.mjs';
import { renderTelemetry } from './lib/render-svg.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));

async function main() {
  const config = JSON.parse(await readFile(path.join(root, 'profile.config.json'), 'utf8'));
  const username = process.env.PROFILE_USERNAME || config.username;
  if (!/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/.test(username)) throw new Error('Invalid profile username.');
  for (const [key, maximum] of Object.entries({ projectWindowDays: 365, projectLimit: 4, yearCount: 4, activeRepositoryDays: 365, languageLimit: 6 })) {
    if (!Number.isInteger(config[key]) || config[key] < 1 || config[key] > maximum) throw new Error(`Invalid configuration: ${key}`);
  }

  const now = new Date();
  const ownerToken = process.env.PROFILE_METRICS_TOKEN;
  const request = createGitHubClient(ownerToken || process.env.GITHUB_TOKEN);
  if (ownerToken) {
    const viewer = await request('/user');
    if (viewer.login.toLowerCase() !== username.toLowerCase()) throw new Error('PROFILE_METRICS_TOKEN must belong to the profile owner.');
  }
  const profile = await request(`/users/${encodeURIComponent(username)}`);
  const repositories = await fetchOwnedPublicRepositories(request, username);
  const calendar = await fetchContributionCalendars(request, username, config, now, profile.created_at);
  const contributions = calculateContributions(calendar);
  const languageRepositories = selectLanguageRepositories(repositories, config.excludeLanguageRepositories);
  const languages = aggregateLanguages(await fetchRepositoryLanguages(request, languageRepositories), config.languageLimit);
  const repositoryMetrics = calculateRepositoryMetrics(repositories, now, config.activeRepositoryDays);

  const recent = await fetchProjectActivity(request, username, now, config.projectWindowDays);
  const topProjects = rankProjects(recent.activity, config.projectLimit, config.excludeProjectRepositories);

  // Only publish intentional aggregate data; never serialize raw API responses.
  const snapshot = {
    schemaVersion: 2,
    username: profile.login,
    syncedDateUTC: now.toISOString().slice(0, 10),
    source: 'GitHub GraphQL contribution calendar and REST public repositories/languages',
    contributionScope: ownerToken ? 'Owner-authorized aggregate calendar; private project names excluded.' : 'Workflow-token-visible calendar; private activity may be incomplete. See docs/profile-telemetry.md.',
    window: { start: calendar.start, end: calendar.end, days: contributions.days.length, timezone: 'UTC' },
    summary: { totalContributions: contributions.total, currentStreak: contributions.currentStreak, longestStreak: contributions.longestStreak, bestDay: contributions.bestDay, last30Days: contributions.last30Days, ...repositoryMetrics },
    activeRepositoryDays: config.activeRepositoryDays,
    languageScope: 'Owned public repositories, excluding forks, archives, and configured exclusions. Percentages use all eligible language bytes.',
    languages,
    years: calendar.years,
    projectWindow: { start: recent.start, end: recent.end, days: recent.days },
    projectScope: 'Your GitHub-counted commits, pull requests, issues and reviews in public repositories, including organization repositories; profile repository excluded.',
    topProjects,
    calendar: contributions.days
  };

  const svg = renderTelemetry(snapshot);
  const directory = path.join(root, 'assets');
  await mkdir(directory, { recursive: true });
  // Finish all API calls and rendering before changing the last successful files.
  const jsonPath = path.join(directory, 'github-data.json');
  const svgPath = path.join(directory, 'github-telemetry.svg');
  await writeFile(`${jsonPath}.tmp`, `${JSON.stringify(snapshot, null, 2)}\n`);
  await writeFile(`${svgPath}.tmp`, svg);
  await rename(`${jsonPath}.tmp`, jsonPath);
  await rename(`${svgPath}.tmp`, svgPath);
  console.log(`Generated telemetry for ${snapshot.username}: ${contributions.total} contributions in ${contributions.days.length} days.`);
}

main().catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});

