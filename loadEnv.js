const fs = require("fs");
const path = require("path");

function parseEnvValue(rawValue) {
  const trimmed = rawValue.trim();
  if (!trimmed) return "";

  const quote = trimmed[0];
  if ((quote === "\"" || quote === "'") && trimmed.endsWith(quote)) {
    return trimmed.slice(1, -1);
  }

  return trimmed;
}

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return;

  const contents = fs.readFileSync(filePath, "utf8");
  for (const line of contents.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const separatorIndex = trimmed.indexOf("=");
    if (separatorIndex <= 0) continue;

    const key = trimmed.slice(0, separatorIndex).trim();
    if (!key || Object.prototype.hasOwnProperty.call(process.env, key)) continue;

    const value = trimmed.slice(separatorIndex + 1);
    process.env[key] = parseEnvValue(value);
  }
}

function loadLocalEnv() {
  loadEnvFile(path.join(__dirname, ".env"));
  loadEnvFile(path.join(__dirname, ".env.local"));
  loadEnvFile(path.join(__dirname, ".secrets", "firebase-admin.env"));
}

module.exports = { loadLocalEnv };
