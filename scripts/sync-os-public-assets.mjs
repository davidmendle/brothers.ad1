import { copyFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = dirname(dirname(fileURLToPath(import.meta.url)));
const publicDir = join(rootDir, "public");

const osAssets = [
  "app.js",
  "module-data.js",
  "firebase-client.js",
  "ui-security.js",
  "logo-data.js",
  "styles.css"
];

await mkdir(publicDir, { recursive: true });

await Promise.all(
  osAssets.map((assetName) =>
    copyFile(join(rootDir, assetName), join(publicDir, assetName))
  )
);

console.log(`Synced ${osAssets.length} Brothers OS assets to public/.`);
