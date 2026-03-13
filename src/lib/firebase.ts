import { initializeApp, getApps, getApp } from "firebase/app";
import { initializeFirestore } from "firebase/firestore";
import { getStorage } from "firebase/storage";
import { getAuth } from "firebase/auth";
import { getFunctions } from "firebase/functions";

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

// Connect to the specific "coala" database and force Long Polling
const db = initializeFirestore(app, {
  experimentalForceLongPolling: true,
}, "coala");
const storage = getStorage(app);
const auth = getAuth(app);
const functions = getFunctions(app);

export { db, storage, auth, functions };
