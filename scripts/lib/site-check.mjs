/**
 * Checks the GitHub Pages site before it is published; a port of the family's
 * `LUCY-assistant/scripts/check_site.py`, holding this repo's site to the same bar.
 *
 * A static site has no compiler, so nothing else catches a broken anchor, a missing asset, an
 * image a screen reader would read out by file name, or draft text that escaped. Node standard
 * library only: the workflow installs nothing to verify a page with no build step.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

export const FORBIDDEN_PATTERNS = [
  /\bTODO\b/i,
  /\bFIXME\b/i,
  /\bTBD\b/i,
  /\bLorem ipsum\b/i,
  /\bXXX\b/i,
  /\bcoming soon\b/i,
];
const REMOTE = ["http://", "https://", "data:", "//", "mailto:"];
export const OWNER = "tochi-mba";

/** The ids, links and asset references one page depends on. */
export function parsePage(html) {
  const page = { ids: new Set(), hrefs: [], assets: [], title: "", imagesWithoutAlt: [] };
  page.title = /<title>([^<]*)<\/title>/.exec(html)?.[1] ?? "";
  for (const match of html.matchAll(/<[a-zA-Z][^>]*>/g)) {
    const tag = match[0];
    const name = /^<([a-zA-Z0-9-]+)/.exec(tag)[1].toLowerCase();
    const attr = (key) => new RegExp(`\\b${key}="([^"]*)"`).exec(tag)?.[1];
    const id = attr("id");
    if (id !== undefined) page.ids.add(id);
    if (name === "a") {
      const href = attr("href");
      if (href !== undefined) page.hrefs.push(href);
    }
    if (name === "img") {
      page.assets.push(attr("src") ?? "");
      // An explicitly empty alt marks an image decorative; a missing one does not.
      if (!/\balt="/.test(tag)) page.imagesWithoutAlt.push(attr("src") || "(no src)");
    }
    if (name === "link") {
      const href = attr("href");
      if (href !== undefined) page.assets.push(href);
    }
    if (name === "script") {
      const src = attr("src");
      if (src) page.assets.push(src);
    }
  }
  return page;
}

export function checkPage(html, directory, product) {
  const problems = [];
  const page = parsePage(html);
  if (!page.title.includes(product)) problems.push(`the title does not name ${product}.`);
  if (!html.includes("REX Technologies")) problems.push("the page does not name REX Technologies.");
  for (const asset of page.assets) {
    if (!asset || REMOTE.some((prefix) => asset.startsWith(prefix))) continue;
    if (!existsSync(join(directory, asset.split("?")[0]))) problems.push(`asset '${asset}' is referenced but missing.`);
  }
  for (const href of page.hrefs) {
    if (href.startsWith("#") && href.length > 1 && !page.ids.has(href.slice(1))) {
      problems.push(`anchor '${href}' points at an id that does not exist.`);
    }
  }
  for (const image of page.imagesWithoutAlt) problems.push(`image '${image}' has no alt text.`);
  for (const pattern of FORBIDDEN_PATTERNS) {
    const match = pattern.exec(html);
    if (match) problems.push(`draft text left in the page: '${match[0]}'.`);
  }
  const owners = new Set([...html.matchAll(/https:\/\/github\.com\/([^/"'\s]+)\//g)].map((match) => match[1]));
  owners.delete(OWNER);
  if (owners.size > 0)
    problems.push(`the page links to GitHub owners other than ${OWNER}: ${JSON.stringify([...owners].sort())}.`);
  return problems;
}

/** Every problem with the site. Empty means it is publishable. */
export function checkSite(directory, product) {
  if (!existsSync(join(directory, "index.html"))) {
    return [`${join(directory, "index.html")} is missing; there is no site to publish.`];
  }
  const problems = [];
  if (!existsSync(join(directory, ".nojekyll"))) {
    problems.push(
      "site/.nojekyll is missing: without it Pages runs the site through Jekyll, which drops files beginning with an underscore.",
    );
  }
  for (const name of readdirSync(directory)
    .filter((entry) => entry.endsWith(".html"))
    .sort()) {
    const html = readFileSync(join(directory, name), "utf8");
    problems.push(...checkPage(html, directory, product).map((problem) => `${name}: ${problem}`));
  }
  return problems;
}

export function report(problems, say = console.log) {
  if (problems.length > 0) {
    say(`${problems.length} problem(s) with the site:`);
    for (const problem of problems) say(`  - ${problem}`);
    return 1;
  }
  say("site checks passed");
  return 0;
}
