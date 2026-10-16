// Refreshes the "Latest transmissions" table in ReadMe.md with the owner's most recent public pushes.
// The Events API no longer ships commit messages, so each push's head commit is looked up separately.
import { readFileSync, writeFileSync } from "node:fs";

const user = process.env.GH_USER;
const file = process.env.TARGET_FILE || "ReadMe.md";
const limit = Number(process.env.MAX_ROWS || 6);
const headers = {
  Accept: "application/vnd.github+json",
  "User-Agent": "profile-readme-pushes",
  ...(process.env.GITHUB_TOKEN ? { Authorization: `Bearer ${process.env.GITHUB_TOKEN}` } : {}),
};
const api = async (path) => {
  const res = await fetch(`https://api.github.com${path}`, { headers });
  if (!res.ok) throw new Error(`${path} -> ${res.status}`);
  return res.json();
};

const events = await api(`/users/${user}/events/public?per_page=100`);
const pushes = events.filter((e) => e.type === "PushEvent" && e.payload?.head).slice(0, limit);

const esc = (s) => s.replace(/\|/g, "\|").replace(/[<>]/g, "");
const rows = [];
for (const p of pushes) {
  let msg = "pushed new commits";
  try {
    const c = await api(`/repos/${p.repo.name}/commits/${p.payload.head}`);
    msg = c.commit.message.split("\n")[0];
  } catch {}
  if (msg.length > 70) msg = msg.slice(0, 67) + "…";
  const date = new Date(p.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
  const repo = p.repo.name.split("/")[1];
  const branch = p.payload.ref.replace("refs/heads/", "");
  rows.push(`| \`${date}\` | [**${repo}**](https://github.com/${p.repo.name}/commit/${p.payload.head}) | \`${branch}\` | ${esc(msg)} |`);
}

const table = rows.length
  ? ["| Date | Repository | Branch | Latest commit |", "|:--|:--|:--|:--|", ...rows].join("\n")
  : "_No public pushes in the last 90 days — mission control is quiet._";

const re = /(<!-- PUSHES:START -->)[\s\S]*?(<!-- PUSHES:END -->)/;
const src = readFileSync(file, "utf8");
if (!re.test(src)) throw new Error("PUSHES markers not found in " + file);
const out = src.replace(re, `$1\n${table}\n$2`);
if (out !== src) writeFileSync(file, out);
console.log(out !== src ? "updated" : "no change");
