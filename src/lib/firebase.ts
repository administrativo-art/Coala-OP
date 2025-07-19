
import { initializeApp, getApps, getApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";
import { getStorage } from "firebase/storage";

const firebaseConfig = {
  apiKey: "AIzaSyCn2V94gjX_Y1n4IOY40Y0JBKgXl--Sgns",
  authDomain: "smart-converter-752gf.firebaseapp.com",
  projectId: "smart-converter-752gf",
  storageBucket: "smart-converter-752gf.appspot.com",
  messagingSenderId: "787876557774",
  appId: "1:787876557774:web:cf2b2c3d7d0aae313a319f"
};

// Initialize Firebase
const app = !getApps().length ? initializeApp(firebaseConfig) : getApp();

// Connect to the specific "coala" database
const db = getFirestore(app, "coala");
const storage = getStorage(app);

export { db, storage };
