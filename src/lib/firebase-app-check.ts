import type { FirebaseApp } from "firebase/app";

let appCheckInitStarted = false;

export function initializeClientAppCheck(app: FirebaseApp) {
  const siteKey = process.env.NEXT_PUBLIC_FIREBASE_APPCHECK_SITE_KEY;

  if (typeof window === "undefined" || appCheckInitStarted || !siteKey) {
    return;
  }

  appCheckInitStarted = true;

  void import("firebase/app-check")
    .then(({ ReCaptchaEnterpriseProvider, initializeAppCheck }) => {
      initializeAppCheck(app, {
        provider: new ReCaptchaEnterpriseProvider(siteKey),
        isTokenAutoRefreshEnabled: true,
      });
    })
    .catch((error) => {
      console.warn("[Firebase App Check] Falha ao inicializar:", error);
    });
}
