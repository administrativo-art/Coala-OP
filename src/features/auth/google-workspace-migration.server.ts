import { OAuth2Client } from 'google-auth-library';
import { createHash } from 'node:crypto';
import { Timestamp } from 'firebase-admin/firestore';

import type { ServerUserContext } from '@/lib/auth-server';
import { authAdmin, dbAdmin } from '@/lib/firebase-admin';
import { AppError } from '@/lib/observability/app-error';

const GOOGLE_PROVIDER = 'google.com';
const RECENT_AUTH_SECONDS = 10 * 60;

function normalizedEmail(value: unknown) {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

function configuredClientId() {
  return process.env.GOOGLE_AUTH_WEB_CLIENT_ID?.trim() || '';
}

function allowedDomain() {
  return (process.env.GOOGLE_WORKSPACE_LOGIN_DOMAIN?.trim().toLowerCase() || 'coalashakes.com');
}

function expectedEmail(context: ServerUserContext) {
  return normalizedEmail((context.userDoc as ServerUserContext['userDoc'] & { corporateGoogleEmail?: unknown }).corporateGoogleEmail);
}

type GooglePayload = { sub?: string; email?: string; email_verified?: boolean; hd?: string; name?: string; picture?: string; iat?: number };
type Dependencies = {
  auth: typeof authAdmin;
  db: typeof dbAdmin;
  verifyToken: (idToken: string, clientId: string) => Promise<GooglePayload>;
  now: () => Timestamp;
};
const defaults: Dependencies = {
  auth: authAdmin,
  db: dbAdmin,
  verifyToken: async (idToken, clientId) => (await new OAuth2Client(clientId)
    .verifyIdToken({ idToken, audience: clientId })).getPayload() ?? {},
  now: Timestamp.now,
};

async function findUserByEmail(auth: typeof authAdmin, email: string) {
  try { return await auth.getUserByEmail(email); }
  catch (cause) {
    if ((cause as { code?: string }).code === 'auth/user-not-found') return null;
    throw cause;
  }
}

async function findUserByGoogleSubject(auth: typeof authAdmin, subject: string) {
  const result = await auth.getUsers([{ providerId: GOOGLE_PROVIDER, providerUid: subject }]);
  return result.users[0] ?? null;
}

export async function googleWorkspaceMigrationStatus(context: ServerUserContext) {
  const targetEmail = expectedEmail(context);
  const user = await authAdmin.getUser(context.decoded.uid);
  const google = user.providerData.find((provider) => provider.providerId === GOOGLE_PROVIDER);
  const linkedEmail = normalizedEmail(google?.email);
  const completed = Boolean(linkedEmail && normalizedEmail(user.email) === linkedEmail
    && (!targetEmail || linkedEmail === targetEmail));
  const required = Boolean(configuredClientId() && targetEmail && targetEmail.endsWith(`@${allowedDomain()}`) && !completed);
  return {
    available: Boolean(configuredClientId() && !completed),
    required,
    currentEmail: normalizedEmail(user.email) || null,
    targetEmail: targetEmail || null,
    completed,
    provider: completed ? GOOGLE_PROVIDER : null,
    accountKind: completed && linkedEmail.endsWith(`@${allowedDomain()}`) ? 'workspace' : completed ? 'personal_google' : null,
  };
}

export async function migrateCurrentUserToGoogleWorkspace(
  context: ServerUserContext,
  input: { googleIdToken: string },
  injected: Partial<Dependencies> = {},
) {
  const deps = { ...defaults, ...injected };
  const clientId = configuredClientId();
  if (!clientId) throw new AppError({ code: 'GOOGLE_MIGRATION_NOT_CONFIGURED', kind: 'EXPECTED_BUSINESS', safeMessage: 'A migração Google ainda não está disponível.' });
  const targetEmail = expectedEmail(context);
  const workspaceRequired = Boolean(targetEmail && targetEmail.endsWith(`@${allowedDomain()}`));
  const nowSeconds = Math.floor(Date.now() / 1000);
  // The pre-authorized Workspace account is itself a second verified factor. A freely chosen
  // personal Google account still requires a recent password session before it can replace login.
  if (!workspaceRequired && (typeof context.decoded.auth_time !== 'number' || nowSeconds - context.decoded.auth_time > RECENT_AUTH_SECONDS)) {
    throw new AppError({ code: 'GOOGLE_MIGRATION_RECENT_LOGIN_REQUIRED', kind: 'AUTHENTICATION', safeMessage: 'Entre novamente com sua senha antes de migrar o acesso.' });
  }

  let payload: GooglePayload;
  try {
    payload = await deps.verifyToken(input.googleIdToken, clientId);
  } catch {
    throw new AppError({ code: 'GOOGLE_MIGRATION_TOKEN_INVALID', kind: 'AUTHENTICATION', safeMessage: 'O Google não confirmou esta conta. Tente novamente.' });
  }
  const googleEmail = normalizedEmail(payload?.email);
  if (!payload?.sub || payload.email_verified !== true || !googleEmail) {
    throw new AppError({ code: 'GOOGLE_MIGRATION_IDENTITY_INVALID', kind: 'AUTHENTICATION', safeMessage: 'O Google não confirmou o e-mail escolhido.' });
  }
  if (workspaceRequired && (googleEmail !== targetEmail || payload.hd?.toLowerCase() !== allowedDomain())) {
    throw new AppError({ code: 'GOOGLE_MIGRATION_IDENTITY_MISMATCH', kind: 'AUTHORIZATION', safeMessage: `Use a conta empresarial ${targetEmail}.` });
  }
  const migrationEmail = workspaceRequired ? targetEmail : googleEmail;

  const [emailOwner, providerOwner, current] = await Promise.all([
    findUserByEmail(deps.auth, migrationEmail),
    findUserByGoogleSubject(deps.auth, payload.sub),
    deps.auth.getUser(context.decoded.uid),
  ]);
  if (emailOwner && emailOwner.uid !== context.decoded.uid) {
    throw new AppError({ code: 'GOOGLE_MIGRATION_EMAIL_IN_USE', kind: 'CONFLICT', safeMessage: 'A conta empresarial já está vinculada a outro acesso. Procure o administrador.' });
  }
  if (providerOwner && providerOwner.uid !== context.decoded.uid) {
    throw new AppError({ code: 'GOOGLE_MIGRATION_PROVIDER_IN_USE', kind: 'CONFLICT', safeMessage: 'Esta conta Google já está vinculada a outro acesso. Procure o administrador.' });
  }

  const linked = current.providerData.find((provider) => provider.providerId === GOOGLE_PROVIDER);
  if (linked && linked.uid !== payload.sub) {
    throw new AppError({ code: 'GOOGLE_MIGRATION_DIFFERENT_PROVIDER', kind: 'CONFLICT', safeMessage: 'Este cadastro já possui outra conta Google vinculada.' });
  }
  if (linked && normalizedEmail(current.email) === migrationEmail
    && (context.userDoc as Record<string, unknown>).googleWorkspaceMigrationStatus === 'linked') {
    return { migrated: true as const, uid: context.decoded.uid, email: migrationEmail, provider: GOOGLE_PROVIDER };
  }
  const now = deps.now();
  const userRef = deps.db.collection('users').doc(context.decoded.uid);
  const attemptKey = createHash('sha256').update(JSON.stringify([context.decoded.uid, payload.sub, payload.iat ?? now.toMillis()])).digest('hex');
  const auditRef = deps.db.collection('authIdentityMigrations').doc(attemptKey);
  const auditExpiresAt = Timestamp.fromMillis(now.toMillis() + 1_825 * 86_400_000);
  await deps.db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(userRef);
    if (!snapshot.exists || snapshot.get('isActive') === false) {
      throw new AppError({ code: 'GOOGLE_MIGRATION_USER_INACTIVE', kind: 'AUTHORIZATION', safeMessage: 'O cadastro não está ativo.' });
    }
    if (workspaceRequired && normalizedEmail(snapshot.get('corporateGoogleEmail')) !== targetEmail) {
      throw new AppError({ code: 'GOOGLE_MIGRATION_AUTHORIZATION_CHANGED', kind: 'CONFLICT', safeMessage: 'A autorização empresarial mudou. Atualize e tente novamente.' });
    }
    transaction.update(userRef, { googleWorkspaceMigrationStatus: 'pending_auth', googleWorkspaceMigrationStartedAt: now, updatedAt: now });
    transaction.set(auditRef, {
      workspaceId: context.workspace_id,
      userId: context.decoded.uid,
      fromEmail: normalizedEmail(current.email),
      toEmail: migrationEmail,
      provider: GOOGLE_PROVIDER,
      googleSubject: payload.sub,
      status: 'pending_auth',
      startedAt: now,
      actorId: context.decoded.uid,
      expiresAt: auditExpiresAt,
    }, { merge: true });
  });
  if (!linked || normalizedEmail(current.email) !== migrationEmail) {
    await deps.auth.updateUser(context.decoded.uid, {
      email: migrationEmail, emailVerified: true,
      providerToLink: linked ? undefined : { providerId: GOOGLE_PROVIDER, uid: payload.sub, email: migrationEmail,
        displayName: payload.name, photoURL: payload.picture },
    });
  }
  await deps.db.runTransaction(async (transaction) => {
    const [snapshot, audit] = await Promise.all([transaction.get(userRef), transaction.get(auditRef)]);
    if (!snapshot.exists || snapshot.get('isActive') === false
      || (workspaceRequired && normalizedEmail(snapshot.get('corporateGoogleEmail')) !== targetEmail)
      || audit.get('googleSubject') !== payload.sub) {
      throw new AppError({ code: 'GOOGLE_MIGRATION_FINALIZATION_CONFLICT', kind: 'CONFLICT', safeMessage: 'A autorização empresarial mudou durante a migração.' });
    }
    transaction.update(userRef, { email: migrationEmail, googleWorkspaceMigrationStatus: 'linked',
      googleLoginKind: workspaceRequired ? 'workspace' : 'personal_google', googleWorkspaceLinkedAt: now, updatedAt: now });
    transaction.set(auditRef, { status: 'linked', linkedAt: now }, { merge: true });
  });
  await deps.auth.revokeRefreshTokens(context.decoded.uid);
  return { migrated: true as const, uid: context.decoded.uid, email: migrationEmail, provider: GOOGLE_PROVIDER };
}
