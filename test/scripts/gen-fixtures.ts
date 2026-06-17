#!/usr/bin/env node
/**
 * gen-fixtures.ts
 *
 * Regenerates test/fixtures/ with lorem-ipsum HTML pages signed by the
 * throwaway test key. Requires:
 *   - The local `attest` binary at ../attest/attest
 *   - The throwaway GPG keyring at ./test-gpg  (not committed to the repo;
 *     recreate it with key-gen.txt if needed)
 *
 * Usage:
 *   npx tsx test/scripts/gen-fixtures.ts
 *
 * NOTE: This is a one-shot local utility. It is not run in CI.
 * Long-term intent is to replace the shell-out with a Node-native signer
 * once a test signing API exists.
 */

import { execSync } from "node:child_process";
import { mkdirSync, writeFileSync, copyFileSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";

const GNUPGHOME = resolve("test-gpg");
const ATTEST    = resolve("../attest/attest");
const KEY_FPR   = "FC0EE6372FB7C8DBA86B649F68150860153B19EC";
const FIXTURES  = resolve("test/fixtures");

const PAGES: Array<[filename: string, title: string, body: string]> = [
  ["index.html",                  "Lorem Ipsum — Index",            "Lorem ipsum dolor sit amet, consectetur adipiscing elit."],
  ["fama.html",                   "Lorem Ipsum — Fama",             "Fama crescit eundo. Sed ut perspiciatis, unde omnis iste natus error."],
  ["guidestones.html",            "Lorem Ipsum — Guidestones",      "Maintain humanity under 500,000,000 in perpetual balance with nature."],
  ["kore.html",                   "Lorem Ipsum — Kore",             "Kore ipsum at volutpat diam ut venenatis tellus in metus vulputate."],
  ["lament.html",                 "Lorem Ipsum — Lament",           "Lament ipsum enim ut sem nulla pharetra diam sit amet nisl suscipit."],
  ["parable-of-old-stone.html",   "Lorem Ipsum — Parable of Old Stone", "The old stone speaks: vitae turpis massa sed elementum tempus egestas."],
];

function makeHtml(title: string, body: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><title>${title}</title></head>
<body>
<h1>${title}</h1>
<p>${body}</p>
</body>
</html>
`;
}

const tmp = join(tmpdir(), "attest-fixture-gen");
mkdirSync(tmp, { recursive: true });

for (const [filename, title, body] of PAGES) {
  const src    = join(tmp, filename);
  const signed = src.replace(".html", ".attest.html");
  const dst    = join(FIXTURES, filename);

  writeFileSync(src, makeHtml(title, body), "utf8");

  execSync(`${ATTEST} sign -force -k ${KEY_FPR} ${src}`, {
    env: { ...process.env, GNUPGHOME },
    stdio: "ignore",
  });

  copyFileSync(signed, dst);
  rmSync(signed);
  console.log(`  signed → ${dst}`);
}

console.log("\nDone. All fixtures replaced with lorem-ipsum + throwaway-key signatures.");
