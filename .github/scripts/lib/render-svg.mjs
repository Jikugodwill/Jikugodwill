export function escapeXml(value) {
  return String(value).replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[character]));
}

const colors = ['#A78BFA', '#56E0B5', '#F6B84A', '#8AB4F8', '#E8A0C4', '#B9C787'];
const number = value => new Intl.NumberFormat('en-US').format(value);
const shortDate = value => new Date(`${value}T00:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
const text = (x, y, value, size = 14, color = '#B8C1D4', extra = '') => `<text x="${x}" y="${y}" font-size="${size}" fill="${color}" ${extra}>${escapeXml(value)}</text>`;

export function renderTelemetry(data) {
  const stats = [
    ['CONTRIBUTIONS', number(data.summary.totalContributions), 'displayed window'],
    ['CURRENT STREAK', `${data.summary.currentStreak}d`, 'today or yesterday'],
    ['LONGEST STREAK', `${data.summary.longestStreak}d`, 'within this window'],
    ['BEST DAY', number(data.summary.bestDay?.count ?? 0), data.summary.bestDay ? shortDate(data.summary.bestDay.date) : 'no activity'],
    ['PUBLIC REPOS', number(data.summary.publicRepositories), 'owned, incl. forks'],
    ['ACTIVE REPOS', number(data.summary.activeRepositories), `pushed in ${data.activeRepositoryDays} days`]
  ].map(([label, value, detail], index) => {
    const x = 44 + index * 188;
    return `<g><rect x="${x}" y="120" width="172" height="114" rx="12" fill="#10172A" stroke="#29334B"/>${text(x + 16, 146, label, 11, '#A3AEC5')}${text(x + 16, 190, value, 30, colors[index], 'font-weight="700"')}${text(x + 16, 215, detail, 10, '#A3AEC5')}</g>`;
  }).join('\n');

  const maxYear = Math.max(1, ...data.years.map(year => year.total));
  const years = data.years.map((year, index) => {
    const y = 310 + index * 42;
    const width = year.total / maxYear * 330;
    return `${text(48, y + 13, `${year.year}${year.partial ? '*' : ''}`, 13)}<rect x="112" y="${y}" width="330" height="15" rx="7" fill="#202A40"/><rect x="112" y="${y}" width="${width.toFixed(2)}" height="15" rx="7" fill="url(#accent)"/>${text(548, y + 13, number(year.total), 13, '#E5EAF4', 'text-anchor="end"')}`;
  }).join('\n');

  const languages = data.languages.items.length ? data.languages.items.map((language, index) => {
    const y = 310 + index * 30;
    const width = language.percent / 100 * 250;
    const label = language.name.length > 15 ? `${language.name.slice(0, 14)}…` : language.name;
    return `${text(632, y + 13, label, 12)}<rect x="802" y="${y}" width="250" height="12" rx="6" fill="#202A40"/><rect x="802" y="${y}" width="${width.toFixed(2)}" height="12" rx="6" fill="${colors[index]}"/>${text(1146, y + 13, `${language.percent.toFixed(1)}%`, 13, '#E5EAF4', 'text-anchor="end"')}`;
  }).join('\n') : text(632, 337, 'No eligible language bytes returned.', 13);

  const first = data.calendar[0];
  const firstTime = first ? Date.parse(`${first.date}T00:00:00Z`) : 0;
  const firstSunday = firstTime - (first?.weekday ?? 0) * 86_400_000;
  const maxCount = Math.max(1, ...data.calendar.map(day => day.count));
  const cellColor = count => count === 0 ? '#202A40' : ['#27483F', '#378D76', '#56E0B5', '#C1F5E4'][Math.min(3, Math.ceil(count / maxCount * 4) - 1)];
  const cells = data.calendar.map(day => {
    const time = Date.parse(`${day.date}T00:00:00Z`);
    const column = Math.floor((time - firstSunday) / (7 * 86_400_000));
    return `<rect x="${84 + column * 19}" y="${602 + day.weekday * 19}" width="15" height="15" rx="3" fill="${cellColor(day.count)}"><title>${escapeXml(`${day.date}: ${day.count} contributions`)}</title></rect>`;
  }).join('\n');
  const months = data.calendar.filter((day, index) => index === 0 || day.date.endsWith('-01')).map(day => {
    const column = Math.floor((Date.parse(`${day.date}T00:00:00Z`) - firstSunday) / (7 * 86_400_000));
    return text(84 + column * 19, 587, new Date(`${day.date}T00:00:00Z`).toLocaleDateString('en-US', { month: 'short', timeZone: 'UTC' }), 10, '#A3AEC5');
  }).join('\n');

  return `<svg width="1200" height="850" viewBox="0 0 1200 850" fill="none" xmlns="http://www.w3.org/2000/svg" role="img" aria-labelledby="title desc">
  <title id="title">${escapeXml(data.username)} — GitHub engineering telemetry</title>
  <desc id="desc">${escapeXml(`${data.summary.totalContributions} contributions from ${data.window.start} to ${data.window.end}; ${data.summary.currentStreak} day current streak; ${data.summary.publicRepositories} owned public repositories. Language shares measure repository code bytes, not proficiency.`)}</desc>
  <defs>
    <linearGradient id="background" x2="1200" y2="850" gradientUnits="userSpaceOnUse"><stop stop-color="#070B16"/><stop offset="1" stop-color="#10162A"/></linearGradient>
    <linearGradient id="accent" x1="0" x2="1200" gradientUnits="userSpaceOnUse"><stop stop-color="#F6B84A"/><stop offset=".5" stop-color="#A78BFA"/><stop offset="1" stop-color="#56E0B5"/></linearGradient>
    <pattern id="grid" width="32" height="32" patternUnits="userSpaceOnUse"><path d="M32 0H0V32" stroke="#A78BFA" stroke-opacity=".045"/></pattern>
  </defs>
  <style>text{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,"Liberation Mono",monospace}</style>
  <rect x="1" y="1" width="1198" height="848" rx="22" fill="url(#background)" stroke="url(#accent)" stroke-width="2"/>
  <rect x="18" y="18" width="1164" height="814" rx="15" fill="url(#grid)"/>
  ${text(44, 43, `GITHUB // ${data.username.toUpperCase()}`, 12, '#A3AEC5', 'letter-spacing="2"')}
  ${text(44, 86, 'ENGINEERING TELEMETRY', 29, '#F8FAFC', 'font-weight="700"')}
  ${text(1152, 45, `SYNCED ${data.syncedDateUTC} UTC`, 11, '#56E0B5', 'text-anchor="end"')}
  ${text(1152, 82, `${data.window.days} DAYS // API-VISIBLE ACTIVITY`, 10, '#A3AEC5', 'text-anchor="end"')}
  ${stats}
  ${text(48, 280, 'CONTRIBUTIONS BY YEAR', 12, '#C4B5FD', 'letter-spacing="1.4"')}
  ${text(632, 280, 'PUBLIC REPOSITORY LANGUAGE BYTES', 12, '#C4B5FD', 'letter-spacing="1.1"')}
  ${years}
  ${languages}
  <path d="M592 262V502" stroke="#29334B"/>
  ${text(48, 498, '* Current year to date; bars share a common scale.', 10, '#A3AEC5')}
  ${text(632, 510, `${data.languages.repositoryCount} repos · excludes forks, archives & configured repos`, 10, '#A3AEC5')}
  <path d="M44 534H1156" stroke="#29334B"/>
  ${text(48, 562, 'CONTRIBUTION CALENDAR', 12, '#C4B5FD', 'letter-spacing="1.4"')}
  ${text(1152, 562, `${data.window.start} → ${data.window.end}`, 11, '#A3AEC5', 'text-anchor="end"')}
  ${months}
  ${text(46, 633, 'Mon', 10, '#A3AEC5')}${text(46, 671, 'Wed', 10, '#A3AEC5')}${text(46, 709, 'Fri', 10, '#A3AEC5')}
  ${cells}
  ${text(48, 762, `LAST 30 DAYS: ${number(data.summary.last30Days)} CONTRIBUTIONS`, 12, '#56E0B5')}
  ${text(914, 762, 'Less', 10, '#A3AEC5')}
  ${['#202A40', '#27483F', '#378D76', '#56E0B5', '#C1F5E4'].map((color, index) => `<rect x="${952 + index * 20}" y="750" width="15" height="15" rx="3" fill="${color}"/>`).join('')}
  ${text(1060, 762, 'More', 10, '#A3AEC5')}
  ${text(48, 804, 'Streaks: displayed window, UTC dates; today may still be in progress.', 11, '#A3AEC5')}
  ${text(48, 825, 'GitHub activity is a partial record of engineering work. Language bytes do not measure proficiency.', 10, '#A3AEC5')}
</svg>\n`;
}
