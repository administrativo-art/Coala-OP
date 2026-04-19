const fallbackFirebaseClientConfig = {
  apiKey: "AIzaSyCn2V94gjX_Y1n4IOY40Y0JBKgXl--Sgns",
  authDomain: "smart-converter-752gf.firebaseapp.com",
  projectId: "smart-converter-752gf",
  storageBucket: "smart-converter-752gf.firebasestorage.app",
  messagingSenderId: "787876557774",
  appId: "1:787876557774:web:cf2b2c3d7d0aae313a319f",
};

export const firebaseClientConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY ?? fallbackFirebaseClientConfig.apiKey,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN ?? fallbackFirebaseClientConfig.authDomain,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ?? fallbackFirebaseClientConfig.projectId,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET ?? fallbackFirebaseClientConfig.storageBucket,
  messagingSenderId:
    process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID ?? fallbackFirebaseClientConfig.messagingSenderId,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID ?? fallbackFirebaseClientConfig.appId,
};

export function assertFirebaseClientConfig() {
  const missing = Object.entries(firebaseClientConfig)
    .filter(([, value]) => !value)
    .map(([key]) => key);

  if (missing.length) {
    throw new Error(`Firebase client config ausente: ${missing.join(', ')}`);
  }
}
