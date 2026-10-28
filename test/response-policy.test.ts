import { test } from "node:test";
import assert from "node:assert/strict";
import { checkResponseDisplay, checkResponseHeaders } from "../src/extension/response-policy";
import type { ResponseHeader } from "../src/extension/response-policy";
import { presentation } from "../src/extension/results";

const body = new TextEncoder().encode('<!DOCTYPE html><html xmlns="http://www.w3.org/1999/xhtml"><head><meta charset="utf-8" /><title>Café</title></head><body>Café</body></html>');
const utf8: ResponseHeader = {name: "Content-Type", value: "text/html; charset=utf-8"};

test("green requires both authentic delivered bytes and supported response metadata", () => {
  for (const value of ["text/html; charset=utf-8", 'Application/XHTML+XML; Charset="UTF-8"']) {
    const responsePolicy = checkResponseDisplay(checkResponseHeaders(200, [{name: "CONTENT-TYPE", value}]), body);
    assert.equal(responsePolicy.allowed, true);
    assert.equal(presentation({url: "https://example.org/", byteSource: "exact-response", result: {verdict: "AUTHENTIC"}, responsePolicy}).label, "AUTHENTIC");
  }
  assert.equal(presentation({url: "https://example.org/", byteSource: "exact-response", result: {verdict: "AUTHENTIC"}}).label, "BODY VERIFIED");
});

test("behavior-changing headers never qualify an authentic body for green", async (t) => {
  const cases: [string, string][] = [
    ["Link", '</unsigned.css>; rel="stylesheet"'],
    ["Refresh", "1; url=https://example.invalid/"],
    ["Content-Security-Policy", "default-src * 'unsafe-inline'"],
    ["Content-Security-Policy", "default-src 'none'; style-src 'none'"],
    ["Content-Security-Policy-Report-Only", "default-src 'none'; report-uri /report"],
    ["Content-Language", "fr"],
    ["Content-Disposition", "inline"],
    ["Content-Location", "/another-base/"],
    ["Content-Style-Type", "text/plain"],
  ];
  for (const [name, value] of cases) await t.test(`${name}: ${value}`, () => {
    const responsePolicy = checkResponseDisplay(checkResponseHeaders(200, [utf8, {name: name.toLowerCase(), value}]), body);
    assert.equal(responsePolicy.allowed, false);
    const page = {url: "https://example.org/", byteSource: "exact-response" as const, result: {verdict: "AUTHENTIC" as const}, responsePolicy};
    const view = presentation(page);
    assert.equal(page.result.verdict, "AUTHENTIC", "header policy must not relabel a valid signature as invalid");
    assert.equal(view.label, "BODY VERIFIED");
    assert.notEqual(view.color, "#4caf50");
    assert.match(view.explanation, /displayed content has not been authenticated/);
  });
});

test("missing, ambiguous, non-HTML, and non-UTF-8 representations fail closed", () => {
  const cases: (ResponseHeader[] | undefined)[] = [
    undefined, [],
    [{name: "Content-Type", value: "text/html"}],
    [{name: "Content-Type", value: "application/xhtml+xml"}],
    [{name: "Content-Type", value: "text/plain; charset=utf-8"}],
    [{name: "Content-Type", value: "text/html; charset=utf-16le"}],
    [{name: "Content-Type", value: "text/html; charset=windows-1252"}],
    [{name: "Content-Type", value: "text/html; charset=utf-8; charset=utf-16"}],
    [{name: "Content-Type", value: "text/html; charset=utf-8\r\n"}],
    [utf8, utf8],
    [{...utf8, binaryValue: [0xff]}],
  ];
  for (const headers of cases) assert.equal(checkResponseHeaders(200, headers).allowed, false, JSON.stringify(headers));
  for (const status of [204, 206, 301, 304, 404, 500]) assert.equal(checkResponseHeaders(status, [utf8]).allowed, false);
  assert.equal(checkResponseDisplay(undefined, body).allowed, false);
  for (const bytes of [new Uint8Array([0xff, 0xfe, 0x3c, 0]), new Uint8Array([0xc0, 0xaf]), new Uint8Array([0])]) {
    assert.equal(checkResponseDisplay({allowed: true}, bytes).allowed, false);
  }
});
