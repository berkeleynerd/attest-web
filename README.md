# attest-web

A Chrome extension and companion TypeScript library that verifies [`attest`](https://github.com/berkeleynerd/attest)-signed HTML artifacts using native WebCrypto — no external crypto dependencies.

## Overview

`attest` signs HTML files by appending a base64-encoded JSON evidence block containing an OpenPGP detached signature. This repo ships two things:

1. **`verify-core`** — a framework-free, dependency-free TypeScript module that takes raw file bytes and returns a cryptographic verdict. Runs unchanged in both the browser and Node.
2. **Attested Web** — a Chrome Manifest V3 extension that re-fetches the current page, calls `verify-core`, and displays a colour-coded trust verdict in the toolbar badge and popup.

## Verdicts

| Badge colour | Verdict | Meaning |
|---|---|---|
| 🟢 Green | `AUTHENTIC` | Signature valid; signer matches the compiled-in trust anchor |
| 🟡 Yellow | `CRYPTO-VALID` | Signature mathematically valid; signer not in the trust list |
| 🔴 Red | `INVALID` | Signature invalid, or signer ≠ pinned fingerprint |
| ⚫ Grey | `UNKNOWN` | Page is not signed, or the trailer is unparseable |

> **Dev-stage note:** a valid signature from an unknown signer currently maps to `INVALID` rather than `CRYPTO-VALID`. This is a deliberate simplification marked with `// DEV-STAGE:` in the source and will be revisited before any non-dev use.

## Trust anchors

The trust anchor list is compiled in at `src/verify-core/trust.ts`. The extension ships with the `crc-smol` production signing key pre-loaded:

```
C6174EFE4839EBCFE724670FAE2EC3CBB111EB87
```

Dynamic / per-page pinning and synced trust stores are deferred to a future trust-layer design.

## Repository layout

```
src/
  verify-core/       # Pure TS verification library (browser + Node)
    index.ts         # Public API: verify(bytes, options?) → VerifyResult
    trailer.ts       # attest-evidence-v1 trailer parser
    openpgp.ts       # OpenPGP packet / MPI parser + digest reconstruction
    crypto.ts        # WebCrypto Ed25519 verify + SHA hashing
    trust.ts         # Compiled-in TRUSTED_KEYS map
    types.ts         # Shared types / verdict enum
  extension/         # Chrome MV3 extension source
    manifest.json
    background.ts    # Service worker: auto-verifies on page load
    popup/           # Popup UI (HTML + CSS + TS)
test/
  core.test.ts       # Differential + negative + short-MPI test harness
  fixtures/          # Lorem-ipsum HTML pages signed with the test key
  scripts/
    gen-fixtures.py  # How fixtures were generated (requires local attest binary)
build.mjs            # esbuild config → dist/
```

## Getting started

### Prerequisites

- Node.js ≥ 18
- npm

### Install

```sh
npm install
```

### Run tests

```sh
npx tsx --test test/core.test.ts
```

### Build the extension

```sh
node build.mjs
```

The built extension is written to `dist/`.

### Load in Chrome

1. Open `chrome://extensions/`
2. Enable **Developer mode**
3. Click **Load unpacked** and select the `dist/` directory

The extension will automatically verify each page as it loads and colour the toolbar badge accordingly.

## Security notes

- Verification operates on **raw fetched bytes** (`fetch(url, { cache: "no-store" })`), never on the potentially-mutated DOM.
- The extension uses `activeTab` and `host_permissions` (`<all_urls>`) to enable background verification on every navigation.
- No keys are fetched from the network. No storage APIs are used. `verify-core` is pure and stateless.
- This is an internal dogfooding tool, not a Chrome Web Store release.
