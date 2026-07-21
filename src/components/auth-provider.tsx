
"use client";

import React, { createContext, useState, useEffect, useCallback, useMemo } from 'react';
import { type User, type PermissionSet, defaultGuestPermissions, defaultAdminPermissions } from '@/types';
import { db, auth, functions } from '@/lib/firebase';
import { collection, onSnapshot, doc, query, getDoc, getDocFromCache } from "firebase/firestore";
import { onAuthStateChanged, signInWithEmailAndPassword, signOut, type User as FirebaseUser, EmailAuthProvider, reauthenticateWithCredential, updatePassword } from "firebase/auth";
import { httpsCallable } from "firebase/functions";
import { useProfiles } from '@/hooks/use-profiles';
import { produce } from 'immer';
import { ChangePasswordModal } from './change-password-modal';
import { fetchClientBootstrap } from '@/lib/client-bootstrap';
import { applyLegacyFormalizationFallbacks } from '@/lib/hr-formalization-permissions';
import {
  fetchHrLoginAccess,
  type HrLoginAccessPayload,
} from '@/features/hr/lib/client';

export interface TerminateUserPayload {
  uid: string;
  inactivationType?: 'temporary' | 'contract_termination';
  terminationReason?: string;
  terminationCause?: string;
  terminationNotes?: string;
  terminationDate?: string;
}

export interface AuthContextType {
  user: User | null;
  firebaseUser: FirebaseUser | null;
  users: User[];
  activeUsers: User[];
  terminatedUsers: User[];
  isAuthenticated: boolean;
  loading: boolean;
  permissions: PermissionSet;
  login: (email: string, password: string) => Promise<{
    success: boolean;
    error?: string;
    loginAccessGate?: HrLoginAccessPayload | null;
  }>;
  logout: () => void;
  addUser: (userData: Omit<User, 'id' | 'email'>, email: string) => Promise<
    { uid: string; emailSent: boolean; firstAccessExpiresAt?: string; warning?: string } | { error: string }
  >;
  updateUser: (user: User) => Promise<void>;
  deleteUser: (userId: string) => Promise<void>;
  terminateUser: (payload: TerminateUserPayload) => Promise<void>;
  reactivateUser: (userId: string) => Promise<void>;
  resetPassword: (email: string) => Promise<boolean>;
  changePassword: (oldPassword: string, newPassword: string) => Promise<{ success: boolean; error?: string }>;
  recordLoginAccess: () => Promise<void>;
}

export const AuthContext = createContext<AuthContextType | undefined>(undefined);

function buildBlockedLoginMessage(payload: HrLoginAccessPayload) {
  switch (payload.evaluation.reason) {
    case 'before_shift_too_early':
      return payload.evaluation.nextAllowedAtLocal
        ? `Seu acesso será liberado a partir de ${payload.evaluation.nextAllowedAtLocal}.`
        : 'Seu turno ainda não está dentro da janela permitida de acesso.';
    case 'day_off':
      return 'Este colaborador está em folga na escala atual. O acesso permanece bloqueado.';
    case 'after_shift_extension_limit_reached':
      return 'O turno atual já consumiu as 2 extensões automáticas disponíveis. Aguarde a próxima janela permitida.';
    default:
      return 'Seu acesso está bloqueado pela política de escala.';
  }
}

function applyCommercialPermissionFallbacks(permissions: PermissionSet) {
  const legacyCanViewSheets = permissions.dashboard?.technicalSheets === true;
  const legacyCanEditSheets = permissions.pricing?.simulate === true;

  permissions.commercial.technicalSheets.view ||= legacyCanViewSheets;
  permissions.commercial.technicalSheets.create ||= legacyCanEditSheets;
  permissions.commercial.technicalSheets.edit ||= legacyCanEditSheets;
  permissions.commercial.technicalSheets.delete ||= legacyCanEditSheets;
  permissions.commercial.technicalSheets.export ||= legacyCanViewSheets || legacyCanEditSheets;
}

function decodeJwtHeader(token: string): Record<string, unknown> | null {
  try {
    const [header] = token.split(".");
    if (!header) return null;
    const normalized = header.replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
    return JSON.parse(atob(padded)) as Record<string, unknown>;
  } catch {
    return null;
  }
}

async function hasEmulatorIdToken(user: FirebaseUser) {
  const token = await user.getIdToken(false);
  return decodeJwtHeader(token)?.alg === "none";
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [firebaseUser, setFirebaseUser] = useState<FirebaseUser | null>(null);
  const [appUser, setAppUser] = useState<User | null>(null);
  const [users, setUsers] = useState<User[]>([]);
  const [permissions, setPermissions] = useState<PermissionSet>(defaultGuestPermissions);
  const [loading, setLoading] = useState(true);
  const [permissionsReady, setPermissionsReady] = useState(false);
  const { profiles, adminProfileId, loading: profilesLoading } = useProfiles();

  useEffect(() => {
    const unsubscribeAuth = onAuthStateChanged(auth, async (user) => {
      setLoading(true);
      setPermissionsReady(false);
      setFirebaseUser(user);

      if (!user) {
        setAppUser(null);
        setPermissions(defaultGuestPermissions);
        setPermissionsReady(true);
        setLoading(false);
        return;
      }

      if (user) {
        if (process.env.NEXT_PUBLIC_USE_FIREBASE_EMULATOR === "true") {
          const isEmulatorToken = await hasEmulatorIdToken(user).catch(() => false);
          if (!isEmulatorToken) {
            await signOut(auth);
            setAppUser(null);
            setPermissions(defaultGuestPermissions);
            setPermissionsReady(true);
            setLoading(false);
            return;
          }
        }

        const userDocRef = doc(db, 'users', user.uid);
        let userDocSnap;
        let fallbackUser: User | null = null;

        const loadCurrentUserFallback = async () => {
          try {
            const payload = await fetchClientBootstrap(user, ["currentUser"]);
            return payload.currentUser ?? null;
          } catch (fallbackError) {
            console.error("[AuthProvider] Server user fallback failed.", fallbackError);
            return null;
          }
        };

        try {
          userDocSnap = await getDoc(userDocRef);

          if (!userDocSnap.exists()) {
            // Aguarda documento ser criado pela Cloud Function
            await new Promise(resolve => setTimeout(resolve, 3000));
            userDocSnap = await getDoc(userDocRef);
          }
        } catch (error) {
          console.error("[AuthProvider] Failed to fetch user document from Firestore.", error);

          try {
            userDocSnap = await getDocFromCache(userDocRef);
          } catch (cacheError) {
            console.error("[AuthProvider] Cached user document is unavailable.", cacheError);
            fallbackUser = await loadCurrentUserFallback();
          }
        }

        if (!userDocSnap?.exists() && !fallbackUser) {
          fallbackUser = await loadCurrentUserFallback();
        }

        if (userDocSnap?.exists() || fallbackUser) {
          // Força refresh do token para garantir claims atualizados (profileId, isDefaultAdmin)
          await user.getIdToken(true);
          void recordLoginAccess(user);
          const userData = fallbackUser ?? ({ id: userDocSnap!.id, ...userDocSnap!.data() } as User);
          setAppUser(userData);
        } else {
          await signOut(auth);
          setAppUser(null);
        }
      }
      setLoading(false);
    });

    return () => unsubscribeAuth();
  }, []);

  useEffect(() => {
    if (profilesLoading || !permissionsReady) return;

    if (!appUser) {
      setUsers([]);
      return;
    }

    const canReadUsersDirectory =
      permissions.settings.manageUsers ||
      (permissions.dp?.collaborators?.view === true && permissions.dp?.collaborators?.ownProfileOnly !== true) ||
      permissions.dp?.collaborators?.edit === true ||
      permissions.dp?.collaborators?.terminate === true;

    if (!canReadUsersDirectory) {
      setUsers([appUser]);
      return;
    }

    const q = query(collection(db, "users"));
    const unsubscribeUsers = onSnapshot(q, (snapshot) => {
        const usersData = snapshot.docs.map(doc => ({ ...doc.data(), id: doc.id } as User));
        setUsers(usersData);
    }, (error) => {
        console.error("[AuthProvider] Falha ao carregar diretório de usuários.", error);
        const currentFirebaseUser = firebaseUser ?? auth.currentUser;
        if (!currentFirebaseUser) {
          setUsers([appUser]);
          return;
        }

        void fetchClientBootstrap(currentFirebaseUser, ["users"])
          .then((payload) => setUsers(payload.users?.length ? payload.users : [appUser]))
          .catch((fallbackError) => {
            console.error("[AuthProvider] Server users fallback failed.", fallbackError);
            setUsers([appUser]);
          });
    });
    return () => unsubscribeUsers();
  }, [appUser, firebaseUser, permissions, permissionsReady, profilesLoading]);

  const mergeRecursive = useCallback((target: Record<string, any>, source: Record<string, any>) => {
    if (!source || typeof source !== 'object' || Array.isArray(source)) return;
    if (!target || typeof target !== 'object' || Array.isArray(target)) return;

    Object.keys(source).forEach(key => {
      const sourceValue = source[key];
      const targetValue = target[key];

      if (
        sourceValue !== null &&
        sourceValue !== undefined &&
        typeof sourceValue === 'object' &&
        !Array.isArray(sourceValue) &&
        targetValue !== null &&
        targetValue !== undefined &&
        typeof targetValue === 'object' &&
        !Array.isArray(targetValue)
      ) {
        mergeRecursive(targetValue, sourceValue);
      } else if (sourceValue !== undefined && sourceValue !== null) {
        target[key] = sourceValue;
      }
    });
  }, []);

  useEffect(() => {
    if (loading || profilesLoading) {
      setPermissionsReady(false);
      return;
    }

    if (!appUser) {
      setPermissions(defaultGuestPermissions);
      setPermissionsReady(true);
      return;
    }

    if (!profiles || !adminProfileId) {
      setPermissionsReady(false);
      return;
    }
    
    const userProfile = profiles.find(p => p.id === appUser.profileId);
    const isDefaultAdminProfile =
      userProfile?.isDefaultAdmin === true ||
      appUser.profileId === adminProfileId;

    if (isDefaultAdminProfile) {
      setPermissions(defaultAdminPermissions);
      setPermissionsReady(true);
      return;
    }

    if (!userProfile?.permissions) {
      setPermissions(defaultGuestPermissions);
      setPermissionsReady(true);
      return;
    }
    
    const finalPermissions = produce(defaultGuestPermissions, (draft: any) => {
        mergeRecursive(draft, userProfile.permissions);
        applyCommercialPermissionFallbacks(draft);
        applyLegacyFormalizationFallbacks(draft, userProfile.permissions);
    });

    setPermissions(finalPermissions);
    setPermissionsReady(true);
  }, [appUser, profiles, loading, profilesLoading, adminProfileId, mergeRecursive]);

  const recordLoginAccess = useCallback(async (targetUser?: FirebaseUser | null) => {
    const user = targetUser ?? auth.currentUser;
    if (!user) return;

    try {
      const token = await user.getIdToken();
      await fetch("/api/auth/last-login", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });
    } catch (error) {
      console.warn("[AuthProvider] Falha ao registrar ultimo acesso.", error);
    }
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    try {
      setLoading(true);
      setPermissionsReady(false);
      const credential = await signInWithEmailAndPassword(auth, email, password);
      // Força refresh do token para pegar os custom claims mais recentes
      await credential.user.getIdToken(true);

      try {
        const loginAccess = await fetchHrLoginAccess(credential.user, {});

        if (
          loginAccess.user.loginRestrictionEnabled &&
          loginAccess.evaluation.status === 'blocked' &&
          loginAccess.evaluation.reason !== 'no_schedule_assigned'
        ) {
          if (loginAccess.evaluation.reason === 'after_shift_requires_justification') {
            setLoading(false);
            return {
              success: true,
              loginAccessGate: loginAccess,
            };
          }

          await signOut(auth);
          return {
            success: false,
            error: buildBlockedLoginMessage(loginAccess),
          };
        }
      } catch (loginAccessError) {
        console.warn('[AuthProvider] Falha ao validar acesso por escala no login. Mantendo fluxo atual.', loginAccessError);
      }

      await recordLoginAccess();
      return { success: true };
    } catch (error) {
      console.error("Login error:", error);
      setLoading(false);
      setPermissionsReady(true);
      return {
        success: false,
        error: 'E-mail ou senha inválidos. Verifique seus dados e tente novamente.',
      };
    }
  }, [recordLoginAccess]);

  const logout = useCallback(async () => {
    await signOut(auth);
    window.location.href = '/login'; // reload completo mata todos os listeners
  }, []);

  const addUser = useCallback(async (userData: Omit<User, 'id' | 'email'>, email: string) => {
    try {
      const token = await auth.currentUser?.getIdToken(true);
      if (!token) return { error: 'Usuário não autenticado.' };
      const response = await fetch('/api/users', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          email,
          userData,
          username: userData.username,
          profileId: userData.profileId,
        }),
      });
      const result = await response.json().catch(() => null);
      if (!response.ok) {
        return { error: result?.error || 'Erro ao criar usuário.' };
      }
      return {
        uid: String(result.uid),
        emailSent: result.emailSent === true,
        firstAccessExpiresAt: typeof result.firstAccessExpiresAt === 'string' ? result.firstAccessExpiresAt : undefined,
        warning: typeof result.warning === 'string' ? result.warning : undefined,
      };
    } catch (error: any) {
      console.error("Error adding user:", error);
      return { error: error?.message || 'Erro ao criar usuário.' };
    }
  }, []);

  const updateUser = useCallback(async (updatedUser: User) => {
    const { id, email, ...dataToUpdate } = updatedUser as any;
    delete dataToUpdate.password;

    const token = await auth.currentUser?.getIdToken();
    if (!token) throw new Error("Usuário não autenticado.");

    const response = await fetch(`/api/users/${encodeURIComponent(id)}`, {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(dataToUpdate),
    });

    if (!response.ok) {
      const payload = await response.json().catch(() => null);
      throw new Error(payload?.error ?? "Erro ao atualizar usuário.");
    }
  }, []);
  
  const deleteUser = useCallback(async (userId: string) => {
    try {
      const deleteUserFn = httpsCallable(functions, 'deleteUser');
      await deleteUserFn({ uid: userId });
    } catch (error) {
      console.error("Error deleting user:", error);
      throw error;
    }
  }, []);

  const terminateUser = useCallback(async (payload: TerminateUserPayload) => {
    try {
      const terminateUserFn = httpsCallable(functions, 'terminateUser');
      await terminateUserFn(payload);
    } catch (error) {
      console.error("Error terminating user:", error);
      throw error;
    }
  }, []);

  const reactivateUser = useCallback(async (userId: string) => {
    try {
      const reactivateUserFn = httpsCallable(functions, 'reactivateUser');
      await reactivateUserFn({ uid: userId });
    } catch (error) {
      console.error("Error reactivating user:", error);
      throw error;
    }
  }, []);
  
  const resetPassword = useCallback(async (email: string): Promise<boolean> => {
    try {
      const response = await fetch("/api/auth/forgot-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      return response.ok;
    } catch (error) {
      console.error("Password reset error:", error);
      return false;
    }
  }, []);

  const changePassword = useCallback(async (oldPassword: string, newPassword: string) => {
    const user = auth.currentUser;
    if (!user || !user.email) return { success: false, error: 'Usuário não autenticado.' };
    const credential = EmailAuthProvider.credential(user.email, oldPassword);
    try {
      await reauthenticateWithCredential(user, credential);
      await updatePassword(user, newPassword);

      const token = await user.getIdToken();
      const response = await fetch("/api/auth/password-changed", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        throw new Error(payload?.error ?? "Senha alterada, mas falhou ao atualizar o cadastro.");
      }

      setAppUser((current) =>
        current && current.id === user.uid
          ? { ...current, mustChangePassword: false }
          : current
      );
      return { success: true };
    } catch (error: any) {
      let errorMessage = 'Ocorreu um erro ao alterar a senha.';
      if (error.code === 'auth/wrong-password') errorMessage = 'A senha antiga está incorreta.';
      return { success: false, error: errorMessage };
    }
  }, []);

  const activeUsers = useMemo(() => users.filter(u => u.isActive !== false), [users]);
  const terminatedUsers = useMemo(() => users.filter(u => u.isActive === false), [users]);

  const value = useMemo(() => ({
    user: appUser,
    firebaseUser,
    users,
    activeUsers,
    terminatedUsers,
    isAuthenticated: !!appUser,
    loading: loading || profilesLoading || !permissionsReady,
    permissions,
    login,
    logout,
    addUser,
    updateUser,
    deleteUser,
    terminateUser,
    reactivateUser,
    resetPassword,
    changePassword,
    recordLoginAccess,
  }), [
    appUser, firebaseUser, users, activeUsers, terminatedUsers, loading, profilesLoading,
    permissionsReady, permissions, login, logout, addUser, updateUser, deleteUser, terminateUser, reactivateUser, resetPassword, changePassword, recordLoginAccess,
  ]);

  return (
    <AuthContext.Provider value={value}>
      {children}
      <ChangePasswordModal
        open={!!appUser?.mustChangePassword}
        onOpenChange={() => undefined}
        forceChange
      />
    </AuthContext.Provider>
  );
}
