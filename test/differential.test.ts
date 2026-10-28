import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { verify } from "../src/verify-core/index";
import { parseTrailer } from "../src/verify-core/trailer";
import type { Evidence } from "../src/verify-core/types";

test("fresh GPG signatures agree between attest and the browser verifier", async (t) => {
  const source = process.env["ATTEST_SOURCE_DIR"] ?? ["../attest", "../web-ring/attest"].find((dir) => existsSync(join(dir, "gpg.go")));
  if (!source || spawnSync("gpg", ["--version"]).status !== 0 || spawnSync("go", ["version"]).status !== 0) {
    t.skip("requires GPG, Go, and attest source (ATTEST_SOURCE_DIR)"); return;
  }
  const dir = mkdtempSync(join(tmpdir(), "attest-differential-"));
  const home = join(dir, "gpg"); mkdirSync(home, {mode: 0o700});
  const env = {...process.env, GNUPGHOME: home};
  t.after(() => { spawnSync("gpgconf", ["--kill", "all"], {env}); rmSync(dir, {recursive: true, force: true}); });
  function command(binary: string, args: string[], cwd?: string): string {
    const result = spawnSync(binary, args, {env, encoding: "utf8", timeout: 30_000, ...(cwd ? {cwd} : {})});
    assert.equal(result.status, 0, `${binary}: ${result.error ?? result.stderr}`);
    return result.stdout;
  }
  const tool = join(dir, "attest");
  command("go", ["build", "-o", tool, "."], resolve(source));
  command("gpg", ["--batch", "--pinentry-mode", "loopback", "--passphrase", "", "--quick-generate-key", "Browser Differential <browser@example.invalid>", "ed25519", "sign", "1d"]);
  const fields = command("gpg", ["--batch", "--with-colons", "--with-key-data", "--list-keys"]).split("\n").map((line) => line.split(":"));
  const fingerprint = fields.find((line) => line[0] === "fpr")![9]!;
  const point = fields.find((line) => line[0] === "pkd" && line[1] === "1")![3]!;
  assert.match(point, /^40[0-9a-f]{64}$/i);
  const options = {knownKeys: {[fingerprint]: point.slice(2)}, expectedFingerprint: fingerprint};
  const payload = Buffer.from('<!DOCTYPE html>\n<html xmlns="http://www.w3.org/1999/xhtml"><head><title>Test</title></head><body><p>Signed page</p></body></html>\n');
  const input = join(dir, "input.html"), signed = join(dir, "signed.html"), candidate = join(dir, "candidate.html");
  writeFileSync(input, payload);
  command(tool, ["sign", "-k", fingerprint, "-o", signed, input]);
  const original = readFileSync(signed);
  const parsed = parseTrailer(original);
  function pack(bytes: Uint8Array, evidence: Evidence, updateHashes = true): Uint8Array {
    const copy = structuredClone(evidence);
    if (updateHashes) copy.signed_prefix = {length: bytes.length,
      sha256: createHash("sha256").update(bytes).digest("hex"), sha512: createHash("sha512").update(bytes).digest("hex")};
    const base64 = Buffer.from(JSON.stringify(copy)).toString("base64").match(/.{1,76}/g)!.join("\n");
    return Buffer.concat([bytes, Buffer.from(`\n<!--ATTEST EVIDENCE V1\n${base64}\nATTEST END-->\n`)]);
  }
  async function compare(bytes: Uint8Array, accepted: boolean): Promise<void> {
    writeFileSync(candidate, bytes);
    const cli = spawnSync(tool, ["verify", "--trusted", fingerprint, candidate], {env, encoding: "utf8"});
    const browser = await verify(bytes, options);
    assert.equal(cli.status === 0, accepted, cli.stdout + cli.stderr);
    assert.equal(browser.verdict === "AUTHENTIC", accepted, JSON.stringify(browser));
  }
  await t.test("original bytes and trusted key", () => compare(original, true));
  await t.test("test key is absent from production trust", async () => assert.equal((await verify(original, {expectedFingerprint: fingerprint})).verdict, "UNKNOWN"));
  const forged = Buffer.from(payload.toString().replace("Signed page", "Forged page"));
  await t.test("altered bytes with stale hashes", () => compare(pack(forged, parsed.evidence, false), false));
  await t.test("altered bytes with recomputed hashes", () => compare(pack(forged, parsed.evidence), false));
  await t.test("signature transplanted onto a different document", () => compare(pack(Buffer.from("<p>Another page</p>\n"), parsed.evidence), false));
  await t.test("unsigned content appended after the trailer", () => compare(Buffer.concat([original, Buffer.from("<p>Unsigned</p>")]), false));
  await t.test("truncated trailer", () => compare(original.subarray(0, original.length - 1), false));
  await t.test("diagnostic hashes cannot be altered independently", async () => {
    const evidence = structuredClone(parsed.evidence); evidence.signed_prefix.sha256 = "0".repeat(64);
    await compare(pack(payload, evidence, false), false);
  });
  await t.test("wrong expected signer cannot authenticate", async () => assert.notEqual((await verify(original, {...options, expectedFingerprint: "0".repeat(40)})).verdict, "AUTHENTIC"));
  await t.test("GPG text-mode signatures never authenticate byte-exact pages", async () => {
    const signature = join(dir, "textmode.asc");
    command("gpg", ["--batch", "--yes", "--textmode", "--armor", "--detach-sign", "--local-user", fingerprint, "--output", signature, input]);
    const evidence = structuredClone(parsed.evidence);
    evidence.signatures[0]!.armor = readFileSync(signature, "utf8");
    for (const bytes of [payload, Buffer.from(payload.toString().replaceAll("\n", "\r\n"))]) {
      writeFileSync(input, bytes);
      command("gpg", ["--batch", "--verify", signature, input]); // GPG accepts both.
      await compare(pack(bytes, evidence), false);
    }
  });
});
