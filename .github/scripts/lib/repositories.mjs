export function selectLanguageRepositories(repositories, excludedNames = []) {
  const excluded = new Set(excludedNames.map(name => name.toLowerCase()));
  return repositories.filter(repo => !repo.private && !repo.fork && !repo.archived && !excluded.has(repo.name.toLowerCase()));
}

export function calculateRepositoryMetrics(repositories, now, activeDays) {
  const cutoff = now.getTime() - activeDays * 86_400_000;
  return {
    publicRepositories: repositories.length,
    activeRepositories: repositories.filter(repo => !repo.fork && !repo.archived && repo.pushed_at && Date.parse(repo.pushed_at) >= cutoff && Date.parse(repo.pushed_at) <= now.getTime()).length
  };
}

export function aggregateLanguages(repositoryLanguages, limit) {
  const totals = new Map();
  for (const repo of repositoryLanguages) {
    for (const [name, bytes] of Object.entries(repo.bytes)) {
      if (!Number.isSafeInteger(bytes) || bytes < 0) throw new Error('Invalid repository language byte count.');
      totals.set(name, (totals.get(name) ?? 0) + bytes);
    }
  }
  const totalBytes = [...totals.values()].reduce((sum, value) => sum + value, 0);
  return {
    repositoryCount: repositoryLanguages.length,
    totalBytes,
    items: [...totals.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, limit)
      .map(([name, bytes]) => ({ name, bytes, percent: totalBytes ? bytes / totalBytes * 100 : 0 }))
  };
}


export function rankProjects(activity, limit = 4, exclusions = []) {
  const excluded = new Set(exclusions.map(name => name.toLowerCase()));
  const projects = new Map();
  for (const category of ['commits', 'pullRequests', 'issues', 'reviews']) {
    for (const entry of activity[category]) {
      const repo = entry.repository;
      if (!repo || repo.isPrivate || excluded.has(repo.nameWithOwner.toLowerCase())) continue;
      const count = entry.contributions.totalCount;
      if (!Number.isInteger(count) || count < 0) throw new Error('Invalid project contribution count.');
      const project = projects.get(repo.nameWithOwner) || { name: repo.name, nameWithOwner: repo.nameWithOwner, url: repo.url, total: 0, commits: 0, pullRequests: 0, issues: 0, reviews: 0 };
      project[category] += count;
      project.total += count;
      projects.set(repo.nameWithOwner, project);
    }
  }
  return [...projects.values()].filter(project => project.total > 0).sort((a, b) => b.total - a.total || a.nameWithOwner.localeCompare(b.nameWithOwner, 'en')).slice(0, limit);
}
