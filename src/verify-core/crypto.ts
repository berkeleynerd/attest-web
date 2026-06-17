import { ParsedSignature } from "./openpgp";

export function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.substr(i * 2, 2), 16);
  }
  return bytes;
}

export function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function leftPad32(mpi: Uint8Array): Uint8Array {
  if (mpi.length > 32) {
    throw new Error("UNKNOWN: MPI larger than 32 bytes");
  }
  const padded = new Uint8Array(32);
  padded.set(mpi, 32 - mpi.length);
  return padded;
}

export async function reconstructAndVerify(
  payload: Uint8Array,
  sig: ParsedSignature,
  pubKeyHex: string
): Promise<boolean> {
  const cryptoSubtle = globalThis.crypto?.subtle;
  if (!cryptoSubtle) {
    throw new Error("UNKNOWN: crypto.subtle not available");
  }

  // Build the signed digest D
  // trailer = 0x04 0xFF || uint32be(hashedFields.length)
  const trailer = new Uint8Array(6);
  trailer[0] = 0x04;
  trailer[1] = 0xff;
  const dv = new DataView(trailer.buffer);
  dv.setUint32(2, sig.hashedFields.length, false);

  const dataToHash = new Uint8Array(
    payload.length + sig.hashedFields.length + trailer.length
  );
  dataToHash.set(payload, 0);
  dataToHash.set(sig.hashedFields, payload.length);
  dataToHash.set(trailer, payload.length + sig.hashedFields.length);

  const digestBuffer = await cryptoSubtle.digest(sig.hashAlgoName, dataToHash);
  const D = new Uint8Array(digestBuffer);

  // Sanity check: D[0:2] must equal left16
  if (D[0] !== sig.left16[0] || D[1] !== sig.left16[1]) {
    return false; // hash mismatch, fail signature
  }

  // Build the 64-byte raw signature
  const sig64 = new Uint8Array(64);
  const R32 = leftPad32(sig.R);
  const S32 = leftPad32(sig.S);
  sig64.set(R32, 0);
  sig64.set(S32, 32);

  // Import key and verify
  const pub32 = hexToBytes(pubKeyHex);
  const key = await cryptoSubtle.importKey(
    "raw",
    pub32,
    { name: "Ed25519" },
    false,
    ["verify"]
  );

  const ok = await cryptoSubtle.verify({ name: "Ed25519" }, key, sig64, D);
  return ok;
}

export async function computeHash(algo: string, data: Uint8Array): Promise<string> {
  const cryptoSubtle = globalThis.crypto?.subtle;
  if (!cryptoSubtle) return "";
  const hashBuf = await cryptoSubtle.digest(algo, data);
  return bytesToHex(new Uint8Array(hashBuf));
}
