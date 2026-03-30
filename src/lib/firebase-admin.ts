import { initializeApp, getApps, getApp, App, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const projectId = 'smart-converter-752gf';

function getAdminApp(): App {
  const existingApp = getApps().find(a => a.name === 'admin-sync');
  if (existingApp) return existingApp;

  // Se houver uma conta de serviço no ambiente (JSON string)
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

  // Fallback para as credenciais padrão do ambiente (Cloud Run / App Hosting)
  return initializeApp({
    projectId: projectId,
  }, 'admin-sync');
}

const app = getAdminApp();

// Conecta ao banco de dados específico "coala"
export const dbAdmin = getFirestore(app, "coala");
