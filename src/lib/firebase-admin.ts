import { initializeApp, getApps, App, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';

const projectId = 'smart-converter-752gf';

function getAdminApp(): App {
  const existingApp = getApps().find(a => a.name === 'admin-sync');
  if (existingApp) return existingApp;

  // Opção 1: JSON completo do service account
  const serviceAccountVar = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (serviceAccountVar) {
    try {
      const serviceAccount = JSON.parse(serviceAccountVar);
      return initializeApp({ credential: cert(serviceAccount), projectId }, 'admin-sync');
    } catch (e) {
      console.error('[Firebase Admin] Erro ao parsear FIREBASE_SERVICE_ACCOUNT:', e);
    }
  }

  // Opção 2: credenciais individuais (DP_FIREBASE_*)
  const clientEmail = process.env.DP_FIREBASE_CLIENT_EMAIL;
  const privateKey = process.env.DP_FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n');
  const dpProjectId = process.env.DP_FIREBASE_PROJECT_ID ?? projectId;
  if (clientEmail && privateKey) {
    return initializeApp({
      credential: cert({ projectId: dpProjectId, clientEmail, privateKey }),
      projectId,
    }, 'admin-sync');
  }

  // Fallback: Application Default Credentials (Google Cloud / Cloud Run)
  return initializeApp({ projectId }, 'admin-sync');
}

export const adminApp = getAdminApp();
export const dbAdmin = getFirestore(adminApp, "coala");
export const authAdmin = getAuth(adminApp);
