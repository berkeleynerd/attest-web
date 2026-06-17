import { verify } from "../../verify-core/index";

async function run() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !tab.url || !tab.url.startsWith("http")) {
    document.getElementById("app")!.innerText = "Cannot verify this page.";
    return;
  }

  try {
    const res = await fetch(tab.url, { cache: "no-store" });
    const buf = await res.arrayBuffer();
    const bytes = new Uint8Array(buf);
    
    const verifyRes = await verify(bytes);
    
    let color = "#9e9e9e"; // UNKNOWN
    if (verifyRes.verdict === "AUTHENTIC") color = "#4caf50";
    else if (verifyRes.verdict === "CRYPTO-VALID") color = "#ffeb3b"; // neutral/yellow
    else if (verifyRes.verdict === "INVALID") color = "#f44336";

    if (tab.id) {
      chrome.action.setBadgeBackgroundColor({ tabId: tab.id, color });
      // chrome.action.setBadgeText({ tabId: tab.id, text: "V" });
      // Optional: don't set badge text to avoid clutter if icon color can be changed
      // Wait, "Toolbar badge (green = AUTHENTIC...)" usually means we need some text for the badge to show color.
      chrome.action.setBadgeText({ tabId: tab.id, text: " " });
    }

    let copy = "";
    if (verifyRes.verdict === "AUTHENTIC") {
      copy = "signature valid and signer is trusted (pinned)";
    } else if (verifyRes.verdict === "CRYPTO-VALID") {
      copy = "signature valid, but signer is not in your trust list.";
    }

    const app = document.getElementById("app")!;
    app.innerHTML = `
      <div class="verdict ${verifyRes.verdict}">${verifyRes.verdict}</div>
      <div class="copy">${copy}</div>
      <div class="details">
        <div><strong>Checked:</strong> re-fetch of <span class="url">${tab.url}</span></div>
        ${verifyRes.signerFingerprint ? `<div><strong>Signer:</strong> <code>${verifyRes.signerFingerprint}</code></div>` : ""}
        ${verifyRes.payloadLength !== undefined ? `<div><strong>Payload length:</strong> ${verifyRes.payloadLength} bytes</div>` : ""}
        ${verifyRes.hashMatch !== undefined ? `<div><strong>Hash match:</strong> ${verifyRes.hashMatch ? "Yes" : "No"}</div>` : ""}
        ${verifyRes.evidence?.tool ? `<div><strong>Tool:</strong> ${verifyRes.evidence.tool.name} v${verifyRes.evidence.tool.version}</div>` : ""}
      </div>
    `;

  } catch (e: any) {
    document.getElementById("app")!.innerText = `Error: ${e.message}`;
  }
}

run();
