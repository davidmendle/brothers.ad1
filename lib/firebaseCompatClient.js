"use client";

import { firebaseConfig, hasFirebaseConfig } from "./firebaseConfig";

const firebaseScripts = [
  "https://www.gstatic.com/firebasejs/10.14.1/firebase-app-compat.js",
  "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth-compat.js",
  "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore-compat.js",
  "https://www.gstatic.com/firebasejs/10.14.1/firebase-storage-compat.js"
];

let firebasePromise;

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[src="${src}"]`);
    if (existing) {
      if (existing.dataset.loaded === "true") resolve();
      else {
        existing.addEventListener("load", resolve, { once: true });
        existing.addEventListener("error", reject, { once: true });
      }
      return;
    }

    const script = document.createElement("script");
    script.src = src;
    script.async = true;
    script.dataset.loaded = "false";
    script.onload = () => {
      script.dataset.loaded = "true";
      resolve();
    };
    script.onerror = reject;
    document.head.appendChild(script);
  });
}

export function getFirebaseCompat() {
  if (typeof window === "undefined") {
    return Promise.reject(new Error("Firebase can only be loaded in the browser."));
  }

  if (!hasFirebaseConfig) {
    return Promise.reject(new Error("Firebase is not configured. Add the Firebase environment variables in Vercel."));
  }

  if (!firebasePromise) {
    firebasePromise = (async () => {
      for (const src of firebaseScripts) {
        await loadScript(src);
      }

      const firebase = window.firebase;
      if (!firebase) throw new Error("Firebase SDK failed to load.");
      if (!firebase.apps.length) firebase.initializeApp(firebaseConfig);

      const auth = firebase.auth();
      const db = firebase.firestore();
      const storage = firebase.storage();
      const provider = new firebase.auth.GoogleAuthProvider();

      provider.setCustomParameters({
        prompt: "select_account"
      });

      return { firebase, auth, db, storage, provider };
    })();
  }

  return firebasePromise;
}
