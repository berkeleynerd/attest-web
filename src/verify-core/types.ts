export type Verdict = "AUTHENTIC" | "CRYPTO-VALID" | "INVALID" | "UNKNOWN" | "EXPIRED" | "REVOKED";

export interface Evidence {
  format: string;
  version: number;
  created_utc?: string;
  signed_prefix: {
    length: number;
    sha256?: string;
    sha512?: string;
  };
  signatures: Signature[];
  tool?: {
    name: string;
    version: string;
  };
}

export interface Signature {
  kind: string;
  profile?: string;
  armor: string;
}

export interface VerifyResult {
  verdict: Verdict;
  evidence?: Evidence;
  signerFingerprint?: string;
  payloadLength?: number;
  hashMatch?: boolean;
}
