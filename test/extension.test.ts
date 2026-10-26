import { test } from "node:test";
import assert from "node:assert/strict";
import { captureResponse } from "../src/extension/capture";
import type { ResponseFilter } from "../src/extension/capture";
import { Results, presentation } from "../src/extension/results";
import type { PageVerification } from "../src/extension/results";
import { DeliveredPages } from "../src/extension/navigation";

class Filter implements ResponseFilter {
  ondata: ResponseFilter["ondata"] = null;
  onstop: ResponseFilter["onstop"] = null;
  onerror: ResponseFilter["onerror"] = null;
  writes: number[] = [];
  closed = false;
  disconnected = false;
  write(data: ArrayBuffer): void { this.writes.push(...new Uint8Array(data)); }
  close(): void { this.closed = true; }
  disconnect(): void { this.disconnected = true; }
  data(bytes: number[]): void { this.ondata?.({data: new Uint8Array(bytes).buffer}); }
}

test("response capture passes through and collects the exact bytes only at EOF", () => {
  const filter = new Filter();
  const completed: (Uint8Array | undefined)[] = [];
  captureResponse(filter, (bytes) => completed.push(bytes));
  filter.data([0, 1, 255]);
  filter.data([13, 10, 0xc3, 0xa9]);
  assert.equal(completed.length, 0);
  filter.onstop?.();
  filter.onstop?.();
  assert.equal(filter.closed, true);
  assert.equal(completed.length, 1);
  assert.deepEqual(Array.from(completed[0]!), filter.writes);
});

test("oversized streams pass through but cannot authenticate", () => {
  const filter = new Filter();
  const completed: (Uint8Array | undefined)[] = [];
  captureResponse(filter, (bytes) => completed.push(bytes), 3);
  filter.data([1, 2]); filter.data([3, 4]); filter.data([5]); filter.onstop?.();
  assert.deepEqual(filter.writes, [1, 2, 3, 4, 5]);
  assert.deepEqual(completed, [undefined]);
});

test("interrupted and failed stream writes never yield authenticated bytes", () => {
  for (const failure of ["error", "write", "close"]) {
    const filter = new Filter();
    const completed: (Uint8Array | undefined)[] = [];
    captureResponse(filter, (bytes) => completed.push(bytes));
    if (failure === "write") filter.write = () => { throw new Error("interrupted"); };
    if (failure === "close") filter.close = () => { throw new Error("interrupted"); };
    filter.data([1, 2]);
    if (failure === "error") filter.onerror?.();
    filter.onstop?.();
    assert.deepEqual(completed, [undefined]);
    assert.equal(filter.disconnected, true);
  }
});

const url = "https://example.org/page";
const authentic: PageVerification = {url, byteSource: "exact-response", result: {verdict: "AUTHENTIC"}, responsePolicy: {allowed: true}};

test("only authenticated delivered bytes produce a green AUTHENTIC presentation", () => {
  assert.equal(presentation(authentic).label, "AUTHENTIC");
  for (const source of ["refetch", "unavailable"] as const) {
    const view = presentation({...authentic, byteSource: source});
    assert.notEqual(view.label, "AUTHENTIC");
    assert.notEqual(view.color, "#4caf50");
    if (source === "refetch") assert.match(view.explanation, /displayed page has not been authenticated/);
  }
  for (const verdict of ["CRYPTO-VALID", "INVALID", "UNKNOWN", "EXPIRED", "REVOKED"] as const) {
    assert.notEqual(presentation({...authentic, result: {verdict}}).color, "#4caf50");
  }
});

test("cached verdicts match the document URL and current navigation token", () => {
  const results = new Results();
  const old = results.begin(1, url);
  const current = results.begin(1, url);
  assert.equal(results.finish(1, old, authentic), false);
  assert.equal(results.finish(1, current, authentic), true);
  assert.equal(results.get(1, url + "#section")?.result.verdict, "AUTHENTIC");
  for (const other of [url + "?query=1", url + "/", "http://example.org/page", "https://other.org/page"]) assert.equal(results.get(1, other), undefined);
  results.remove(1);
  assert.equal(results.finish(1, current, authentic), false);
});

function harness() {
  const results = new Results();
  const badges: PageVerification[] = [];
  const delivered = new DeliveredPages(results, (_tab, page) => badges.push(page));
  return {results, delivered, badges};
}

test("a completed stream authenticates only after its top-level navigation commits", () => {
  for (const completeFirst of [true, false]) {
    const {results, delivered} = harness();
    delivered.navigate(1, url, 10);
    const capture = delivered.capture(1, url, 11)!;
    if (completeFirst) delivered.complete(1, capture, authentic);
    assert.notEqual(results.get(1, url)?.result.verdict, "AUTHENTIC");
    delivered.commit(1, url, 12);
    if (!completeFirst) delivered.complete(1, capture, authentic);
    assert.equal(results.get(1, url)?.result.verdict, "AUTHENTIC");
  }
});

test("delayed callback ordering retains only a request after navigation began", () => {
  const {results, delivered} = harness();
  const capture = delivered.capture(1, url, 11)!;
  delivered.navigate(1, url, 10);
  delivered.complete(1, capture, authentic);
  delivered.commit(1, url, 12);
  assert.equal(results.get(1, url)?.result.verdict, "AUTHENTIC");
});

test("Firefox process-switch navigation restarts retain their live response", () => {
  const {results, delivered} = harness();
  const capture = delivered.capture(1, url, 10)!;
  delivered.navigate(1, url, 11);
  delivered.navigationError(1, url, 12);
  delivered.navigate(1, url, 13);
  delivered.commit(1, url, 14);
  delivered.end(1, capture);
  delivered.complete(1, capture, authentic);
  assert.equal(results.get(1, url)?.result.verdict, "AUTHENTIC");
});

test("completed responses cannot transfer to another same-URL navigation while crypto is pending", () => {
  const {results, delivered} = harness();
  delivered.navigate(1, url, 10);
  const capture = delivered.capture(1, url, 11)!;
  delivered.end(1, capture);
  delivered.navigate(1, url, 12);
  delivered.commit(1, url, 13);
  delivered.complete(1, capture, authentic);
  assert.notEqual(results.get(1, url)?.result.verdict, "AUTHENTIC");
});

test("downloads, BFCache restores, redirects, and stale same-URL verifications cannot reuse an authentic verdict", () => {
  const {results, delivered, badges} = harness();
  delivered.navigate(1, url, 10);
  const old = delivered.capture(1, url, 11)!;
  delivered.complete(1, old, authentic); // Download: response but no committed page.
  assert.notEqual(results.get(1, url)?.result.verdict, "AUTHENTIC");
  delivered.navigate(1, url, 20);
  delivered.commit(1, url, 21); // BFCache: committed page without a response.
  delivered.complete(1, old, authentic);
  assert.notEqual(results.get(1, url)?.result.verdict, "AUTHENTIC");
  const redirected = delivered.capture(1, url, 22)!;
  delivered.commit(1, "https://example.org/elsewhere", 23);
  delivered.complete(1, redirected, authentic);
  assert.equal(results.get(1, url), undefined);
  assert.ok(badges.every((page) => page.result.verdict !== "AUTHENTIC"));
});

test("a new navigation, error, history-state change, or closed tab discards pending verification", () => {
  for (const discard of ["navigate", "error", "remove"]) {
    const {results, delivered} = harness();
    delivered.navigate(1, url, 10);
    const capture = delivered.capture(1, url, 11)!;
    delivered.commit(1, url, 12);
    if (discard === "navigate") delivered.navigate(1, url, 20);
    else if (discard === "error") delivered.unavailable(1, url, 20);
    else delivered.remove(1);
    delivered.complete(1, capture, authentic);
    assert.notEqual(results.get(1, url)?.result.verdict, "AUTHENTIC");
  }
});
