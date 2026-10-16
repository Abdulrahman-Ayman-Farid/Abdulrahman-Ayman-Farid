// Renders dist/contrib-orbit.svg: every contribution year as a labeled, animated space-themed calendar,
// plus all-time stats and a month-by-month thrust chart. Runs in the snake workflow (needs GITHUB_TOKEN).
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

const user = process.env.GH_USER;
const out = process.env.OUT_FILE || "dist/contrib-orbit.svg";
const token = process.env.GITHUB_TOKEN;

const gql = async (query, variables) => {
  const res = await fetch("https://api.github.com/graphql", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", "User-Agent": "contrib-orbit" },
    body: JSON.stringify({ query, variables }),
  });
  const json = await res.json();
  if (json.errors) throw new Error(JSON.stringify(json.errors));
  return json.data;
};

const CAL = `query($login:String!,$from:DateTime,$to:DateTime){user(login:$login){
  contributionsCollection(from:$from,to:$to){contributionYears
    contributionCalendar{totalContributions weeks{contributionDays{date contributionCount weekday}}}}}}`;

const { user: me } = await gql(CAL, { login: user });
const years = me.contributionsCollection.contributionYears.sort((a, b) => b - a);
const now = new Date();
const calendars = [];
for (const y of years) {
  const to = y === now.getUTCFullYear() ? now.toISOString() : `${y}-12-31T23:59:59Z`;
  const d = await gql(CAL, { login: user, from: `${y}-01-01T00:00:00Z`, to });
  const cal = d.user.contributionsCollection.contributionCalendar;
  calendars.push({ year: y, total: cal.totalContributions, weeks: cal.weeks.map((w) => w.contributionDays) });
}

// ---------- stats ----------
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const fmt = (n) => n.toLocaleString("en-US");
const fmtDate = (iso, withYear = true) => {
  const [y, m, d] = iso.split("-").map(Number);
  return `${MONTHS[m - 1]} ${d}${withYear ? `, ${y}` : ""}`;
};

const allDays = calendars
  .flatMap((c) => c.weeks.flat())
  .sort((a, b) => a.date.localeCompare(b.date));
const total = calendars.reduce((s, c) => s + c.total, 0);
const activeDays = allDays.filter((d) => d.contributionCount > 0).length;
const best = allDays.reduce((b, d) => (d.contributionCount > b.contributionCount ? d : b), allDays[0]);

let longest = { len: 0 }, run = 0, runStart = null;
for (const d of allDays) {
  if (d.contributionCount > 0) {
    if (run === 0) runStart = d.date;
    run++;
    if (run > longest.len) longest = { len: run, from: runStart, to: d.date };
  } else run = 0;
}
// Current streak: today may still be empty, so start from yesterday in that case.
let current = 0;
for (let i = allDays.length - 1; i >= 0; i--) {
  if (allDays[i].contributionCount > 0) current++;
  else if (i === allDays.length - 1) continue;
  else break;
}
const byWeekday = Array(7).fill(0);
for (const d of allDays) byWeekday[d.weekday] += d.contributionCount;
const busiest = byWeekday.indexOf(Math.max(...byWeekday));

const monthly = new Map();
for (const d of allDays) {
  const k = d.date.slice(0, 7);
  monthly.set(k, (monthly.get(k) || 0) + d.contributionCount);
}
// Start the thrust chart at the first month with any activity.
const monthKeys = [...monthly.keys()];
const firstActive = monthKeys.findIndex((k) => monthly.get(k) > 0);
const months = monthKeys.slice(Math.max(0, firstActive));

// Intensity levels from quartiles of non-zero days across all years.
const nz = allDays.map((d) => d.contributionCount).filter((n) => n > 0).sort((a, b) => a - b);
const q = (p) => nz[Math.min(nz.length - 1, Math.floor(p * nz.length))] || 1;
const [q1, q2, q3, q9] = [q(0.25), q(0.5), q(0.75), q(0.93)];
const level = (n) => (n === 0 ? 0 : n <= q1 ? 1 : n <= q2 ? 2 : n <= q3 ? 3 : 4);
const COLORS = ["#161B3D", "#312E81", "#4F46E5", "#8B5CF6", "#22D3EE"];

// ---------- layout ----------
const W = 1000, CELL = 13, PITCH = 16, GX = 104;
const parts = [];
let y = 0;

// header
parts.push(`<text x="32" y="42" class="head">// CONTRIBUTION ORBIT · FLIGHT LOG</text>`);
const launch = allDays.find((d) => d.contributionCount > 0) || allDays[0];
parts.push(`<text x="32" y="62" class="sub">${years.length} YEARS IN ORBIT · LAUNCHED ${fmtDate(launch.date).toUpperCase()} · ${fmt(Math.round(total / Math.max(1, months.length)))} CONTRIBUTIONS / MONTH ON AVERAGE</text>`);
parts.push(`<circle cx="${W - 40}" cy="38" r="4" fill="#34D399" class="pulse"/>`);

const tiles = [
  [fmt(total), "TOTAL CONTRIBUTIONS", "#22D3EE"],
  [fmt(activeDays), "ACTIVE DAYS", "#A78BFA"],
  [`${longest.len}d`, "LONGEST STREAK", "#F472B6", longest.len ? `${fmtDate(longest.from, false)} – ${fmtDate(longest.to)}` : ""],
  [`${current}d`, "CURRENT STREAK", "#34D399"],
  [fmt(best.contributionCount), "BEST DAY", "#FBBF24", fmtDate(best.date)],
  [WEEKDAYS[busiest].slice(0, 3).toUpperCase(), "BUSIEST WEEKDAY", "#818CF8"],
];
const TW = 148, TG = 8, TX = (W - (tiles.length * TW + (tiles.length - 1) * TG)) / 2;
tiles.forEach(([v, l, c, note], i) => {
  const x = TX + i * (TW + TG);
  parts.push(`<g transform="translate(${x} 82)" class="rise" style="animation-delay:${(i * 0.08).toFixed(2)}s">`);
  parts.push(`<rect width="${TW}" height="84" rx="12" fill="url(#tile)" stroke="${c}" stroke-opacity=".5"/>`);
  parts.push(`<text x="${TW / 2}" y="38" text-anchor="middle" class="big" fill="${c}" filter="url(#glow)">${v}</text>`);
  parts.push(`<text x="${TW / 2}" y="58" text-anchor="middle" class="tl">${l}</text>`);
  if (note) parts.push(`<text x="${TW / 2}" y="73" text-anchor="middle" class="note">${note}</text>`);
  parts.push(`</g>`);
});

// monthly thrust chart
y = 196;
parts.push(`<text x="32" y="${y}" class="sec">MONTHLY THRUST</text>`);
const CH = 64, CX = 32, CWID = W - 64, cy0 = y + 14;
const maxM = Math.max(...months.map((k) => monthly.get(k)), 1);
const bw = CWID / months.length;
months.forEach((k, i) => {
  const v = monthly.get(k);
  const h = Math.max(v ? 3 : 1, (v / maxM) * CH);
  const x = CX + i * bw;
  const col = v === maxM ? "#22D3EE" : "url(#bar)";
  parts.push(
    `<rect x="${(x + 1.5).toFixed(1)}" y="${(cy0 + CH - h).toFixed(1)}" width="${Math.max(2, bw - 3).toFixed(1)}" height="${h.toFixed(1)}" rx="2" fill="${col}" class="grow" style="animation-delay:${(i * 0.025).toFixed(2)}s"/>`
  );
  // Label each January; label the first bar too unless a January follows within 4 bars.
  const nextJan = months.findIndex((m, j) => j > i && m.endsWith("-01"));
  if (k.endsWith("-01") || (i === 0 && (nextJan === -1 || nextJan > 4))) {
    parts.push(`<line x1="${x.toFixed(1)}" y1="${cy0 - 2}" x2="${x.toFixed(1)}" y2="${cy0 + CH + 4}" stroke="#312E81" stroke-dasharray="2 3"/>`);
    parts.push(`<text x="${(x + 3).toFixed(1)}" y="${cy0 + CH + 16}" class="axis">${k.slice(0, 4)}</text>`);
  }
});
const peak = months.find((k) => monthly.get(k) === maxM);
parts.push(`<text x="${W - 32}" y="${y}" text-anchor="end" class="note">peak: ${MONTHS[+peak.slice(5) - 1]} ${peak.slice(0, 4)} · ${fmt(maxM)} contributions</text>`);

// year calendars
y = cy0 + CH + 46;
calendars.forEach((c, yi) => {
  const days = c.weeks.flat();
  const yBest = days.reduce((b, d) => (d.contributionCount > b.contributionCount ? d : b), days[0]);
  const yActive = days.filter((d) => d.contributionCount > 0).length;
  parts.push(`<text x="32" y="${y}" class="year">${c.year}</text>`);
  parts.push(
    `<text x="${GX}" y="${y}" class="ysub"><tspan fill="#22D3EE" font-weight="700">${fmt(c.total)}</tspan> contributions · ${yActive} active days` +
      (yBest.contributionCount ? ` · best day ${fmtDate(yBest.date, false)} (${yBest.contributionCount})` : "") +
      `</text>`
  );
  const top = y + 26;
  let lastLabel = -9, lastMonth = -1;
  c.weeks.forEach((week, wi) => {
    const first = week[0];
    const m = +first.date.slice(5, 7) - 1;
    if (m !== lastMonth && wi - lastLabel >= 3) {
      parts.push(`<text x="${GX + wi * PITCH}" y="${top - 6}" class="axis">${MONTHS[m]}</text>`);
      lastLabel = wi;
    }
    lastMonth = m;
    for (const d of week) {
      const n = d.contributionCount;
      const lv = level(n);
      const cls = n >= q9 && n > 0 ? "c hot" : "c";
      const delay = (yi * 0.35 + wi * 0.018).toFixed(3);
      parts.push(
        `<rect x="${GX + wi * PITCH}" y="${top + d.weekday * PITCH}" width="${CELL}" height="${CELL}" rx="3" fill="${COLORS[lv]}"` +
          (lv === 0 ? ` stroke="#232B5C" stroke-width=".6"` : "") +
          ` class="${cls}" style="animation-delay:${delay}s"/>`
      );
    }
  });
  ["Mon", "Wed", "Fri"].forEach((l, i) =>
    parts.push(`<text x="${GX - 10}" y="${top + (i * 2 + 1) * PITCH + 10}" text-anchor="end" class="axis">${l}</text>`)
  );
  y = top + 7 * PITCH + 40;
});

// legend
const ly = y - 12;
parts.push(`<text x="32" y="${ly + 10}" class="note">Updated ${fmtDate(now.toISOString().slice(0, 10))} · glowing cells = top 7% days</text>`);
const lx = W - 32 - (COLORS.length * PITCH + 70);
parts.push(`<text x="${lx}" y="${ly + 10}" class="axis">Less</text>`);
COLORS.forEach((col, i) =>
  parts.push(`<rect x="${lx + 32 + i * PITCH}" y="${ly}" width="${CELL}" height="${CELL}" rx="3" fill="${col}"${i === 0 ? ' stroke="#232B5C" stroke-width=".6"' : ""}/>`)
);
parts.push(`<text x="${lx + 36 + COLORS.length * PITCH}" y="${ly + 10}" class="axis">More</text>`);
const H = ly + 34;

// background stars
let seed = 11;
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
const stars = Array.from({ length: 110 }, () => {
  const r = [0.6, 0.8, 1, 1.3][Math.floor(rnd() * 4)];
  return `<circle cx="${(rnd() * W).toFixed(1)}" cy="${(rnd() * H).toFixed(1)}" r="${r}" fill="#E0E7FF" class="tw" style="animation-duration:${(2.5 + rnd() * 4).toFixed(1)}s;animation-delay:-${(rnd() * 6).toFixed(1)}s"/>`;
}).join("");

const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-labelledby="t d">
<title id="t">Contribution orbit</title>
<desc id="d">${fmt(total)} GitHub contributions across ${years.join(", ")}. Longest streak ${longest.len} days, best day ${best.contributionCount} contributions on ${fmtDate(best.date)}.</desc>
<defs>
  <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#03040C"/><stop offset=".55" stop-color="#0B1026"/><stop offset="1" stop-color="#150F3A"/></linearGradient>
  <linearGradient id="tile" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#131A3D"/><stop offset="1" stop-color="#0A0F28"/></linearGradient>
  <linearGradient id="bar" x1="0" y1="1" x2="0" y2="0"><stop offset="0" stop-color="#4F46E5"/><stop offset="1" stop-color="#A78BFA"/></linearGradient>
  <linearGradient id="sweep" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#22D3EE" stop-opacity="0"/><stop offset=".5" stop-color="#22D3EE" stop-opacity=".10"/><stop offset="1" stop-color="#22D3EE" stop-opacity="0"/></linearGradient>
  <filter id="glow" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="1.8" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
  <clipPath id="clip"><rect width="${W}" height="${H}" rx="18"/></clipPath>
</defs>
<style>
  text{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}
  .head{font-size:13px;fill:#67E8F9;letter-spacing:3px}
  .sub{font-size:11px;fill:#818CF8;letter-spacing:2px}
  .sec{font-size:12px;fill:#C7D2FE;letter-spacing:2.5px;font-weight:600}
  .big{font-size:26px;font-weight:800}
  .tl{font-size:10px;fill:#E0E7FF;letter-spacing:1.2px}
  .note{font-size:10px;fill:#94A3B8}
  .axis{font-size:10px;fill:#94A3B8}
  .year{font-size:20px;font-weight:800;fill:#E0E7FF}
  .ysub{font-size:12px;fill:#C7D2FE}
  .tw{animation:tw 4s ease-in-out infinite}
  @keyframes tw{0%,100%{opacity:.12}50%{opacity:.9}}
  .pulse{animation:pl 2.4s ease-in-out infinite}
  @keyframes pl{0%,100%{opacity:.4}50%{opacity:1}}
  .c{animation:pop .5s ease-out backwards}
  @keyframes pop{from{opacity:0}to{opacity:1}}
  .hot{animation:pop .5s ease-out backwards,hot 2.6s ease-in-out 3s infinite;filter:url(#glow)}
  @keyframes hot{0%,100%{opacity:1}50%{opacity:.55}}
  .grow{animation:pop .6s ease-out backwards}
  .rise{animation:pop .7s ease-out backwards}
  .sw{animation:sw 10s linear infinite}
  @keyframes sw{from{transform:translateX(-300px)}to{transform:translateX(${W + 60}px)}}
</style>
<g clip-path="url(#clip)">
  <rect width="${W}" height="${H}" fill="url(#bg)"/>
  ${stars}
  <rect class="sw" width="300" height="${H}" fill="url(#sweep)"/>
</g>
<rect x=".5" y=".5" width="${W - 1}" height="${H - 1}" rx="18" fill="none" stroke="#312E81"/>
${parts.join("\n")}
</svg>
`;
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, svg);
console.log(`wrote ${out}: ${fmt(total)} contributions, ${years.length} years, longest ${longest.len}d, current ${current}d, best ${best.contributionCount} on ${best.date}`);
