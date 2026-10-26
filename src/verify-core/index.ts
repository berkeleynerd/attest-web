import { parseTrailer } from "./trailer";
import { dearmor, parseSignaturePacket } from "./openpgp";
import { reconstructAndVerify, computeHash, bytesToHex } from "./crypto";
import { TRUSTED_KEYS } from "./trust";
import type { VerifyResult } from "./types";

export interface VerifyOptions {
  knownKeys?: Record<string, string>;
  expectedFingerprint?: string;
}

export async function verify(bytes: Uint8Array, options?: VerifyOptions): Promise<VerifyResult> {
  const knownKeys = options?.knownKeys || TRUSTED_KEYS;

  try {
    const { payload, evidence } = parseTrailer(bytes);

    if (payload.length !== evidence.signed_prefix.length) {
      return { verdict: "INVALID", evidence, payloadLength: payload.length, hashMatch: false };
    }

    // Diagnostic hash check
    let hashMatch = true;
    if (evidence.signed_prefix.sha256) {
      const h256 = await computeHash("SHA-256", payload);
      if (h256 !== evidence.signed_prefix.sha256.toLowerCase()) hashMatch = false;
    }
    if (evidence.signed_prefix.sha512) {
      const h512 = await computeHash("SHA-512", payload);
      if (h512 !== evidence.signed_prefix.sha512.toLowerCase()) hashMatch = false;
    }

    if (!hashMatch) return { verdict: "INVALID", evidence, payloadLength: payload.length, hashMatch };
    const openpgpSig = evidence.signatures.find(
      (s) => s.kind === "openpgp-detached" && s.armor && s.armor.trim() !== ""
    );

    if (!openpgpSig) {
      return { verdict: "UNKNOWN", evidence, payloadLength: payload.length, hashMatch };
    }

    const sigBytes = dearmor(openpgpSig.armor);
    const parsedSig = parseSignaturePacket(sigBytes);

    let signerFingerprintHex = "";
    if (parsedSig.issuerFingerprint) {
      signerFingerprintHex = bytesToHex(parsedSig.issuerFingerprint).toUpperCase();
    }

    const pubKeyHex = knownKeys[signerFingerprintHex];

    if (!pubKeyHex) {
      // Key not known
      return {
        verdict: "UNKNOWN",
        evidence,
        signerFingerprint: signerFingerprintHex,
        payloadLength: payload.length,
        hashMatch
      };
    }

    const ok = await reconstructAndVerify(payload, parsedSig, pubKeyHex);

    if (!ok) {
      return {
        verdict: "INVALID",
        evidence,
        signerFingerprint: signerFingerprintHex,
        payloadLength: payload.length,
        hashMatch
      };
    }

    if (!options?.expectedFingerprint) {
      return {
        verdict: "CRYPTO-VALID",
        evidence,
        signerFingerprint: signerFingerprintHex,
        payloadLength: payload.length,
        hashMatch
      };
    }

    if (signerFingerprintHex === options.expectedFingerprint.replace(/\s/g, "").toUpperCase()) {
      return {
        verdict: "AUTHENTIC",
        evidence,
        signerFingerprint: signerFingerprintHex,
        payloadLength: payload.length,
        hashMatch
      };
    } else {
      // This verified key is not the expected signer.
      return {
        verdict: "INVALID",
        evidence,
        signerFingerprint: signerFingerprintHex,
        payloadLength: payload.length,
        hashMatch
      };
    }
  } catch (e: any) {
    if (e.message && e.message.startsWith("UNKNOWN")) {
      return { verdict: "UNKNOWN" };
    }
    return { verdict: "UNKNOWN" };
  }
}

