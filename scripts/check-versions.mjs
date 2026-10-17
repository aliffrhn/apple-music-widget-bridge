// Verifies that every package shares one version and, when given a release
// tag (vX.Y.Z), that the tag and CHANGELOG agree with it.
// Usage: node scripts/check-versions.mjs [vX.Y.Z]
import { readFile } from "node:fs/promises";

const root = new URL("../", import.meta.url);
const packages = [
  "receiver/package.json",
  "widget/package.json",
  "widget/react/package.json",
  "examples/react/package.json",
];

const errors = [];
const versions = new Map();
for (const path of packages) {
  const { version } = JSON.parse(await readFile(new URL(path, root), "utf8"));
  versions.set(path, version);
}
// The Supabase adapter has no package.json, so read its health version.
const adapter = "examples/supabase/supabase/functions/bridge-now-playing/handler.ts";
versions.set(adapter, (await readFile(new URL(adapter, root), "utf8")).match(/^export const VERSION = "([^"]+)";$/m)?.[1]);
const expected = versions.get(packages[0]);
for (const [path, version] of versions) {
  if (version !== expected) errors.push(`${path} has version ${version}; expected ${expected}`);
}

const tag = process.argv[2];
if (tag) {
  if (tag !== `v${expected}`) errors.push(`Tag ${tag} does not match package version ${expected}`);
  const changelog = await readFile(new URL("CHANGELOG.md", root), "utf8");
  if (!changelog.includes(`## [${expected}]`)) errors.push(`CHANGELOG.md has no "## [${expected}]" section`);
}

if (errors.length) {
  for (const error of errors) console.error(`✗ ${error}`);
  process.exit(1);
}
console.log(`✓ All packages are at ${expected}${tag ? ` and match ${tag}` : ""}`);
