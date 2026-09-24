// Rebuilds the tech-stack badges and the featured-projects table in README.md
// from the owner's public repositories. Run by .github/workflows/update-readme.yml.
//
//   node scripts/update-readme.mjs                  fetch from GitHub (needs GITHUB_TOKEN)
//   node scripts/update-readme.mjs --data repos.json  use saved data instead (for testing)
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";

const config = JSON.parse(readFileSync("profile.config.json", "utf8"));

// Known technologies: key is a lowercase language name or repository topic.
// Anything not listed here is ignored, so random topics never become badges.
const TECH = {
  typescript: ["TypeScript", "typescript", "3178C6"],
  javascript: ["JavaScript", "javascript", "F7DF1E", "black"],
  html: ["HTML5", "html5", "E34F26"],
  css: ["CSS", "css", "1572B6"],
  scss: ["Sass", "sass", "CC6699"],
  sass: ["Sass", "sass", "CC6699"],
  python: ["Python", "python", "3776AB"],
  php: ["PHP", "php", "777BB4"],
  shell: ["Shell", "gnubash", "4EAA25"],
  vue: ["Vue.js", "vuedotjs", "4FC08D"],
  svelte: ["Svelte", "svelte", "FF3E00"],
  dockerfile: ["Docker", "docker", "2496ED"],
  docker: ["Docker", "docker", "2496ED"],
  react: ["React", "react", "20232A", "61DAFB"],
  nextjs: ["Next.js", "nextdotjs", "000000"],
  "next-js": ["Next.js", "nextdotjs", "000000"],
  redux: ["Redux", "redux", "764ABC"],
  vite: ["Vite", "vite", "646CFF"],
  tailwindcss: ["Tailwind CSS", "tailwindcss", "06B6D4"],
  tailwind: ["Tailwind CSS", "tailwindcss", "06B6D4"],
  bootstrap: ["Bootstrap", "bootstrap", "7952B3"],
  nodejs: ["Node.js", "nodedotjs", "339933"],
  node: ["Node.js", "nodedotjs", "339933"],
  deno: ["Deno", "deno", "000000"],
  express: ["Express", "express", "000000"],
  expressjs: ["Express", "express", "000000"],
  "socket-io": ["Socket.io", "socketdotio", "010101"],
  graphql: ["GraphQL", "graphql", "E10098"],
  postgresql: ["PostgreSQL", "postgresql", "4169E1"],
  postgres: ["PostgreSQL", "postgresql", "4169E1"],
  prisma: ["Prisma", "prisma", "2D3748"],
  mongodb: ["MongoDB", "mongodb", "47A248"],
  mysql: ["MySQL", "mysql", "4479A1"],
  firebase: ["Firebase", "firebase", "FFCA28", "black"],
  supabase: ["Supabase", "supabase", "3FCF8E"],
  stripe: ["Stripe", "stripe", "635BFF"],
  pwa: ["PWA", "pwa", "5A0FC8"],
  jest: ["Jest", "jest", "C21325"],
  vercel: ["Vercel", "vercel", "000000"],
};

const QUERY = `query($login: String!) {
  user(login: $login) {
    repositories(first: 100, privacy: PUBLIC, ownerAffiliations: OWNER, isFork: false,
                 orderBy: {field: PUSHED_AT, direction: DESC}) {
      nodes {
        name description url homepageUrl isArchived
        defaultBranchRef { name }
        readme: object(expression: "HEAD:README.md") { ... on Blob { text } }
        repositoryTopics(first: 20) { nodes { topic { name } } }
        languages(first: 10, orderBy: {field: SIZE, direction: DESC}) { edges { size node { name } } }
      }
    }
  }
}`;

async function fetchRepos() {
  const res = await fetch("https://api.github.com/graphql", {
    method: "POST",
    headers: { Authorization: `bearer ${process.env.GITHUB_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query: QUERY, variables: { login: config.user } }),
  });
  const json = await res.json();
  if (!res.ok || json.errors) throw new Error(JSON.stringify(json.errors ?? json));
  return json.data.user.repositories.nodes;
}

const topicsOf = (repo) => repo.repositoryTopics.nodes.map((n) => n.topic.name.toLowerCase());
const languagesOf = (repo) => repo.languages.edges.map((e) => e.node.name.toLowerCase());
const escape = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function badge([label, logo, color, logoColor = "white"]) {
  const text = encodeURIComponent(label.replace(/-/g, "--"));
  return `<img src="https://img.shields.io/badge/${text}-${color}?style=flat-square&logo=${logo}&logoColor=${logoColor}" alt="${label}">`;
}

function techSection(repos) {
  // Languages weighted by code size across all repos, then the fixed list, then topics.
  const size = {};
  for (const repo of repos)
    for (const e of repo.languages.edges) size[e.node.name.toLowerCase()] = (size[e.node.name.toLowerCase()] ?? 0) + e.size;
  const keys = [
    ...Object.keys(size).sort((a, b) => size[b] - size[a]),
    ...config.alwaysTech,
    ...repos.flatMap(topicsOf),
  ];
  const seen = new Set();
  const badges = [];
  for (const key of keys) {
    const tech = TECH[key];
    if (!tech || seen.has(tech[0])) continue;
    seen.add(tech[0]);
    badges.push(badge(tech));
  }
  return `<p>\n${badges.join("\n")}\n</p>`;
}

function stackLine(repo) {
  const names = [];
  for (const key of [...topicsOf(repo), ...languagesOf(repo)]) {
    const name = TECH[key]?.[0];
    if (name && !names.includes(name)) names.push(name);
  }
  return names.slice(0, 5).join(" · ");
}

// Cover image for a card: config.covers[name] if set, else the first real image in the repo's own README (usually a
// screenshot), or GitHub's generated repository card when there is none.
const NOT_A_SCREENSHOT = /shields\.io|badge|github-readme-stats|\/actions\/workflows\/|skillicons|devicon/i;

function coverImage(repo) {
  const override = config.covers?.[repo.name];
  if (override) return override;
  const text = repo.readme?.text ?? "";
  const found = [...text.matchAll(/!\[[^\]]*\]\(\s*<?([^)\s>]+)|<img[^>]+src=["']([^"']+)["']/gi)]
    .map((m) => m[1] ?? m[2])
    .find((src) => !NOT_A_SCREENSHOT.test(src));
  const [owner, name] = new URL(repo.url).pathname.slice(1).split("/");
  if (!found) return `https://opengraph.githubassets.com/1/${owner}/${name}`;
  const blob = found.match(/^https:\/\/github\.com\/([^/]+\/[^/]+)\/blob\/(.+)$/);
  if (blob) return `https://raw.githubusercontent.com/${blob[1]}/${blob[2]}`;
  if (/^https?:\/\//.test(found)) return found;
  const branch = repo.defaultBranchRef?.name ?? "main";
  const path = found.replace(/^\.?\//, "");
  return `https://raw.githubusercontent.com/${owner}/${name}/${branch}/${encodeURI(decodeURI(path))}`;
}

function card(repo, cover) {
  const links = [];
  if (repo.homepageUrl) links.push(`<a href="${escape(repo.homepageUrl)}">Live</a>`);
  links.push(`<a href="${escape(repo.url)}">Code</a>`);
  const stack = stackLine(repo);
  return [
    `    <td width="50%" valign="top">`,
    `      <a href="${escape(repo.homepageUrl || repo.url)}"><img src="${escape(cover)}" width="100%" alt="${escape(repo.name)}"></a>`,
    `      <h3>${escape(repo.name)}</h3>`,
    `      <p>${escape(repo.description || "")}</p>`,
    stack ? `      <p><sub>${escape(stack)}</sub></p>` : null,
    `      <p>${links.join(" · ")}</p>`,
    `    </td>`,
  ].filter(Boolean).join("\n");
}

async function projectsSection(repos) {
  // Repos named in config.featured come first, in that order; then any other repo
  // carrying the featured topic.
  const byName = new Map(repos.map((r) => [r.name.toLowerCase(), r]));
  const listed = (config.featured ?? []).map((name) => {
    const repo = byName.get(name.toLowerCase());
    if (!repo) console.warn(`Featured repo "${name}" not found among public, non-archived repos.`);
    return repo;
  }).filter(Boolean);
  const tagged = repos.filter((r) => topicsOf(r).includes(config.featuredTopic) && !listed.includes(r));
  const featured = [...listed, ...tagged];
  const chosen = (featured.length ? featured : repos.slice(0, config.fallbackProjects)).slice(0, config.maxProjects);
  const covers = await Promise.all(chosen.map(saveCover));
  pruneCovers(chosen);
  const cards = chosen.map((repo, i) => card(repo, covers[i]));
  const rows = [];
  for (let i = 0; i < cards.length; i += 2)
    rows.push(`  <tr>\n${cards.slice(i, i + 2).join("\n")}\n  </tr>`);
  return `<table>\n${rows.join("\n")}\n</table>`;
}

// GitHub strips CSS from READMEs, so equal card heights need equal images: each
// cover is cropped to the same 16:10 size (keeping the top of the screenshot) and
// stored in covers/. If that fails, the card links the original image instead.
const COVERS = "covers";
const coverPath = (repo) => `${COVERS}/${repo.name}.webp`;

async function saveCover(repo) {
  const src = coverImage(repo);
  try {
    const { default: sharp } = await import("sharp");
    const res = await fetch(src);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    mkdirSync(COVERS, { recursive: true });
    await sharp(Buffer.from(await res.arrayBuffer()))
      .resize(1200, 750, { fit: "cover", position: "top" })
      .webp({ quality: 82 })
      .toFile(coverPath(repo));
    return coverPath(repo);
  } catch (err) {
    // Keep yesterday's crop if there is one, so a flaky download doesn't break the layout.
    const fallback = existsSync(coverPath(repo)) ? coverPath(repo) : src;
    console.warn(`Cover for ${repo.name} not cropped (${err.message}); using ${fallback}`);
    return fallback;
  }
}

function pruneCovers(chosen) {
  if (!existsSync(COVERS)) return;
  const keep = new Set(chosen.map((r) => `${r.name}.webp`));
  for (const file of readdirSync(COVERS)) if (!keep.has(file)) rmSync(`${COVERS}/${file}`);
}

function replaceBetween(text, name, content) {
  const re = new RegExp(`(<!-- ${name}:START -->)[\\s\\S]*?(<!-- ${name}:END -->)`);
  if (!re.test(text)) throw new Error(`README.md is missing the ${name}:START / ${name}:END markers`);
  return text.replace(re, `$1\n${content}\n$2`);
}

const dataFlag = process.argv.indexOf("--data");
const all = dataFlag > -1 ? JSON.parse(readFileSync(process.argv[dataFlag + 1], "utf8")) : await fetchRepos();
const repos = all.filter((r) => !r.isArchived && r.name.toLowerCase() !== config.user.toLowerCase());

let readme = readFileSync("README.md", "utf8");
readme = replaceBetween(readme, "TECH", techSection(repos));
readme = replaceBetween(readme, "PROJECTS", await projectsSection(repos));
writeFileSync("README.md", readme);
console.log(`README.md rebuilt from ${repos.length} repositories.`);
