import type { VerifyResult } from "../verify-core/types";

export type ByteSource = "exact-response" | "refetch" | "unavailable";
export interface PageVerification {
  url: string;
  byteSource: ByteSource;
  result: VerifyResult;
  error?: string;
}

export function presentation(page: PageVerification): { color: string; label: string; explanation: string } {
  if (page.result.verdict === "INVALID") return {color: "#f44336", label: "INVALID", explanation: "The signature or expected signing key did not verify."};
  if (page.result.verdict === "AUTHENTIC" && page.byteSource === "exact-response") {
    return {color: "#4caf50", label: "AUTHENTIC", explanation: "The delivered response bytes verify against the expected signing key."};
  }
  if (["AUTHENTIC", "CRYPTO-VALID"].includes(page.result.verdict) && page.byteSource === "refetch") {
    return {color: "#ffeb3b", label: "RE-FETCH VERIFIED", explanation: "A separate response verifies. The displayed page has not been authenticated."};
  }
  if (page.result.verdict === "CRYPTO-VALID" && page.byteSource === "exact-response") {
    return {color: "#ffeb3b", label: "CRYPTO-VALID", explanation: "The delivered bytes verify, but no expected signing key was selected."};
  }
  return {color: "#9e9e9e", label: "UNKNOWN", explanation: page.error ?? "No verified response is available for this page."};
}

// Comparing documents ignores only fragments. Never reuse a result for another URL.
export function documentURL(url: string): string {
  const parsed = new URL(url);
  parsed.hash = "";
  return parsed.href;
}

export class Results {
  private current = new Map<number, {token: object; page: PageVerification}>();
  begin(tabId: number, url: string): object {
    const token = {};
    this.current.set(tabId, {token, page: {url, byteSource: "unavailable", result: {verdict: "UNKNOWN"}}});
    return token;
  }
  finish(tabId: number, token: object, page: PageVerification): boolean {
    if (this.current.get(tabId)?.token !== token) return false;
    this.current.set(tabId, {token, page});
    return true;
  }
  get(tabId: number, url: string): PageVerification | undefined {
    const page = this.current.get(tabId)?.page;
    return page && documentURL(page.url) === documentURL(url) ? page : undefined;
  }
  remove(tabId: number): void { this.current.delete(tabId); }
}
