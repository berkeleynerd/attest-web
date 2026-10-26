import { documentURL, Results } from "./results";
import type { PageVerification } from "./results";

export interface Capture {
  url: string;
  started: number;
  token: object;
  committed: boolean;
  ended: boolean;
  page?: PageVerification;
}

// A completed response is evidence for a displayed document only after Firefox
// commits that top-level navigation. Downloads and abandoned requests cannot
// authenticate the page still visible in the tab.
export class DeliveredPages {
  private captures = new Map<number, Capture>();
  private navigations = new Map<number, number>();
  constructor(private results: Results, private changed: (tabId: number, page: PageVerification) => void) {}

  navigate(tabId: number, url: string, started: number): void {
    if (started < (this.navigations.get(tabId) ?? -Infinity)) return;
    this.navigations.set(tabId, started);
    const capture = this.captures.get(tabId);
    // Firefox can restart navigation during a process switch without restarting
    // its response stream. Preserve only a live, never-committed stream. A
    // completed stream or earlier displayed document cannot cross this boundary.
    if (capture && !capture.committed && !capture.ended) {
      capture.token = this.begin(tabId, capture.url);
      capture.committed = false;
    } else {
      this.captures.delete(tabId);
      this.begin(tabId, url);
    }
  }

  capture(tabId: number, url: string, started: number): Capture | undefined {
    if (started < (this.captures.get(tabId)?.started ?? -Infinity)) return undefined;
    const capture = {url, started, token: this.begin(tabId, url), committed: false, ended: false};
    this.captures.set(tabId, capture);
    return capture;
  }

  commit(tabId: number, url: string, time: number): void {
    if (time < (this.navigations.get(tabId) ?? -Infinity)) return;
    const capture = this.captures.get(tabId);
    if (!capture || capture.started > time || documentURL(capture.url) !== documentURL(url)) {
      this.captures.delete(tabId);
      this.begin(tabId, url);
      return;
    }
    capture.committed = true;
    this.publish(tabId, capture);
  }

  complete(tabId: number, capture: Capture, page: PageVerification): void {
    if (this.captures.get(tabId) !== capture) return;
    capture.ended = true;
    capture.page = page;
    this.publish(tabId, capture);
  }

  end(tabId: number, capture: Capture): void {
    if (this.captures.get(tabId) === capture) capture.ended = true;
  }

  navigationError(tabId: number, url: string, time: number): void {
    if (time < (this.navigations.get(tabId) ?? -Infinity)) return;
    const capture = this.captures.get(tabId);
    if (capture && !capture.committed && !capture.ended) {
      capture.token = this.begin(tabId, capture.url);
    } else {
      this.unavailable(tabId, url, time);
    }
  }

  unavailable(tabId: number, url: string, time: number): void {
    if (time < (this.navigations.get(tabId) ?? -Infinity)) return;
    this.captures.delete(tabId);
    this.begin(tabId, url);
  }

  remove(tabId: number): void {
    this.captures.delete(tabId);
    this.navigations.delete(tabId);
    this.results.remove(tabId);
  }

  private begin(tabId: number, url: string): object {
    const token = this.results.begin(tabId, url);
    this.changed(tabId, {url, byteSource: "unavailable", result: {verdict: "UNKNOWN"}});
    return token;
  }

  private publish(tabId: number, capture: Capture): void {
    if (!capture.committed || !capture.page) return;
    if (this.results.finish(tabId, capture.token, capture.page)) this.changed(tabId, capture.page);
    this.captures.delete(tabId);
  }
}
