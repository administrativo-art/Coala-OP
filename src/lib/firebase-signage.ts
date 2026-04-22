import { getFirestore, connectFirestoreEmulator } from "firebase/firestore";
import { getStorage, connectStorageEmulator } from "firebase/storage";
import { getApp, getApps, initializeApp } from "firebase/app";
import { assertFirebaseClientConfig, firebaseClientConfig } from "./firebase-client-config";

assertFirebaseClientConfig();

const app = !getApps().length ? initializeApp(firebaseClientConfig) : getApp();

export const signageDb = getFirestore(app, "coala-signage");
export const signageStorage = getStorage(app);

if (process.env.NEXT_PUBLIC_USE_FIREBASE_EMULATOR === 'true') {
  connectFirestoreEmulator(signageDb, '127.0.0.1', 8080);
  connectStorageEmulator(signageStorage, '127.0.0.1', 9199);
}
