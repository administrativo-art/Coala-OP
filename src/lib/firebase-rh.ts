// Cliente Firestore para o banco coala-rh (leitura direta com Rules granulares)
import { initializeApp, getApps, getApp } from 'firebase/app';
import { initializeFirestore, connectFirestoreEmulator } from 'firebase/firestore';
import { initializeClientAppCheck } from './firebase-app-check';
import { assertFirebaseClientConfig, firebaseClientConfig } from './firebase-client-config';

assertFirebaseClientConfig();

const app = !getApps().length ? initializeApp(firebaseClientConfig) : getApp();
initializeClientAppCheck(app);

export const rhDb = initializeFirestore(
  app,
  { experimentalAutoDetectLongPolling: true },
  'coala-rh'
);

if (process.env.NEXT_PUBLIC_USE_FIREBASE_EMULATOR === 'true') {
  const { connectFirestoreEmulator: connect } = await import('firebase/firestore');
  connect(rhDb, '127.0.0.1', 8081);
}
