export const TRUSTED_KEYS: Record<string, string> = {
  // crc-smol production signing key
  "C6174EFE4839EBCFE724670FAE2EC3CBB111EB87": "51ce3cee5c9f91a6c29ebee3ba432eff9e60ac7fdb9dbded1b868c63f46ca1b6",
  // throwaway test key — used only for signing lorem-ipsum test fixtures
  "FC0EE6372FB7C8DBA86B649F68150860153B19EC": "999866a772d618387041e54df5330baa49ab1d1c9c569331fdab16a72c08b896",
};

export function getTrustedKeyHex(fingerprintHex: string): string | undefined {
  return TRUSTED_KEYS[fingerprintHex.toUpperCase()];
}
