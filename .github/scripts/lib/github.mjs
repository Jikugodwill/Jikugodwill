import { setTimeout as delay } from 'node:timers/promises';

const api = 'https://api.github.com';

export function createGitHubClient(token, fetcher = fetch) {
  if (!token) throw new Error('GITHUB_TOKEN is required. Run the GitHub Actions workflow.');

  return async function request(path, body) {
    for (let attempt = 0; attempt < 3; attempt++) {
      let response;
      try {
        response = await fetcher(`${api}${path}`, {
          method: body ? 'POST' : 'GET',
          headers: {
            Authorization: `Bearer ${token}`,
            Accept: 'application/vnd.github+json',
            'Content-Type': 'application/json',
            'X-GitHub-Api-Version': '2022-11-28',
            'User-Agent': 'jikugodwill-profile'
          },
          ...(body ? { body: JSON.stringify(body) } : {}),
          signal: AbortSignal.timeout(15_000)
        });
      } catch {
        if (attempt === 2) throw new Error(`GitHub request failed or timed out: ${path}`);
        await delay(1000 * (attempt + 1));
        continue;
      }

      if (response.status >= 500 && attempt < 2) {
        await delay(1000 * (attempt + 1));
        continue;
      }
      if (!response.ok) {
        throw new Error(`GitHub returned HTTP ${response.status} for ${path}. Check token access or rate limits.`);
      }
      const result = await response.json();
      if (result.errors?.length) {
        throw new Error(`GitHub GraphQL failed: ${result.errors.map(e => e.message).join('; ')}`);
      }
      return result;
    }
  };
}

export async function fetchOwnedPublicRepositories(request, username) {
  const repositories = [];
  for (let page = 1; ; page++) {
    const batch = await request(`/users/${encodeURIComponent(username)}/repos?type=owner&sort=full_name&direction=asc&per_page=100&page=${page}`);
    if (!Array.isArray(batch)) throw new Error('Unexpected repository response.');
    repositories.push(...batch.filter(repo => !repo.private && repo.owner?.login?.toLowerCase() === username.toLowerCase()));
    if (batch.length < 100) break;
  }
  return repositories;
}

export async function fetchContributionCalendars(request, username, config, now, createdAt) {
  const today = now.toISOString().slice(0, 10);
  const currentYear = now.getUTCFullYear();
  const firstYear = Math.max(currentYear - config.yearCount + 1, new Date(createdAt).getUTCFullYear());
  const years = Array.from({ length: currentYear - firstYear + 1 }, (_, i) => firstYear + i);
  const fields = `totalContributions weeks { contributionDays { date weekday contributionCount contributionLevel } }`;
  const definitions = ['$login: String!'];
  const variables = { login: username };
  const selections = [`window: contributionsCollection { contributionCalendar { ${fields} } }`];

  for (const year of years) {
    definitions.push(`$from${year}: DateTime!`, `$to${year}: DateTime!`);
    variables[`from${year}`] = `${year}-01-01T00:00:00Z`;
    variables[`to${year}`] = year === currentYear ? now.toISOString() : `${year}-12-31T23:59:59Z`;
    selections.push(`y${year}: contributionsCollection(from: $from${year}, to: $to${year}) { contributionCalendar { totalContributions } }`);
  }

  const query = `query Profile(${definitions.join(', ')}) { user(login: $login) { ${selections.join('\n')} } }`;
  const result = await request('/graphql', { query, variables });
  const user = result.data?.user;
  if (!user?.window?.contributionCalendar) throw new Error('Contribution calendar unavailable; keeping previous output.');
  const calendar = user.window.contributionCalendar;
  const days = calendar.weeks.flatMap(week => week.contributionDays).filter(day => day.date <= today);
  if (!days.length) throw new Error('Empty GitHub contribution calendar.');

  return {
    start: days[0].date,
    end: days.at(-1).date,
    total: calendar.totalContributions,
    days,
    years: years.map(year => ({ year, total: user[`y${year}`].contributionCalendar.totalContributions, partial: year === currentYear }))
  };
}

export async function fetchRepositoryLanguages(request, repositories) {
  const results = new Array(repositories.length);
  let cursor = 0;
  async function worker() {
    while (cursor < repositories.length) {
      const index = cursor++;
      const repo = repositories[index];
      const bytes = await request(`/repos/${encodeURIComponent(repo.owner.login)}/${encodeURIComponent(repo.name)}/languages`);
      results[index] = { name: repo.name, bytes };
    }
  }
  await Promise.all(Array.from({ length: Math.min(3, repositories.length) }, worker));
  return results;
}


export async function fetchProjectActivity(request, username, now, windowDays = 90) {
  const start = new Date(`${now.toISOString().slice(0, 10)}T00:00:00Z`);
  start.setUTCDate(start.getUTCDate() - windowDays + 1);
  const fields = 'repository { name nameWithOwner url isPrivate } contributions { totalCount }';
  const query = `query Projects($login: String!, $from: DateTime!, $to: DateTime!) {
    user(login: $login) { contributionsCollection(from: $from, to: $to) {
      commits: commitContributionsByRepository(maxRepositories: 100) { ${fields} }
      pullRequests: pullRequestContributionsByRepository(maxRepositories: 100, excludeFirst: false, excludePopular: false) { ${fields} }
      issues: issueContributionsByRepository(maxRepositories: 100, excludeFirst: false, excludePopular: false) { ${fields} }
      reviews: pullRequestReviewContributionsByRepository(maxRepositories: 100) { ${fields} }
    } }
  }`;
  const result = await request('/graphql', { query, variables: { login: username, from: start.toISOString(), to: now.toISOString() } });
  const activity = result.data?.user?.contributionsCollection;
  if (!activity) throw new Error('Recent project activity unavailable.');
  // At the API cap we cannot safely promise an account-wide ranking.
  for (const category of ['commits', 'pullRequests', 'issues', 'reviews']) {
    if (!Array.isArray(activity[category])) throw new Error(`Missing project category: ${category}`);
    if (activity[category].length >= 100) throw new Error('Project activity reached the API repository cap; keeping previous output.');
  }
  return { start: start.toISOString().slice(0, 10), end: now.toISOString().slice(0, 10), days: windowDays, activity };
}
