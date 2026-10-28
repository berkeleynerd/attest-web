import { presentation } from "../results";
import type { PageVerification } from "../results";

async function run(): Promise<void> {
  const app = document.getElementById("app")!;
  try {
    const [tab] = await chrome.tabs.query({active: true, currentWindow: true});
    if (tab?.id === undefined || !tab.url) { app.textContent = "No page to verify."; return; }
    const page: PageVerification = await chrome.runtime.sendMessage({type: "get-verification", tabId: tab.id, url: tab.url});
    const view = presentation(page);
    const heading = document.createElement("div");
    heading.className = "verdict";
    heading.style.color = view.color;
    heading.textContent = view.label;
    const explanation = document.createElement("p");
    explanation.textContent = view.explanation;
    const details = document.createElement("div");
    details.textContent = `Checked: ${page.byteSource} of ${page.url}`;
    app.replaceChildren(heading, explanation, details);
    if (page.result.signerFingerprint && ["AUTHENTIC", "CRYPTO-VALID"].includes(page.result.verdict)) {
      const signer = document.createElement("p");
      signer.textContent = `Verified signing key: ${page.result.signerFingerprint}`;
      app.append(signer);
    }
  } catch { app.textContent = "No verified response is available. Reload the page to capture it."; }
}
void run();
