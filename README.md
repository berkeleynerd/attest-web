# attest-web

A Firefox extension, Chrome extension, and TypeScript library for verifying
`attest` signatures over exact page bytes with native WebCrypto.

The signature is embedded in the page's final evidence comment. Verification
checks the complete signed prefix, both diagnostic hashes, and the OpenPGP
signature against the expected signing fingerprint. A manifest, canonical URL,
allowed-origin list, and resource inventory are optional metadata; none is
required to authenticate authorship of the signed bytes.

## Delivered bytes and re-fetches

Firefox captures and passes through the actual top-level response with
`webRequest.filterResponseData`. It authenticates only a complete captured
stream associated with a committed navigation. Gzip responses are verified
after browser decompression. Interrupted streams, responses over 16 MiB,
downloads without a committed document, and history restores without a capture
cannot receive an authenticated verdict.

Green also requires the captured response to pass the display-header policy.
The main-frame headers are checked before streaming, and attributed to the same
request, tab, and URL as the captured bytes. A valid body signature with unsupported
headers remains yellow **BODY VERIFIED**, with the reason shown in the popup.
The cryptographic result stays AUTHENTIC; unsigned headers are not signed claims.

The supported response is HTTP 200 with exactly one explicit `Content-Type`:
`text/html; charset=utf-8` or `application/xhtml+xml; charset=utf-8`, and a valid
UTF-8 body. Green is withheld for `Link`, `Refresh`, either CSP header,
`Content-Language`, `Content-Disposition`, `Content-Location`, or
`Content-Style-Type`. This conservative policy includes restrictive CSP because
it can suppress signed styles. Missing, conflicting, or unsupported MIME/charset
metadata also withholds green. Ordinary transport/cache headers and gzip remain
supported. These checks cover response interpretation; they do not certify
static-profile conformance or identical rendering across browser settings.

Chrome MV3 verifies a separate `fetch` response. That response can differ from
the displayed document, so successful verification is yellow, labeled
**RE-FETCH VERIFIED**, with an explicit explanation that the displayed page has
not been authenticated. The popup reads the background result and makes no
independent fetch. Navigation tokens discard stale asynchronous results.

| Color | Display | Meaning |
|---|---|---|
| Green | AUTHENTIC | Delivered UTF-8 body verifies against the expected key and passes the response-header policy. Firefox only. |
| Yellow | BODY VERIFIED | Delivered body verifies against the expected key; response headers or encoding prevent display assurance. |
| Yellow | RE-FETCH VERIFIED | A separate response verifies; the displayed page remains unauthenticated. |
| Yellow | CRYPTO-VALID | Delivered bytes verify with a known key, without an expected fingerprint. |
| Red | INVALID | Hash/signature failure or a verified signer that differs from the expected key. |
| Gray | UNKNOWN | Missing, malformed, unsupported, or unavailable verification evidence. |

`verify-core` supports one binary-document OpenPGP v4 EdDSALegacy signature
(algorithm 22), using Ed25519 and SHA-256/384/512. Other OpenPGP profiles fail
closed to UNKNOWN. GPG remains the general CLI verifier. Text-mode signatures
cannot authenticate exact bytes. Expiration and revocation are not evaluated by
the browser verifier; their verdict names are reserved for future key-policy
support.

## Trust

`src/verify-core/trust.ts` contains the compiled-in production public key:

```
C6174EFE4839EBCFE724670FAE2EC3CBB111EB87
```

The extension explicitly selects that fingerprint as the expected signer. Test
keys are injected into tests only. No keys or delegation policy are loaded from
the page or fetched from the network. Additional identities and trust-ring
policy remain separate future work.

The library API is `verify(bytes, {knownKeys, expectedFingerprint})`. Without an
expected fingerprint, a signature verified with a known key returns
CRYPTO-VALID. An unavailable public key returns UNKNOWN. Evidence-trailer
metadata is unsigned; the popup displays only the verified fingerprint, using
text nodes rather than interpreting metadata as HTML.

The library reports body-byte cryptography independently of HTTP metadata. It
cannot apply the extension's display-header checks without a delivered response.
Malformed or unsupported signatures return UNKNOWN; cryptographically invalid
signatures or a verified unexpected signer return INVALID. The GPG-backed CLI
supports more key/signature profiles and evaluates key status, so its labels can
differ without a browser acceptance of unsigned bytes.

## Build and test

Requires a current Node.js with WebCrypto Ed25519 support and npm.

```sh
npm ci
npm test
npm run typecheck
npm run build
```

Builds are written to `dist/` (Chrome MV3) and `dist-firefox/` (Firefox MV2).
Load `dist/` unpacked in `chrome://extensions`, or load
`dist-firefox/manifest.json` temporarily in Firefox's `about:debugging`.
Firefox requests `webRequest`, `webRequestBlocking`, `webNavigation`, and host
access to capture responses and associate them with navigation. Chrome uses
host access for its separate re-fetch.

Tests cover signed fixtures, malformed packets/trailers, short MPIs, resource
capture failures, verdict presentation, and navigation races. The differential
test creates a disposable GPG key and compares fresh signatures and adversarial
edits against `attest verify`. It requires Go, GPG, and a peer attest checkout
(`ATTEST_SOURCE_DIR` can specify it); otherwise that integration test is skipped.

A live Firefox acceptance test uses Python's standard library, a Firefox binary,
and geckodriver 0.36 or newer. It creates a temporary browser profile, keyring,
and extension copy with an injected test key, leaving production trust intact:

```sh
FIREFOX_BIN=/path/to/firefox GECKODRIVER_BIN=/path/to/geckodriver \
  python3 test/scripts/firefox-smoke.py
```

It exercises delivered HTML and XHTML, streamed/gzip responses, a response that
changes between requests, redirects, same-URL reloads, and unsigned appended
content. It also serves identical signed bytes under stylesheet Link, Refresh,
permissive/restrictive CSP, language/disposition, and MIME/charset headers; it
checks actual badge colors, visible injected/suppressed CSS content, and header
attribution across reloads/redirects. `ATTEST_SMOKE_REPORT` optionally saves JSON
observations. This repository does not deploy or install the extension automatically.
