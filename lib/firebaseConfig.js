export const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY || "",
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN || "",
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || "",
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET || "",
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID || "",
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID || "",
  measurementId: process.env.NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID || ""
};

export const hasFirebaseConfig = Object.entries(firebaseConfig)
  .filter(([key]) => key !== "measurementId")
  .every(([, value]) => Boolean(value));

const defaultAdminEmail = "david@brothersrestoration.org";
const defaultBlockedAdminEmails = [
  "chaim@brothersrestoration.org",
  "reznikchaim@gmail.com"
];

export const adminEmails = [...new Set((process.env.NEXT_PUBLIC_ADMIN_EMAILS || defaultAdminEmail)
  .split(",")
  .map((email) => email.trim().toLowerCase())
  .filter(Boolean))];

export const blockedAdminEmails = [
  ...defaultBlockedAdminEmails,
  ...(process.env.NEXT_PUBLIC_BLOCKED_ADMIN_EMAILS || "")
    .split(",")
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean)
].filter((value, index, self) => self.indexOf(value) === index);

export function isAdminEmail(email) {
  const normalized = String(email || "").toLowerCase();
  return Boolean(normalized && !blockedAdminEmails.includes(normalized) && adminEmails.includes(normalized));
}
