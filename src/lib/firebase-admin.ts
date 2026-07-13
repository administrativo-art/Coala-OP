import { existsSync, readFileSync } from 'node:fs';
import { initializeApp, getApps, App, applicationDefault, cert, type ServiceAccount } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';

// ── Segurança de autenticação: emulador NUNCA em produção ─────────────────────
// Quando FIREBASE_AUTH_EMULATOR_HOST está setado, o Admin SDK PARA de verificar
// a assinatura dos tokens (aceita tokens do emulador, sem assinatura). Em
// produção isso seria um bypass total de auth. Duas travas evitam o desastre:
//
// 1) Trava dura: se a variável vazar para um build de produção, aborta o boot
//    (a app não sobe insegura).
if (process.env.NODE_ENV === 'production' && process.env.FIREBASE_AUTH_EMULATOR_HOST) {
  throw new Error(
    '[Firebase Admin] FIREBASE_AUTH_EMULATOR_HOST setado em produção — isso desabilitaria a verificação de token. Abortando por segurança.',
  );
}
// 2) Conveniência local: liga o emulador de Auth automaticamente SÓ fora de
//    produção e apenas quando o cliente também está em modo emulador. Mantém
//    cliente e servidor sincronizados sem exportar variáveis manualmente.
if (
  process.env.NODE_ENV !== 'production' &&
  process.env.NEXT_PUBLIC_USE_FIREBASE_EMULATOR === 'true' &&
  !process.env.FIREBASE_AUTH_EMULATOR_HOST
) {
  process.env.FIREBASE_AUTH_EMULATOR_HOST = '127.0.0.1:9099';
}

const projectId =
  process.env.FIREBASE_PROJECT_ID ??
  process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ??
  'smart-converter-752gf';

function parseServiceAccount(raw: string, source: string): ServiceAccount | null {
  try {
    return JSON.parse(raw) as ServiceAccount;
  } catch (error) {
    console.error(`[Firebase Admin] Erro ao carregar credencial de ${source}:`, error);
    return null;
  }
}

function readServiceAccountFromPath(path: string): ServiceAccount | null {
  if (!existsSync(path)) {
    console.warn(`[Firebase Admin] FIREBASE_SERVICE_ACCOUNT_PATH não encontrado: ${path}`);
    return null;
  }

  try {
    return parseServiceAccount(readFileSync(path, 'utf8'), 'FIREBASE_SERVICE_ACCOUNT_PATH');
  } catch (error) {
    console.error('[Firebase Admin] Erro ao ler FIREBASE_SERVICE_ACCOUNT_PATH:', error);
    return null;
  }
}

function getAdminApp(): App {
  const existingApp = getApps().find(a => a.name === 'admin-sync');
  if (existingApp) return existingApp;

  const serviceAccountVar = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (serviceAccountVar) {
    const serviceAccount = parseServiceAccount(serviceAccountVar, 'FIREBASE_SERVICE_ACCOUNT');
    if (serviceAccount) {
      return initializeApp({ credential: cert(serviceAccount), projectId }, 'admin-sync');
    }
  }

  const serviceAccountPath = process.env.FIREBASE_SERVICE_ACCOUNT_PATH;
  if (serviceAccountPath) {
    const serviceAccount = readServiceAccountFromPath(serviceAccountPath);
    if (serviceAccount) {
      return initializeApp({ credential: cert(serviceAccount), projectId }, 'admin-sync');
    }
  }

  // Compatibilidade apenas quando a credencial do DP aponta para o mesmo projeto.
  const clientEmail = process.env.DP_FIREBASE_CLIENT_EMAIL;
  const privateKey = process.env.DP_FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n');
  const credentialProjectId = process.env.DP_FIREBASE_PROJECT_ID ?? projectId;

  if (clientEmail && privateKey) {
    if (credentialProjectId !== projectId) {
      console.warn(
        `[Firebase Admin] Ignorando credencial DP do projeto ${credentialProjectId} para o projeto principal ${projectId}. Configure FIREBASE_SERVICE_ACCOUNT ou FIREBASE_SERVICE_ACCOUNT_PATH.`
      );
    } else {
      return initializeApp(
        {
          credential: cert({ projectId: credentialProjectId, clientEmail, privateKey }),
          projectId,
        },
        'admin-sync'
      );
    }
  }

  return initializeApp(
    {
      credential: applicationDefault(),
      projectId,
    },
    'admin-sync'
  );
}

export const adminApp = getAdminApp();
export const dbAdmin = getFirestore(adminApp, "coala");
export const authAdmin = getAuth(adminApp);
