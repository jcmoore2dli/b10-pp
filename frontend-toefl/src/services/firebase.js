// src/services/firebase.js
// Firebase client SDK — singleton initialization.
// Import db, storage, functions from here throughout the app.
// Never import firebase directly in components.
import { initializeApp } from 'firebase/app'
import { getFirestore, connectFirestoreEmulator } from 'firebase/firestore'
import { getAuth, connectAuthEmulator } from 'firebase/auth'
import { getStorage } from 'firebase/storage'
import { getFunctions } from 'firebase/functions'

const firebaseConfig = {
  apiKey:            import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain:        import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId:         import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket:     import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId:             import.meta.env.VITE_FIREBASE_APP_ID,
}

const app = initializeApp(firebaseConfig)
export const db        = getFirestore(app)
export const auth      = getAuth(app)
export const storage   = getStorage(app)
export const functions = getFunctions(app)

// ── Local emulator wiring — dev only ─────────────────────────────────────────
// import.meta.env.DEV is substituted with a literal `false` by Vite at build
// time, so this entire block is eliminated by dead-code removal in a production
// bundle. There is no runtime flag, env var, or config value by which a
// deployed build can be pointed at an emulator.
//
// Firestore host/port match firebase.json's emulators.firestore entry. Auth has
// no entry in firebase.json — 9099 is the suite's default — so the emulator
// must be started with auth included:
//   firebase emulators:start --only auth,firestore,functions
//
// Both calls throw if their instance has already been configured, which Vite
// HMR triggers by re-executing this module. Each is caught individually so a
// re-run warns instead of crashing the dev server; the connection from the
// first execution stays in effect.
if (import.meta.env.DEV) {
  try {
    connectFirestoreEmulator(db, '127.0.0.1', 8080)
    console.info('[firebase] Firestore → emulator 127.0.0.1:8080')
  } catch (err) {
    console.warn('[firebase] Firestore emulator already connected:', err.message)
  }

  try {
    connectAuthEmulator(auth, 'http://127.0.0.1:9099')
    console.info('[firebase] Auth → emulator 127.0.0.1:9099')
  } catch (err) {
    console.warn('[firebase] Auth emulator already connected:', err.message)
  }
}
