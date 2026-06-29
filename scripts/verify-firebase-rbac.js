#!/usr/bin/env node

const { loadLocalEnv } = require("../loadEnv");
const { getHealthStatus } = require("../createApp");
const { getFirebasePublicConfig, isFirebaseConfigured } = require("../lib/firebase-admin");

loadLocalEnv();

const origin = process.env.VERIFY_FIREBASE_RBAC_BASE_URL || process.env.OS_BASE_URL || "http://127.0.0.1:4174";
const requestLike = {
  protocol: origin.startsWith("https://") ? "https" : "http",
  get(headerName) {
    if (headerName === "host") {
      return origin.replace(/^https?:\/\//, "").replace(/\/+$/g, "");
    }
    return "";
  }
};

function printSection(title, lines) {
  console.log(`\n${title}`);
  lines.forEach((line) => console.log(`- ${line}`));
}

async function main() {
  const firebase = getFirebasePublicConfig();
  const health = getHealthStatus(requestLike);
  const warnings = health.insuranceIntake?.warnings || [];

  printSection("Firebase Admin", [
    `Configured: ${isFirebaseConfigured() ? "yes" : "no"}`,
    `Project ID: ${firebase.projectId || "missing"}`,
    `Missing admin env: ${firebase.missingAdminEnv?.join(", ") || "none"}`
  ]);

  printSection("Firebase Web", [
    `Web config present: ${firebase.webConfigured ? "yes" : "no"}`,
    `Missing web env: ${firebase.missingWebEnv?.join(", ") || "none"}`
  ]);

  printSection("Session + Health", [
    `Base URL: ${origin}`,
    `Health firebase configured: ${health.firebaseAuth?.configured ? "yes" : "no"}`,
    `Health admin configured: ${health.firebaseAuth?.adminConfigured ? "yes" : "no"}`,
    `Health web configured: ${health.firebaseAuth?.webConfigured ? "yes" : "no"}`
  ]);

  printSection("Warnings", warnings.length ? warnings : ["none"]);

  if (!isFirebaseConfigured() || !firebase.webConfigured) {
    console.error("\nFirebase RBAC verification is incomplete because required Firebase env values are missing.");
    process.exitCode = 1;
    return;
  }

  console.log("\nFirebase env looks configured. Next step: run the app and verify login, role creation, and Firestore writes live.");
}

main().catch((error) => {
  console.error("\nVerification failed.");
  console.error(error && error.stack ? error.stack : error);
  process.exitCode = 1;
});
