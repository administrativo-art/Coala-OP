import { initializeApp, getApps, getApp } from "firebase/app";
import { initializeFirestore, connectFirestoreEmulator } from "firebase/firestore";
import { getStorage, connectStorageEmulator } from "firebase/storage";
import { getAuth, connectAuthEmulator } from "firebase/auth";
import { getFunctions, connectFunctionsEmulator } from "firebase/functions";

const firebaseConfig = {
  apiKey: "AIzaSyCn2V94gjX_Y1n4IOY40Y0JBKgXl--Sgns",
  authDomain: "smart-converter-752gf.firebaseapp.com",
  projectId: "smart-converter-752gf",
  storageBucket: "smart-converter-752gf.firebasestorage.app",
  messagingSenderId: "787876557774",
  appId: "1:787876557774:web:cf2b2c3d7d0aae313a319f"
};

// Initialize Firebase
const app = !getApps().length ? initializeApp(firebaseConfig) : getApp();

// Connect to the specific "coala" database using Firestore defaults.
const db = initializeFirestore(app, {}, "coala");
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
