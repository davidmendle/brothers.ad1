import { copyFile, mkdir, writeFile } from "node:fs/promises";
import { brothersLogoDataUrl } from "../logo-data.js";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = dirname(dirname(fileURLToPath(import.meta.url)));
const publicDir = join(rootDir, "public");

const osAssets = [
  "app.js",
  "application-registry.js",
  "module-data.js",
  "firebase-client.js",
  "request-json.js",
  "emergency-monitor.js",
  "ui-security.js",
  "logo-data.js",
  "styles.css"
];

await mkdir(publicDir, { recursive: true });
await writeFile(join(publicDir, "brothers-shield.png"), Buffer.from(brothersLogoDataUrl.split(",")[1], "base64"));

await Promise.all(
  osAssets.map((assetName) =>
    copyFile(join(rootDir, assetName), join(publicDir, assetName))
  )
);

console.log(`Synced ${osAssets.length} Brothers OS assets to public/.`);
