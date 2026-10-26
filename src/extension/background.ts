import { verify } from "../verify-core/index";
import { captureResponse } from "./capture";
import { presentation, Results } from "./results";
import type { PageVerification } from "./results";
import { DeliveredPages } from "./navigation";

const expectedFingerprint = "C6174EFE4839EBCFE724670FAE2EC3CBB111EB87";
const results = new Results();
const exactCapture = typeof browser !== "undefined" && typeof browser.webRequest?.filterResponseData === "function";
const action = chrome.action ?? chrome.browserAction;

function badge(tabId: number, page: PageVerification): void {
  const view = presentation(page);
  void action.setBadgeBackgroundColor({tabId, color: view.color});
  void action.setBadgeText({tabId, text: view.label === "AUTHENTIC" ? "✓" : view.label === "UNKNOWN" ? "?" : "!"});
}
function begin(tabId: number, url: string): object {
  const token = results.begin(tabId, url);
  badge(tabId, {url, byteSource: "unavailable", result: {verdict: "UNKNOWN"}});
  return token;
}
function finish(tabId: number, token: object, page: PageVerification): void {
  if (results.finish(tabId, token, page)) badge(tabId, page);
}
const delivered = new DeliveredPages(results, badge);

if (exactCapture) {
  browser.webNavigation.onBeforeNavigate.addListener((details) => {
    if (details.frameId === 0) delivered.navigate(details.tabId, details.url, details.timeStamp);
  });
  browser.webNavigation.onCommitted.addListener((details) => {
    if (details.frameId === 0) delivered.commit(details.tabId, details.url, details.timeStamp);
  });
  browser.webNavigation.onErrorOccurred.addListener((details) => {
    if (details.frameId === 0) delivered.navigationError(details.tabId, details.url, details.timeStamp);
  });
  browser.webNavigation.onHistoryStateUpdated.addListener((details) => {
    if (details.frameId === 0) delivered.unavailable(details.tabId, details.url, details.timeStamp);
  });
  browser.webRequest.onBeforeRequest.addListener((details) => {
    if (details.tabId < 0) return;
    const capture = delivered.capture(details.tabId, details.url, details.timeStamp);
    try {
      const filter = browser.webRequest.filterResponseData(details.requestId);
      captureResponse(filter, (bytes) => {
        if (!capture) return;
        delivered.end(details.tabId, capture);
        // Do not authenticate an interrupted stream, or an earlier navigation.
        if (!bytes) {
          delivered.complete(details.tabId, capture, {url: details.url, byteSource: "unavailable", result: {verdict: "UNKNOWN"}, error: "Response capture was incomplete or exceeded 16 MiB."});
          return;
        }
        void verify(bytes, {expectedFingerprint}).then((result) => {
          delivered.complete(details.tabId, capture, {url: details.url, byteSource: "exact-response", result});
        }).catch(() => delivered.complete(details.tabId, capture, {url: details.url, byteSource: "unavailable", result: {verdict: "UNKNOWN"}}));
      });
    } catch {
      if (capture) delivered.complete(details.tabId, capture, {url: details.url, byteSource: "unavailable", result: {verdict: "UNKNOWN"}, error: "This response could not be captured."});
    }
  }, {urls: ["http://*/*", "https://*/*"], types: ["main_frame"]}, ["blocking"]);
}

chrome.tabs.onUpdated.addListener((tabId, change, tab) => {
  if (exactCapture) return; // Firefox attribution follows webNavigation, not stale tab metadata.
  const url = tab.url;
  if (!url || !/^https?:/.test(url)) {
    if (change.url || change.status === "loading") { delivered.remove(tabId); begin(tabId, url ?? "about:blank"); }
    return;
  }
  if (change.status === "loading" || change.url) begin(tabId, url);
  if (change.status !== "complete") return;
  const token = begin(tabId, url);
  void (async () => {
    try {
      const response = await fetch(url, {cache: "no-store", redirect: "error"});
      if (!response.ok) throw new Error("Re-fetch did not return a successful response.");
      const bytes = new Uint8Array(await response.arrayBuffer());
      const result = await verify(bytes, {expectedFingerprint});
      finish(tabId, token, {url, byteSource: "refetch", result});
    } catch {
      finish(tabId, token, {url, byteSource: "unavailable", result: {verdict: "UNKNOWN"}, error: "The separate re-fetch could not be verified."});
    }
  })();
});
chrome.tabs.onRemoved.addListener((tabId) => delivered.remove(tabId));
chrome.runtime.onMessage.addListener((message: unknown, _sender, respond) => {
  if (!message || typeof message !== "object" || !("type" in message) || message.type !== "get-verification") return;
  const query = message as {tabId?: unknown; url?: unknown};
  if (typeof query.tabId !== "number" || typeof query.url !== "string") return;
  respond(results.get(query.tabId, query.url) ?? {url: query.url, byteSource: "unavailable", result: {verdict: "UNKNOWN"}});
});
