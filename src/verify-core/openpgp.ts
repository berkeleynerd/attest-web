export function dearmor(armor: string): Uint8Array {
  const lines = armor.split(/\r?\n/);
  const base64Lines: string[] = [];
  let inBody = false;

  for (const line of lines) {
    if (line.startsWith("-----BEGIN")) {
      inBody = true;
      continue;
    }
    if (line.startsWith("-----END")) {
      inBody = false;
      continue;
    }
    if (!inBody) continue;

    // Skip empty lines and headers like "Version: ..."
    if (line.trim() === "" || line.includes(": ")) continue;

    // Skip CRC line
    if (line.startsWith("=")) continue;

    base64Lines.push(line.trim());
  }

  const base64Str = base64Lines.join("");
  let binStr: string;
  try {
    binStr = atob(base64Str);
  } catch (e) {
    throw new Error("UNKNOWN: Invalid base64 in armor");
  }

  const bytes = new Uint8Array(binStr.length);
  for (let i = 0; i < binStr.length; i++) {
    bytes[i] = binStr.charCodeAt(i);
  }
  return bytes;
}

function parsePacket(d: Uint8Array): { tag: number; body: Uint8Array } {
  const b0 = d[0];
  let tag: number, ln: number, off: number;

  if (b0 & 0x40) {
    // New format
    tag = b0 & 0x3f;
    off = 1;
    const l = d[off];
    if (l < 192) {
      ln = l;
      off += 1;
    } else if (l < 224) {
      ln = ((l - 192) << 8) + d[off + 1] + 192;
      off += 2;
    } else if (l === 255) {
      const dv = new DataView(d.buffer, d.byteOffset + off + 1, 4);
      ln = dv.getUint32(0, false);
      off += 5;
    } else {
      throw new Error("UNKNOWN: partial length not supported");
    }
  } else {
    // Old format
    tag = (b0 >> 2) & 0x0f;
    const lt = b0 & 3;
    off = 1;
    if (lt === 0) {
      ln = d[off];
      off += 1;
    } else if (lt === 1) {
      const dv = new DataView(d.buffer, d.byteOffset + off, 2);
      ln = dv.getUint16(0, false);
      off += 2;
    } else if (lt === 2) {
      const dv = new DataView(d.buffer, d.byteOffset + off, 4);
      ln = dv.getUint32(0, false);
      off += 4;
    } else {
      throw new Error("UNKNOWN: indeterminate length not supported");
    }
  }

  return { tag, body: d.slice(off, off + ln) };
}

function readMpi(d: Uint8Array, p: number): { mpi: Uint8Array; nextP: number } {
  const dv = new DataView(d.buffer, d.byteOffset + p, 2);
  const bits = dv.getUint16(0, false);
  p += 2;
  const n = Math.floor((bits + 7) / 8);
  return { mpi: d.slice(p, p + n), nextP: p + n };
}

export interface ParsedSignature {
  hashAlgoName: string;
  hashedFields: Uint8Array;
  left16: Uint8Array;
  R: Uint8Array;
  S: Uint8Array;
  issuerFingerprint?: Uint8Array;
}

export function parseSignaturePacket(packet: Uint8Array): ParsedSignature {
  const { tag, body } = parsePacket(packet);
  if (tag !== 2) {
    throw new Error("UNKNOWN: Expected signature packet (tag 2)");
  }

  if (body[0] !== 4 || body[1] !== 0x00 || body[2] !== 22) {
    throw new Error("UNKNOWN: unsupported profile; verify with the gpg CLI");
  }

  const hashAlgoId = body[3];
  let hashAlgoName = "";
  if (hashAlgoId === 8) hashAlgoName = "SHA-256";
  else if (hashAlgoId === 9) hashAlgoName = "SHA-384";
  else if (hashAlgoId === 10) hashAlgoName = "SHA-512";
  else if (hashAlgoId === 11) {
    // SHA-224 digest size is 28 bytes < 32 bytes (Ed25519 fsize)
    throw new Error("UNKNOWN: digest size < 32 bytes");
  } else {
    throw new Error("UNKNOWN: unsupported hash algorithm");
  }

  const dv = new DataView(body.buffer, body.byteOffset, body.byteLength);
  const hlen = dv.getUint16(4, false);
  const hashedFields = body.slice(0, 6 + hlen);
  
  // Extract Issuer Fingerprint (type 33) from hashed subpackets
  let issuerFingerprint: Uint8Array | undefined = undefined;
  let subP = 6;
  const subEnd = 6 + hlen;
  while (subP < subEnd) {
    let subLen = body[subP];
    let subLenLen = 1;
    if (subLen >= 192 && subLen < 255) {
      subLen = ((subLen - 192) << 8) + body[subP + 1] + 192;
      subLenLen = 2;
    } else if (subLen === 255) {
      subLen = dv.getUint32(subP + 1, false);
      subLenLen = 5;
    }
    const subType = body[subP + subLenLen] & 0x7f; // drop critical bit
    const subData = body.slice(subP + subLenLen + 1, subP + subLenLen + subLen);
    if (subType === 33) {
      // Issuer Fingerprint
      const v = subData[0];
      if (v === 4 && subData.length === 21) {
        issuerFingerprint = subData.slice(1);
      }
    }
    subP += subLenLen + subLen;
  }

  let p = 6 + hlen;
  const uLen = dv.getUint16(p, false);
  p += 2 + uLen;

  const left16 = body.slice(p, p + 2);
  p += 2;

  const resR = readMpi(body, p);
  const R = resR.mpi;
  p = resR.nextP;

  const resS = readMpi(body, p);
  const S = resS.mpi;

  return { hashAlgoName, hashedFields, left16, R, S, issuerFingerprint };
}
