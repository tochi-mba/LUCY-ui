import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { checkSite, report } from "../../scripts/lib/site-check.mjs";

const GOOD = `<!doctype html><html lang="en"><head><title>Thing — REX Technologies</title>
<link rel="stylesheet" href="styles.css"></head>
<body><a href="#top">top</a><main id="top"><img src="mark.svg" alt="">
<a href="https://github.com/tochi-mba/Thing">source</a></main>
<script src="app.js"></script></body></html>
`;

let counter = 0;
function site(html = GOOD, { nojekyll = true } = {}): string {
  counter += 1;
  const directory = join(tmpdir(), `lucy-ui-site-${process.pid}-${counter}`);
  mkdirSync(directory, { recursive: true });
  writeFileSync(join(directory, "index.html"), html);
  for (const name of ["styles.css", "app.js", "mark.svg"]) writeFileSync(join(directory, name), "");
  if (nojekyll) writeFileSync(join(directory, ".nojekyll"), "");
  return directory;
}

describe("the site checker", () => {
  it("passes a sound site, and the shipped site", () => {
    expect(checkSite(site(), "Thing")).toEqual([]);
    expect(checkSite(join(__dirname, "..", "..", "site"), "LUCY")).toEqual([]);
  });

  it("a missing index is the only problem worth naming", () => {
    const empty = join(tmpdir(), `lucy-ui-empty-${process.pid}`);
    mkdirSync(empty, { recursive: true });
    const [problem] = checkSite(empty, "Thing");
    expect(problem).toContain("there is no site to publish");
  });

  it.each([
    [["<title>Thing", "<title>Other"], "the title does not name Thing."],
    [["REX Technologies", "Somebody"], "the page does not name REX Technologies."],
    [['href="styles.css"', 'href="missing.css"'], "asset 'missing.css' is referenced but missing."],
    [['href="#top"', 'href="#nowhere"'], "anchor '#nowhere' points at an id that does not exist."],
    [['<img src="mark.svg" alt="">', '<img src="mark.svg">'], "image 'mark.svg' has no alt text."],
    [["source</a>", "source</a> coming soon"], "draft text left in the page: 'coming soon'."],
    [
      ["github.com/tochi-mba/Thing", "github.com/somebody-else/Thing"],
      'the page links to GitHub owners other than tochi-mba: ["somebody-else"].',
    ],
  ])("names the problem %j", ([before, after], said) => {
    expect(before && GOOD.includes(before)).toBeTruthy();
    expect(checkSite(site(GOOD.replace(before!, after!)), "Thing")).toEqual([`index.html: ${said}`]);
  });

  it("a site without .nojekyll is named", () => {
    const [problem] = checkSite(site(GOOD, { nojekyll: false }), "Thing");
    expect(problem).toContain(".nojekyll is missing");
  });

  it("checks every page, not only the index", () => {
    const directory = site();
    writeFileSync(join(directory, "404.html"), GOOD.replace("<title>Thing", "<title>Lost"));
    expect(checkSite(directory, "Thing")).toEqual(["404.html: the title does not name Thing."]);
  });

  it("remote assets, empty sources and an image with no src are not checked for existence", () => {
    const html = GOOD.replace(
      '<link rel="stylesheet" href="styles.css">',
      '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter">' +
        '<link rel="preconnect" href="//fonts.gstatic.com"><img src="" alt=""><img alt="named">',
    ).replace('<main id="top">', '<main id="top"><a name="no-href"></a>');
    const problems = checkSite(site(html), "Thing");
    expect(problems).toEqual([]);
  });

  it("an image without alt and without src is named by a placeholder", () => {
    const problems = checkSite(site(GOOD.replace('<img src="mark.svg" alt="">', "<img>")), "Thing");
    expect(problems).toEqual(["index.html: image '(no src)' has no alt text."]);
  });

  it("a page with no title, and a link tag with no href, are handled", () => {
    const html = GOOD.replace(/<title>[^<]*<\/title>/, "").replace("</head>", '<link rel="preload"></head>');
    // The title carried the only "REX Technologies" in the fixture, so both are named.
    expect(checkSite(site(html), "Thing")).toEqual([
      "index.html: the title does not name Thing.",
      "index.html: the page does not name REX Technologies.",
    ]);
  });

  it("reports as a gate", () => {
    const said: string[] = [];
    expect(report([], (line: string) => said.push(line))).toBe(0);
    expect(said).toEqual(["site checks passed"]);
    expect(report(["index.html: broken"], (line: string) => said.push(line))).toBe(1);
    expect(said.join("\n")).toContain("1 problem(s) with the site:");
  });
});
