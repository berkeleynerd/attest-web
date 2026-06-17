import { verify } from "../verify-core/index";

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (changeInfo.status === "complete" && tab.url && tab.url.startsWith("http")) {
    try {
      const res = await fetch(tab.url, { cache: "no-store" });
      const buf = await res.arrayBuffer();
      const bytes = new Uint8Array(buf);
      
      const verifyRes = await verify(bytes);
      
      let color = "#9e9e9e"; // UNKNOWN
      if (verifyRes.verdict === "AUTHENTIC") color = "#4caf50";
      else if (verifyRes.verdict === "CRYPTO-VALID") color = "#ffeb3b";
      else if (verifyRes.verdict === "INVALID") color = "#f44336";

      chrome.action.setBadgeBackgroundColor({ tabId, color });
      chrome.action.setBadgeText({ tabId, text: " " });
    } catch (e) {
      // Ignore or log error
    }
  }
});
