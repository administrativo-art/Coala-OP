import { getApp, getApps, initializeApp } from "firebase/app";
import { connectFirestoreEmulator, getFirestore } from "firebase/firestore";
import { assertFirebaseClientConfig, firebaseClientConfig } from "./firebase-client-config";

assertFirebaseClientConfig();

const app = getApps().length ? getApp() : initializeApp(firebaseClientConfig);

export const financialDb = getFirestore(app, "coala-financeiro");

if (process.env.NEXT_PUBLIC_USE_FIREBASE_EMULATOR === "true") {
  connectFirestoreEmulator(financialDb, "127.0.0.1", 8080);
}
