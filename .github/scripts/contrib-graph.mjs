// Renders a GitHub-style contribution graph for every year on the account, in light and dark
// variants (dist/contrib-graph-light.svg, dist/contrib-graph-dark.svg). Shading uses GitHub's own
// per-day contributionLevel, so each year matches what the profile shows for that year.
import { mkdirSync, writeFileSync } from "node:fs";

const user = process.env.GH_USER;
const outDir = process.env.OUT_DIR || "dist";
const token = process.env.GITHUB_TOKEN;

const gql = async (query, variables) => {
  const res = await fetch("https://api.github.com/graphql", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", "User-Agent": "contrib-graph" },
    body: JSON.stringify({ query, variables }),
  });
  const json = await res.json();
  if (json.errors) throw new Error(JSON.stringify(json.errors));
  return json.data;
};

const Q = `query($login:String!,$from:DateTime,$to:DateTime){user(login:$login){
  contributionsCollection(from:$from,to:$to){contributionYears
    contributionCalendar{totalContributions weeks{contributionDays{date weekday contributionLevel}}}}}}`;

const years = (await gql(Q, { login: user })).user.contributionsCollection.contributionYears.sort((a, b) => b - a);
const now = new Date();
const calendars = [];
for (const y of years) {
  const to = y === now.getUTCFullYear() ? now.toISOString() : `${y}-12-31T23:59:59Z`;
  const cal = (await gql(Q, { login: user, from: `${y}-01-01T00:00:00Z`, to })).user.contributionsCollection
    .contributionCalendar;
  calendars.push({ year: y, total: cal.totalContributions, weeks: cal.weeks.map((w) => w.contributionDays) });
}

const THEMES = {
  light: {
    text: "#1f2328", muted: "#59636e", border: "#d1d9e0", outline: "rgba(31,35,40,0.05)",
    levels: ["#eff2f5", "#aceebb", "#4ac26b", "#2da44e", "#116329"],
  },
  dark: {
    text: "#f0f6fc", muted: "#9198a1", border: "#3d444d", outline: "rgba(240,246,252,0.05)",
    levels: ["#151b23", "#033a16", "#196c2e", "#2ea043", "#56d364"],
  },
};
const LEVEL = { NONE: 0, FIRST_QUARTILE: 1, SECOND_QUARTILE: 2, THIRD_QUARTILE: 3, FOURTH_QUARTILE: 4 };
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const CELL = 10, PITCH = 13, PAD = 16, LABEL_W = 30, HEAD_H = 34, GAP = 24;
const cols = Math.max(...calendars.map((c) => c.weeks.length));
const boxW = PAD + LABEL_W + cols * PITCH + PAD;
const boxH = PAD + 18 + 7 * PITCH + 12 + 16 + PAD;
const W = boxW + 2;
const H = calendars.length * (HEAD_H + boxH + GAP) - GAP + 2;

function render(t) {
  const out = [];
  calendars.forEach((c, i) => {
    const top = 1 + i * (HEAD_H + boxH + GAP);
    const label = `${c.total.toLocaleString("en-US")} contribution${c.total === 1 ? "" : "s"} in ${c.year}`;
    out.push(`<text x="1" y="${top + 18}" font-size="16" fill="${t.text}">${label}</text>`);

    const bx = 1, by = top + HEAD_H;
    out.push(`<rect x="${bx + 0.5}" y="${by + 0.5}" width="${boxW - 1}" height="${boxH - 1}" rx="6" fill="none" stroke="${t.border}"/>`);
    const gx = bx + PAD + LABEL_W, gy = by + PAD + 18;

    let lastMonth = -1, lastLabel = -9;
    c.weeks.forEach((week, wi) => {
      const m = +week[0].date.slice(5, 7) - 1;
      if (m !== lastMonth && wi - lastLabel >= 3) {
        out.push(`<text x="${gx + wi * PITCH}" y="${gy - 7}" font-size="12" fill="${t.text}">${MONTHS[m]}</text>`);
        lastLabel = wi;
      }
      lastMonth = m;
      for (const d of week) {
        out.push(
          `<rect x="${gx + wi * PITCH}" y="${gy + d.weekday * PITCH}" width="${CELL}" height="${CELL}" rx="2" fill="${t.levels[LEVEL[d.contributionLevel]]}" stroke="${t.outline}"/>`
        );
      }
    });
    ["Mon", "Wed", "Fri"].forEach((d, k) =>
      out.push(`<text x="${bx + PAD}" y="${gy + (k * 2 + 1) * PITCH + 9}" font-size="12" fill="${t.text}">${d}</text>`)
    );

    // Legend, right-aligned like GitHub's.
    const ly = gy + 7 * PITCH + 12;
    const lx = bx + boxW - PAD - (34 + 5 * PITCH + 4);
    out.push(`<text x="${lx - 6}" y="${ly + 9}" font-size="12" fill="${t.muted}" text-anchor="end">Less</text>`);
    t.levels.forEach((col, k) =>
      out.push(`<rect x="${lx + k * PITCH}" y="${ly}" width="${CELL}" height="${CELL}" rx="2" fill="${col}" stroke="${t.outline}"/>`)
    );
    out.push(`<text x="${lx + 5 * PITCH + 3}" y="${ly + 9}" font-size="12" fill="${t.muted}">More</text>`);
  });

  const total = calendars.reduce((s, c) => s + c.total, 0);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-labelledby="t">
<title id="t">${total.toLocaleString("en-US")} GitHub contributions in ${years.join(", ")}</title>
<style>text{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","Noto Sans",Helvetica,Arial,sans-serif}</style>
${out.join("\n")}
</svg>
`;
}

mkdirSync(outDir, { recursive: true });
for (const [name, theme] of Object.entries(THEMES)) writeFileSync(`${outDir}/contrib-graph-${name}.svg`, render(theme));
console.log(`wrote contrib-graph-{light,dark}.svg: ${calendars.map((c) => `${c.year}=${c.total}`).join(" ")}`);
