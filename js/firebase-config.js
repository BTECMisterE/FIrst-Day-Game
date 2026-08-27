// ─────────────────────────────────────────────────────────────
//  FIREBASE SETUP  (one-time, ~5 minutes)
// ─────────────────────────────────────────────────────────────
//  1. Go to https://console.firebase.google.com  →  Add project
//     (you can reuse the same Google account as your other apps).
//  2. In the project, click the </> "Web" icon to register a web app.
//  3. Copy the firebaseConfig object it gives you and paste it below,
//     replacing the placeholder values.
//  4. In the console: Build → Firestore Database → Create database
//     → Start in TEST mode (fine for a one-day classroom event).
//  5. (Optional, recommended) Paste the rules from README.md so the
//     room auto-expires and randoms can't wander in.
//
//  That's it — no billing, the free "Spark" plan covers a classroom.
// ─────────────────────────────────────────────────────────────

export const firebaseConfig = {
  apiKey: "PASTE_YOUR_API_KEY",
  authDomain: "PASTE_YOUR_PROJECT.firebaseapp.com",
  projectId: "PASTE_YOUR_PROJECT_ID",
  storageBucket: "PASTE_YOUR_PROJECT.appspot.com",
  messagingSenderId: "PASTE_SENDER_ID",
  appId: "PASTE_APP_ID",
};

// If you leave the placeholders above, the app runs in OFFLINE DEMO MODE
// (single device, fake classmates) so you can try the flow before wiring
// Firebase. Real multi-phone play requires the config above.
export const isConfigured = !firebaseConfig.apiKey.startsWith("PASTE_");
