const dayMs = 86_400_000;

export function calculateContributions(calendar) {
  const start = Date.parse(`${calendar.start}T00:00:00Z`);
  const end = Date.parse(`${calendar.end}T00:00:00Z`);
  if (!Number.isFinite(start) || !Number.isFinite(end) || start > end) throw new Error('Invalid contribution window.');
  const counts = new Map();
  for (const day of calendar.days) {
    if (!Number.isInteger(day.contributionCount) || day.contributionCount < 0 || counts.has(day.date)) {
      throw new Error('Invalid or duplicate contribution day.');
    }
    counts.set(day.date, day.contributionCount);
  }

  const days = [];
  for (let time = start; time <= end; time += dayMs) {
    const date = new Date(time).toISOString().slice(0, 10);
    // Missing dates must fail instead of quietly inventing zeros.
    if (!counts.has(date)) throw new Error(`Incomplete contribution calendar: ${date}`);
    days.push({ date, weekday: new Date(time).getUTCDay(), count: counts.get(date) });
  }

  let run = 0;
  let longestStreak = 0;
  let bestDay = null;
  for (const day of days) {
    run = day.count > 0 ? run + 1 : 0;
    longestStreak = Math.max(longestStreak, run);
    if (day.count > (bestDay?.count ?? 0)) bestDay = day;
  }
  let currentStreak = 0;
  let index = days.length - 1;
  // Today can still be in progress: yesterday may anchor an active streak.
  if (days[index]?.count === 0) index--;
  while (index >= 0 && days[index].count > 0) { currentStreak++; index--; }
  const total = days.reduce((sum, day) => sum + day.count, 0);
  if (total !== calendar.total) throw new Error('Contribution calendar total does not match daily counts.');

  return {
    total,
    currentStreak,
    longestStreak,
    bestDay: bestDay ? { date: bestDay.date, count: bestDay.count } : null,
    last30Days: days.slice(-30).reduce((sum, day) => sum + day.count, 0),
    days
  };
}
