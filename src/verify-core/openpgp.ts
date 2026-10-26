// Deliberately small profile: one binary-document v4 EdDSALegacy signature.
// Bounds and trailing bytes are checked before any field is interpreted.
export function dearmor(armor: string): Uint8Array {
  const match = /^-----BEGIN PGP SIGNATURE-----\r?\n(?:[^\r\n:]+:[^\r\n]*\r?\n)*\r?\n([A-Za-z0-9+/=\r\n]+)-----END PGP SIGNATURE-----\s*$/.exec(armor);
  if (!match) throw new Error("UNKNOWN: malformed signature armor");
  const lines = match[1]!.split(/\r?\n/).filter(Boolean);
  if (lines.at(-1)?.startsWith("=")) lines.pop();
  const encoded = lines.join("");
  const decoded = atob(encoded);
  if (btoa(decoded) !== encoded) throw new Error("UNKNOWN: noncanonical signature base64");
  return Uint8Array.from(decoded, (c) => c.charCodeAt(0));
}

class Reader {
  pos = 0;
  constructor(readonly bytes: Uint8Array) {}
  take(n: number): Uint8Array {
    if (!Number.isSafeInteger(n) || n < 0 || this.pos + n > this.bytes.length) throw new Error("UNKNOWN: truncated OpenPGP packet");
    const result = this.bytes.slice(this.pos, this.pos + n);
    this.pos += n;
    return result;
  }
  byte(): number { return this.take(1)[0]!; }
  uint(n: number): number { return this.take(n).reduce((value, b) => value * 256 + b, 0); }
  length(): number {
    const first = this.byte();
    if (first < 192) return first;
    if (first < 224) return (first - 192) * 256 + this.byte() + 192;
    if (first === 255) return this.uint(4);
    throw new Error("UNKNOWN: partial length not supported");
  }
  mpi(): Uint8Array {
    const bits = this.uint(2);
    if (bits > 256) throw new Error("UNKNOWN: MPI larger than 32 bytes");
    return this.take(Math.ceil(bits / 8));
  }
  end(): void {
    if (this.pos !== this.bytes.length) throw new Error("UNKNOWN: trailing OpenPGP bytes");
  }
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
  const outer = new Reader(packet);
  const header = outer.byte();
  if (!(header & 0x80)) throw new Error("UNKNOWN: invalid packet header");
  const tag = header & 0x40 ? header & 0x3f : (header >> 2) & 0x0f;
  if (tag !== 2) throw new Error("UNKNOWN: Expected signature packet (tag 2)");
  const lengthType = header & 3;
  if (!(header & 0x40) && lengthType === 3) throw new Error("UNKNOWN: indeterminate packet length");
  const length = header & 0x40 ? outer.length() : outer.uint(2 ** lengthType);
  const body = outer.take(length);
  outer.end();
  const reader = new Reader(body);
  if (reader.byte() !== 4 || reader.byte() !== 0 || reader.byte() !== 22) {
    throw new Error("UNKNOWN: unsupported profile; verify with the gpg CLI");
  }
  const hashAlgoName = ({8: "SHA-256", 9: "SHA-384", 10: "SHA-512"} as Record<number, string>)[reader.byte()];
  if (!hashAlgoName) throw new Error("UNKNOWN: unsupported hash algorithm");
  const hashed = new Reader(reader.take(reader.uint(2)));
  const hashedFields = body.slice(0, reader.pos);
  let issuerFingerprint: Uint8Array | undefined;
  while (hashed.pos < hashed.bytes.length) {
    const first = hashed.byte();
    const size = first < 192 ? first : first < 255 ? (first - 192) * 256 + hashed.byte() + 192 : hashed.uint(4);
    if (size < 1) throw new Error("UNKNOWN: empty signature subpacket");
    const sub = new Reader(hashed.take(size));
    const type = sub.byte();
    if ((type & 0x80) && ![2, 33].includes(type & 0x7f)) throw new Error("UNKNOWN: unsupported critical subpacket");
    if ((type & 0x7f) === 33) {
      if (issuerFingerprint || sub.byte() !== 4 || sub.bytes.length !== 22) throw new Error("UNKNOWN: invalid issuer fingerprint");
      issuerFingerprint = sub.take(20);
      sub.end();
    }
  }
  reader.take(reader.uint(2));
  const left16 = reader.take(2);
  const R = reader.mpi();
  const S = reader.mpi();
  reader.end();
  return { hashAlgoName, hashedFields, left16, R, S, ...(issuerFingerprint ? {issuerFingerprint} : {}) };
}
