import { test, describe } from "node:test";
import * as assert from "node:assert";
import * as fs from "node:fs";
import * as path from "node:path";
import { webcrypto } from "node:crypto";
import { verify } from "../src/verify-core/index";
import { TRUSTED_KEYS } from "../src/verify-core/trust";

if (!globalThis.crypto) {
  (globalThis as any).crypto = webcrypto;
}

// Fixtures are signed by the throwaway test key
const EXPECTED_FINGERPRINT = "FC0EE6372FB7C8DBA86B649F68150860153B19EC";
const FIXTURES_DIR = path.join(__dirname, "fixtures");

describe("verify-core", () => {
  const goodFiles = [
    "index.html",
    "fama.html",
    "guidestones.html",
    "kore.html",
    "lament.html",
    "parable-of-old-stone.html",
  ];

  for (const file of goodFiles) {
    test(`verifies good file: ${file}`, async () => {
      const bytes = fs.readFileSync(path.join(FIXTURES_DIR, file));
      const res = await verify(bytes, { expectedFingerprint: EXPECTED_FINGERPRINT });
      assert.strictEqual(res.verdict, "AUTHENTIC");
      assert.strictEqual(res.signerFingerprint, EXPECTED_FINGERPRINT);
      assert.strictEqual(res.hashMatch, true);
    });

    test(`returns CRYPTO-VALID when pinning is disabled: ${file}`, async () => {
      const bytes = fs.readFileSync(path.join(FIXTURES_DIR, file));
      // omit expectedFingerprint → key is known but not pinned → CRYPTO-VALID
      const res = await verify(bytes);
      assert.strictEqual(res.verdict, "CRYPTO-VALID");
    });
  }

  test("negative vectors (derived from index.html)", async () => {
    const origBytes = fs.readFileSync(path.join(FIXTURES_DIR, "index.html"));

    function modifyTrailer(bytes: Uint8Array, mutator: (evidence: any) => void): Uint8Array {
      const startStr = "\n<!--ATTEST EVIDENCE V1\n";
      const endStr = "\nATTEST END-->\n";
      const str = new TextDecoder().decode(bytes);
      const startIdx = str.indexOf(startStr);
      const endIdx = str.indexOf(endStr);
      if (startIdx === -1 || endIdx === -1) throw new Error("Markers not found");
      
      const payloadStr = str.substring(0, startIdx);
      const trailerBody = str.substring(startIdx + startStr.length, endIdx);
      const stripped = trailerBody.replace(/[ \t\n\r\f\v]/g, "");
      const evidence = JSON.parse(atob(stripped));
      
      mutator(evidence);
      
      const newTrailerBody = btoa(JSON.stringify(evidence));
      const newStr = payloadStr + startStr + newTrailerBody + endStr;
      return new TextEncoder().encode(newStr);
    }

    await test("flips one payload byte -> INVALID", async () => {
      const bytes = new Uint8Array(origBytes);
      bytes[0] ^= 1; // flip first byte
      const res = await verify(bytes);
      assert.strictEqual(res.verdict, "INVALID");
      assert.strictEqual(res.hashMatch, false);
    });

    function modifyArmorBinary(evidence: any, mutator: (bytes: Uint8Array) => void) {
      let armor = evidence.signatures[0].armor;
      const lines = armor.split("\n");
      const base64Lines: string[] = [];
      let inBody = false;
      let startIdx = 0;
      let endIdx = lines.length;

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (line.startsWith("-----BEGIN")) {
          inBody = true;
          startIdx = i;
          continue;
        }
        if (line.startsWith("-----END")) {
          inBody = false;
          endIdx = i;
          continue;
        }
        if (!inBody) continue;
        if (line.trim() === "" || line.includes(": ")) continue;
        if (line.startsWith("=")) {
          endIdx = i; // exclude CRC and beyond
          continue;
        }
        base64Lines.push(line.trim());
      }

      const binStr = atob(base64Lines.join(""));
      const bytes = new Uint8Array(binStr.length);
      for (let i = 0; i < binStr.length; i++) {
        bytes[i] = binStr.charCodeAt(i);
      }

      mutator(bytes);

      let newBinStr = "";
      for (let i = 0; i < bytes.length; i++) {
        newBinStr += String.fromCharCode(bytes[i]);
      }
      const newBase64 = btoa(newBinStr);
      
      // format to 64 chars
      const newLines = [];
      for (let i = 0; i < newBase64.length; i += 64) {
        newLines.push(newBase64.substring(i, i + 64));
      }
      
      const newArmor = [
        ...lines.slice(0, startIdx + 2), // include BEGIN and blank line
        ...newLines,
        ...lines.slice(endIdx) // include CRC and END
      ].join("\n");
      
      evidence.signatures[0].armor = newArmor;
    }

    await test("garble/truncate S -> INVALID", async () => {
      const bytes = modifyTrailer(origBytes, (evidence) => {
        modifyArmorBinary(evidence, (bin) => {
          // S is the last 32 bytes (or so)
          bin[bin.length - 1] ^= 1;
        });
      });
      const res = await verify(bytes);
      assert.strictEqual(res.verdict, "INVALID");
    });

    await test("remove the trailer -> UNKNOWN", async () => {
      const str = new TextDecoder().decode(origBytes);
      const startStr = "\n<!--ATTEST EVIDENCE V1\n";
      const startIdx = str.indexOf(startStr);
      const modifiedStr = str.substring(0, startIdx);
      const res = await verify(new TextEncoder().encode(modifiedStr));
      assert.strictEqual(res.verdict, "UNKNOWN");
    });

    await test("append bytes after END_MARKER -> UNKNOWN", async () => {
      const bytes = new Uint8Array(origBytes.length + 1);
      bytes.set(origBytes);
      bytes[bytes.length - 1] = 0x0A;
      const res = await verify(bytes);
      assert.strictEqual(res.verdict, "UNKNOWN");
    });
    
    await test("duplicate the trailer -> UNKNOWN", async () => {
      const str = new TextDecoder().decode(origBytes);
      const startStr = "\n<!--ATTEST EVIDENCE V1\n";
      const endStr = "\nATTEST END-->\n";
      const startIdx = str.indexOf(startStr);
      const endIdx = str.indexOf(endStr);
      const trailer = str.substring(startIdx, endIdx + endStr.length);
      const modifiedStr = str + trailer;
      const res = await verify(new TextEncoder().encode(modifiedStr));
      assert.strictEqual(res.verdict, "UNKNOWN");
    });

    await test("tamper a byte inside hashedFields -> INVALID", async () => {
      const bytes = modifyTrailer(origBytes, (evidence) => {
        modifyArmorBinary(evidence, (bin) => {
          // Hashed fields start around byte 6 and continue for hlen.
          // We will flip the very last byte of the hashed fields to safely avoid
          // hitting any length or type headers which would cause a parsing error.
          const dv = new DataView(bin.buffer, bin.byteOffset, bin.byteLength);
          let off = 1;
          const lt = bin[0] & 3;
          if (lt === 0) off += 1;
          else if (lt === 1) off += 2;
          else if (lt === 2) off += 4;
          const hlen = dv.getUint16(off + 4, false);
          bin[off + 6 + hlen - 1] ^= 1;
        });
      });
      const res = await verify(bytes);
      assert.strictEqual(res.verdict, "INVALID");
    });
  });

  test("footgun vector (< 32 bytes MPIs)", async () => {
    const footgunPath = path.join(FIXTURES_DIR, "footgun.html");
    if (fs.existsSync(footgunPath)) {
      const bytes = fs.readFileSync(footgunPath);
      // The throwaway key has fingerprint FC0EE6372FB7C8DBA86B649F68150860153B19EC
      // Provide it to options
      const options: VerifyOptions = {
        knownKeys: {
          "FC0EE6372FB7C8DBA86B649F68150860153B19EC": "999866a772d618387041e54df5330baa49ab1d1c9c569331fdab16a72c08b896"
        },
        pinnedFingerprints: []
      };
      const res = await verify(bytes, options);
      assert.strictEqual(res.verdict, "CRYPTO-VALID"); // Because it's known but not pinned
    } else {
      assert.fail("footgun.html not found! Generate it first.");
    }
  });
});
