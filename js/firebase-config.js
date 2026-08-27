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
  apiKey: "AIzaSyAzrTKcCiR3Gmqjs7isghAxi61ICYDrsaA",
  authDomain: "welcome-activity.firebaseapp.com",
  projectId: "welcome-activity",
  storageBucket: "welcome-activity.firebasestorage.app",
  messagingSenderId: "713900888270",
  appId: "1:713900888270:web:970e56e55902a6f2f8809f",
  measurementId: "G-D8992F6359",
};

// If you leave the placeholders above, the app runs in OFFLINE DEMO MODE
// (single device, fake classmates) so you can try the flow before wiring
// Firebase. Real multi-phone play requires the config above.
export const isConfigured = !firebaseConfig.apiKey.startsWith("PASTE_");
