/** The Pages gate: `node scripts/check-site.mjs [site-dir] [product]`. Logic in lib/site-check.mjs. */
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { checkSite, report } from "./lib/site-check.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const directory = resolve(process.argv[2] ?? join(here, "..", "site"));
const product = process.argv[3] ?? "LUCY";
process.exit(report(checkSite(directory, product)));
