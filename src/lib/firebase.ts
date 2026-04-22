import { initializeApp, getApps, getApp } from "firebase/app";
import { initializeFirestore, connectFirestoreEmulator } from "firebase/firestore";
import { getStorage, connectStorageEmulator } from "firebase/storage";
import { getAuth, connectAuthEmulator } from "firebase/auth";
import { getFunctions, connectFunctionsEmulator } from "firebase/functions";
import { assertFirebaseClientConfig, firebaseClientConfig } from "./firebase-client-config";

assertFirebaseClientConfig();

// Initialize Firebase
const app = !getApps().length ? initializeApp(firebaseClientConfig) : getApp();

// Connect to the specific "coala" database using Firestore defaults.
const db = initializeFirestore(
  app,
  {
    experimentalAutoDetectLongPolling: true,
  },
  "coala"
);
const storage = getStorage(app);
const auth = getAuth(app);
const functions = getFunctions(app);

if (process.env.NEXT_PUBLIC_USE_FIREBASE_EMULATOR === 'true') {
  connectFirestoreEmulator(db, '127.0.0.1', 8080);
  connectStorageEmulator(storage, '127.0.0.1', 9199);
  connectAuthEmulator(auth, 'http://127.0.0.1:9099');
  connectFunctionsEmulator(functions, '127.0.0.1', 5001);
}

export { db, storage, auth, functions };
