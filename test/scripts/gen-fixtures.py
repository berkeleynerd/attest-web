#!/usr/bin/env python3
"""
Re-generate all test fixtures as lorem-ipsum HTML signed with the throwaway key.
Replaces private crc-smol content with neutral placeholder text.
"""
import subprocess, os, shutil, sys

GNUPGHOME = os.path.abspath("test-gpg")
ATTEST    = os.path.abspath("../attest/attest")
KEY_FPR   = "FC0EE6372FB7C8DBA86B649F68150860153B19EC"
FIXTURES  = os.path.abspath("test/fixtures")

# Test public key we need in trust.ts — same throwaway key
# (already there from the footgun generation; confirm it matches)

PAGES = {
    "index.html": ("Lorem Ipsum — Index", "Lorem ipsum dolor sit amet, consectetur adipiscing elit."),
    "fama.html":  ("Lorem Ipsum — Fama",  "Fama crescit eundo. Sed ut perspiciatis, unde omnis iste natus error."),
    "guidestones.html": ("Lorem Ipsum — Guidestones", "Maintain humanity under 500,000,000 in perpetual balance with nature."),
    "kore.html":  ("Lorem Ipsum — Kore",  "Kore ipsum at volutpat diam ut venenatis tellus in metus vulputate."),
    "lament.html":("Lorem Ipsum — Lament","Lament ipsum enim ut sem nulla pharetra diam sit amet nisl suscipit."),
    "parable-of-old-stone.html": ("Lorem Ipsum — Parable of Old Stone",
                                   "The old stone speaks: vitae turpis massa sed elementum tempus egestas."),
}

def make_html(title, body):
    return f"""<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><title>{title}</title></head>
<body>
<h1>{title}</h1>
<p>{body}</p>
</body>
</html>
"""

env = os.environ.copy()
env["GNUPGHOME"] = GNUPGHOME

tmp = "/tmp/attest-fixture-gen"
os.makedirs(tmp, exist_ok=True)

for filename, (title, body) in PAGES.items():
    src = os.path.join(tmp, filename)
    dst = os.path.join(FIXTURES, filename)

    with open(src, "w") as f:
        f.write(make_html(title, body))

    result = subprocess.run(
        [ATTEST, "sign", "-force", "-k", KEY_FPR, src],
        env=env, capture_output=True, text=True
    )
    if result.returncode != 0:
        print(f"FAILED signing {filename}:\n{result.stderr}", file=sys.stderr)
        sys.exit(1)

    # attest writes <name>.attest.html alongside the source
    signed = src.replace(".html", ".attest.html")
    if not os.path.exists(signed):
        print(f"FAILED: signed file not found for {filename}", file=sys.stderr)
        sys.exit(1)

    shutil.copy(signed, dst)
    print(f"  signed → {dst}")

print("\nDone. All fixtures replaced with lorem-ipsum + throwaway-key signatures.")
