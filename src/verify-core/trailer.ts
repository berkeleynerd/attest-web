import { Evidence } from "./types";

const START_MARKER_STR = "\n<!--ATTEST EVIDENCE V1\n";
const END_MARKER_STR = "\nATTEST END-->\n";

const START_MARKER = new TextEncoder().encode(START_MARKER_STR);
const END_MARKER = new TextEncoder().encode(END_MARKER_STR);

function findBytes(source: Uint8Array, pattern: Uint8Array, fromIndex: number = 0): number {
  if (pattern.length === 0) return -1;
  for (let i = fromIndex; i <= source.length - pattern.length; i++) {
    let match = true;
    for (let j = 0; j < pattern.length; j++) {
      if (source[i + j] !== pattern[j]) {
        match = false;
        break;
      }
    }
    if (match) return i;
  }
  return -1;
}

export function parseTrailer(bytes: Uint8Array): { payload: Uint8Array; evidence: Evidence } {
  const startIdx = findBytes(bytes, START_MARKER);
  if (startIdx === -1) {
    throw new Error("UNKNOWN: Missing START_MARKER");
  }

  const nextStartIdx = findBytes(bytes, START_MARKER, startIdx + START_MARKER.length);
  if (nextStartIdx !== -1) {
    throw new Error("UNKNOWN: Multiple START_MARKERs found");
  }

  const endIdx = findBytes(bytes, END_MARKER);
  if (endIdx === -1) {
    throw new Error("UNKNOWN: Missing END_MARKER");
  }

  if (endIdx < startIdx) {
    throw new Error("UNKNOWN: END_MARKER appears before START_MARKER");
  }

  const nextEndIdx = findBytes(bytes, END_MARKER, endIdx + END_MARKER.length);
  if (nextEndIdx !== -1) {
    throw new Error("UNKNOWN: Multiple END_MARKERs found");
  }

  if (endIdx + END_MARKER.length !== bytes.length) {
    throw new Error("UNKNOWN: Trailing bytes found after END_MARKER");
  }

  const payload = bytes.slice(0, startIdx);
  const trailerBody = bytes.slice(startIdx + START_MARKER.length, endIdx);

  // Strip ASCII whitespace ( \t\n\r\f\v)
  const stripped: number[] = [];
  for (let i = 0; i < trailerBody.length; i++) {
    const b = trailerBody[i];
    if (b !== 0x20 && b !== 0x09 && b !== 0x0A && b !== 0x0D && b !== 0x0C && b !== 0x0B) {
      stripped.push(b);
    }
  }

  const base64Str = String.fromCharCode(...stripped);
  let jsonStr: string;
  try {
    jsonStr = atob(base64Str);
  } catch (e) {
    throw new Error("UNKNOWN: Invalid base64 in trailer");
  }

  let evidence: Evidence;
  try {
    // Decode UTF-8 json string. atob returns binary string.
    const utf8Decoder = new TextDecoder("utf-8", { fatal: true });
    const jsonBytes = new Uint8Array(jsonStr.length);
    for (let i = 0; i < jsonStr.length; i++) {
      jsonBytes[i] = jsonStr.charCodeAt(i);
    }
    evidence = JSON.parse(utf8Decoder.decode(jsonBytes));
  } catch (e) {
    throw new Error("UNKNOWN: Invalid JSON in trailer");
  }

  if (evidence.format !== "attest-evidence-v1") {
    throw new Error("UNKNOWN: Invalid format in evidence");
  }
  if (evidence.version !== 1) {
    throw new Error("UNKNOWN: Invalid version in evidence");
  }
  if (!evidence.signed_prefix || typeof evidence.signed_prefix.length !== "number") {
    throw new Error("UNKNOWN: Missing signed_prefix.length");
  }
  if (!Array.isArray(evidence.signatures) || evidence.signatures.length === 0) {
    throw new Error("UNKNOWN: Missing or empty signatures array");
  }

  return { payload, evidence };
}
