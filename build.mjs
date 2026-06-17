import * as esbuild from "esbuild";
import fs from "node:fs";
import path from "node:path";

const outDir = "dist";

// Ensure outDir exists
if (!fs.existsSync(outDir)) {
  fs.mkdirSync(outDir, { recursive: true });
}

// Copy static extension files
function copyDir(src, dest) {
  if (!fs.existsSync(dest)) fs.mkdirSync(dest, { recursive: true });
  const entries = fs.readdirSync(src, { withFileTypes: true });
  for (let entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDir(srcPath, destPath);
    } else {
      if (entry.name.endsWith(".ts")) continue; // Will be built
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

copyDir("src/extension", outDir);

// Build popup script
await esbuild.build({
  entryPoints: ["src/extension/popup/popup.ts"],
  bundle: true,
  outfile: path.join(outDir, "popup/popup.js"),
  format: "iife",
  target: ["es2020"],
});

// Build background script
await esbuild.build({
  entryPoints: ["src/extension/background.ts"],
  bundle: true,
  outfile: path.join(outDir, "background.js"),
  format: "esm", // Service workers can use ES modules
  target: ["es2020"],
});

console.log("Build complete: dist/");
