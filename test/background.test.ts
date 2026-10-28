import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { ResponseFilter } from "../src/extension/capture";
import type { PageVerification } from "../src/extension/results";

class Event {
  listeners: ((...args: any[]) => any)[] = [];
  registrations: any[][] = [];
  addListener(listener: (...args: any[]) => any, ...options: any[]): void { this.listeners.push(listener); this.registrations.push(options); }
  fire(...args: any[]): void { for (const listener of this.listeners) listener(...args); }
}

test("Firefox background ignores stale tab metadata during process-switch navigation", async (t) => {
  const onBeforeRequest = new Event(), onHeadersReceived = new Event(), onRequestError = new Event();
  const onBeforeNavigate = new Event(), onCommitted = new Event(), onErrorOccurred = new Event(), onHistoryStateUpdated = new Event();
  const onUpdated = new Event(), onRemoved = new Event(), onMessage = new Event();
  const filter: ResponseFilter = {ondata: null, onstop: null, onerror: null, write() {}, close() {}, disconnect() {}};
  const previous = ["chrome", "browser", "fetch"].map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const);
  t.after(() => { for (const [key, descriptor] of previous) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); } });
  let fetches = 0;
  Object.assign(globalThis, {
    browser: {webRequest: {onBeforeRequest, onHeadersReceived, onErrorOccurred: onRequestError, filterResponseData: () => filter}, webNavigation: {onBeforeNavigate, onCommitted, onErrorOccurred, onHistoryStateUpdated}},
    chrome: {browserAction: {async setBadgeBackgroundColor() {}, async setBadgeText() {}}, tabs: {onUpdated, onRemoved}, runtime: {onMessage}},
    fetch: async () => { fetches++; throw new Error("unexpected re-fetch"); },
  });
  await import("../src/extension/background");
  assert.deepEqual(onHeadersReceived.registrations[0], [{urls: ["http://*/*", "https://*/*"], types: ["main_frame"]}, ["blocking", "responseHeaders"]]);
  const url = "https://example.org/page";
  onBeforeRequest.fire({tabId: 1, url, timeStamp: 10, requestId: "request-1"});
  onHeadersReceived.fire({tabId: 1, url, timeStamp: 10.5, requestId: "request-1", statusCode: 200, responseHeaders: [{name: "Content-Type", value: "text/html; charset=utf-8"}]});
  onBeforeNavigate.fire({tabId: 1, frameId: 0, url, timeStamp: 11});
  onUpdated.fire(1, {status: "loading"}, {url: "about:blank"});
  onErrorOccurred.fire({tabId: 1, frameId: 0, url, timeStamp: 12});
  onBeforeNavigate.fire({tabId: 1, frameId: 0, url, timeStamp: 13});
  onCommitted.fire({tabId: 1, frameId: 0, url, timeStamp: 14});
  filter.ondata?.({data: new Uint8Array(readFileSync("test/fixtures/index.html")).buffer});
  filter.onstop?.();
  let page: PageVerification | undefined;
  for (let i = 0; i < 100; i++) {
    onMessage.fire({type: "get-verification", tabId: 1, url}, {}, (value: PageVerification) => { page = value; });
    if (page?.byteSource === "exact-response") break;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  assert.equal(page?.byteSource, "exact-response");
  assert.equal(page?.responsePolicy?.allowed, true);
  assert.equal(fetches, 0);
  // The fixture key is deliberately absent from production trust.
  assert.equal(page?.result.verdict, "UNKNOWN");
  onBeforeNavigate.fire({tabId: 1, frameId: 0, url, timeStamp: 20});
  onCommitted.fire({tabId: 1, frameId: 0, url, timeStamp: 21});
  onMessage.fire({type: "get-verification", tabId: 1, url}, {}, (value: PageVerification) => { page = value; });
  assert.equal(page?.byteSource, "unavailable");

  // Metadata from an earlier request, another tab, or a different URL cannot
  // authorize a later stream, even when the visible URL is unchanged.
  for (const mismatch of ["old request", "other tab", "other URL", "old timestamp"]) {
    const requestId = `request-${mismatch}`;
    onBeforeNavigate.fire({tabId: 1, frameId: 0, url, timeStamp: 30});
    onBeforeRequest.fire({tabId: 1, url, timeStamp: 31, requestId});
    onHeadersReceived.fire({tabId: mismatch === "other tab" ? 2 : 1, url: mismatch === "other URL" ? url + "/other" : url,
      timeStamp: mismatch === "old timestamp" ? 30 : 32, requestId: mismatch === "old request" ? "request-1" : requestId,
      statusCode: 200, responseHeaders: [{name: "Content-Type", value: "text/html; charset=utf-8"}]});
    onCommitted.fire({tabId: 1, frameId: 0, url, timeStamp: 33});
    filter.ondata?.({data: new Uint8Array(readFileSync("test/fixtures/index.html")).buffer});
    filter.onstop?.();
    for (let i = 0; i < 100; i++) {
      onMessage.fire({type: "get-verification", tabId: 1, url}, {}, (value: PageVerification) => { page = value; });
      if (page?.byteSource === "exact-response") break;
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    assert.equal(page?.byteSource, "exact-response", mismatch);
    assert.equal(page?.responsePolicy?.allowed, false, mismatch);
  }
});
