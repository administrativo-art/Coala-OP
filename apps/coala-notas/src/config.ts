const trimTrailingSlash = (value: string) => value.replace(/\/+$/, "");

const PRODUCTION_API_BASE_URL = "https://op.coalashakes.com";

/** Fora do desenvolvimento, senha e notas só trafegam por HTTPS; um endereço inseguro cai no de produção. */
function resolveApiBaseUrl() {
  const configured = trimTrailingSlash(process.env.EXPO_PUBLIC_API_BASE_URL || PRODUCTION_API_BASE_URL);
  return __DEV__ || configured.startsWith("https://") ? configured : PRODUCTION_API_BASE_URL;
}

export const appConfig = {
  apiBaseUrl: resolveApiBaseUrl(),
  firebase: {
    apiKey: process.env.EXPO_PUBLIC_FIREBASE_API_KEY || "AIzaSyCn2V94gjX_Y1n4IOY40Y0JBKgXl--Sgns",
    authDomain: process.env.EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN || "smart-converter-752gf.firebaseapp.com",
    projectId: process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID || "smart-converter-752gf",
    storageBucket: process.env.EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET || "smart-converter-752gf.firebasestorage.app",
    messagingSenderId: process.env.EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID || "787876557774",
    appId: process.env.EXPO_PUBLIC_FIREBASE_APP_ID || "1:787876557774:web:cf2b2c3d7d0aae313a319f",
  },
};
