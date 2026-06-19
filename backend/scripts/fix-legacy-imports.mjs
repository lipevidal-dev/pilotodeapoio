import fs from "node:fs";
import path from "node:path";

const legacyDir = path.resolve("src/domain/schedule/_legacy");
const parentImports = [
  "types.js",
  "generation-types.js",
  "generation-context.js",
  "operational-labels.js",
  "cross-month-history.js",
  "specific-shift-requests.js",
  "engine-metadata.js",
  "schedule-engine-router.js",
  "schedule-engine-config.js",
  "violation-level.js",
];

function fixContent(content) {
  let c = content;
  c = c.replace(/from "\.\.\/rules\//g, 'from "../../rules/');
  c = c.replace(/from "\.\.\/employee\//g, 'from "../../employee/');
  c = c.replace(/from "\.\.\/shift\//g, 'from "../../shift/');
  c = c.replace(/from "\.\.\/role\//g, 'from "../../role/');
  for (const p of parentImports) {
    const esc = p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    c = c.replace(new RegExp(`from "\\./${esc}"`, "g"), `from "../${p}"`);
  }
  return c;
}

function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full);
    else if (entry.name.endsWith(".ts")) {
      const raw = fs.readFileSync(full, "utf8");
      const fixed = fixContent(raw);
      if (fixed !== raw) fs.writeFileSync(full, fixed);
    }
  }
}

walk(legacyDir);
console.log("Legacy import paths updated");
