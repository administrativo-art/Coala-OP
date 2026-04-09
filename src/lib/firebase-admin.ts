import { initializeApp, getApps, App, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';

const projectId = 'smart-converter-752gf';

function getAdminApp(): App {
  const existingApp = getApps().find(a => a.name === 'admin-sync');
  if (existingApp) return existingApp;

  const serviceAccountVar = process.env.FIREBASE_SERVICE_ACCOUNT;

  if (serviceAccountVar) {
    try {
      const serviceAccount = JSON.parse(serviceAccountVar);
      return initializeApp({
        credential: cert(serviceAccount),
        projectId: projectId,
      }, 'admin-sync');
    } catch (e) {
      console.error('[Firebase Admin] Erro ao parsear FIREBASE_SERVICE_ACCOUNT:', e);
    }
  }

  return initializeApp({
    projectId: projectId,
  }, 'admin-sync');
}

export const adminApp = getAdminApp();
export const dbAdmin = getFirestore(adminApp, "coala");
export const authAdmin = getAuth(adminApp);
