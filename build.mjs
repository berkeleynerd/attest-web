import * as esbuild from "esbuild";
import fs from "node:fs";
import path from "node:path";

const chromeManifest = JSON.parse(fs.readFileSync("src/extension/manifest.json", "utf8"));
for (const [outDir, firefox] of [["dist", false], ["dist-firefox", true]]) {
  fs.rmSync(outDir, {recursive: true, force: true});
  fs.mkdirSync(path.join(outDir, "popup"), {recursive: true});
  for (const file of ["popup.html", "popup.css"]) fs.copyFileSync(`src/extension/popup/${file}`, path.join(outDir, "popup", file));
  const manifest = firefox ? {
    ...chromeManifest,
    manifest_version: 2,
    background: {scripts: ["background.js"], persistent: true},
    browser_action: chromeManifest.action,
    permissions: [...chromeManifest.permissions, "webRequest", "webRequestBlocking", "webNavigation", "<all_urls>"],
    browser_specific_settings: {gecko: {id: "attest-web@idril.is", strict_min_version: "128.0"}},
  } : chromeManifest;
  if (firefox) { delete manifest.action; delete manifest.host_permissions; }
  fs.writeFileSync(path.join(outDir, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
  for (const [entry, output] of [["popup/popup.ts", "popup/popup.js"], ["background.ts", "background.js"]]) {
    await esbuild.build({entryPoints: [`src/extension/${entry}`], bundle: true,
      outfile: path.join(outDir, output), format: "iife", target: ["es2022"]});
  }
}
console.log("Built Chrome: dist/; Firefox: dist-firefox/");
