export const TRUSTED_KEYS: Record<string, string> = {
  // crc-smol production signing key
  "C6174EFE4839EBCFE724670FAE2EC3CBB111EB87": "51ce3cee5c9f91a6c29ebee3ba432eff9e60ac7fdb9dbded1b868c63f46ca1b6",
};

export function getTrustedKeyHex(fingerprintHex: string): string | undefined {
  return TRUSTED_KEYS[fingerprintHex.toUpperCase()];
}
