
"use client";

import React, { createContext, useState, useEffect, useCallback, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { type User, type PermissionSet, defaultGuestPermissions, defaultAdminPermissions } from '@/types';
import { db, auth, functions } from '@/lib/firebase';
import { collection, onSnapshot, doc, query, getDoc, getDocFromCache, updateDoc, deleteDoc, deleteField } from "firebase/firestore";
import { onAuthStateChanged, signInWithEmailAndPassword, signOut, sendPasswordResetEmail, type User as FirebaseUser, EmailAuthProvider, reauthenticateWithCredential, updatePassword } from "firebase/auth";
import { httpsCallable } from "firebase/functions";
import { useProfiles } from '@/hooks/use-profiles';
import { produce } from 'immer';
import {
  fetchHrLoginAccess,
  type HrLoginAccessPayload,
} from '@/features/hr/lib/client';

export interface TerminateUserPayload {
  uid: string;
  terminationReason?: 'Sem Justa Causa' | 'Pedido de Demissão' | 'Acordo' | 'Justa Causa';
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
  addUser: (userData: Omit<User, 'id' | 'email'>, email: string, password: string) => Promise<string | null>;
  updateUser: (user: User) => Promise<void>;
  deleteUser: (userId: string) => Promise<void>;
  terminateUser: (payload: TerminateUserPayload) => Promise<void>;
  resetPassword: (email: string) => Promise<boolean>;
  changePassword: (oldPassword: string, newPassword: string) => Promise<{ success: boolean; error?: string }>;
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

function sanitizeFirestoreUpdate(value: unknown): unknown {
  if (value === undefined) {
    return deleteField();
  }

  if (Array.isArray(value)) {
    return value.map(item => sanitizeFirestoreUpdate(item));
  }

  if (value && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype) {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, sanitizeFirestoreUpdate(entry)])
    );
  }

  return value;
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
        const userDocRef = doc(db, 'users', user.uid);
        let userDocSnap;

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
          }
        }

        if (userDocSnap?.exists()) {
          // Força refresh do token para garantir claims atualizados (profileId, isDefaultAdmin)
          await user.getIdToken(true);
          const userData = { id: userDocSnap.id, ...userDocSnap.data() } as User;
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
    if (profilesLoading) return; 
    const q = query(collection(db, "users"));
    const unsubscribeUsers = onSnapshot(q, (snapshot) => {
        const usersData = snapshot.docs.map(doc => ({ ...doc.data(), id: doc.id } as User));
        setUsers(usersData);
    });
    return () => unsubscribeUsers();
  }, [profilesLoading]);

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
    });

    setPermissions(finalPermissions);
    setPermissionsReady(true);
  }, [appUser, profiles, loading, profilesLoading, adminProfileId, mergeRecursive]);

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
  }, []);

  const logout = useCallback(async () => {
    await signOut(auth);
    window.location.href = '/login'; // reload completo mata todos os listeners
  }, []);

  const addUser = useCallback(async (userData: Omit<User, 'id' | 'email'>, email: string, password: string) => {
    try {
      // Força refresh do token para garantir que os claims estão atualizados antes de chamar a cloud function
      await auth.currentUser?.getIdToken(true);

      const createUserFn = httpsCallable(functions, 'createUser');
      
      const result = await createUserFn({
        email,
        password,
        username: userData.username,
        profileId: userData.profileId,
        assignedKioskIds: userData.assignedKioskIds,
        avatarUrl: userData.avatarUrl || '',
        operacional: userData.operacional || false,
      });

      const { uid } = result.data as { uid: string };
      return uid;
    } catch (error) {
      console.error("Error adding user:", error);
      return null;
    }
  }, []);

  const updateUser = useCallback(async (updatedUser: User) => {
    const userRef = doc(db, "users", updatedUser.id);
    const { id, email, ...dataToUpdate } = updatedUser as any;
    delete dataToUpdate.password;
    await updateDoc(userRef, sanitizeFirestoreUpdate(dataToUpdate) as Record<string, unknown>);
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
  
  const resetPassword = useCallback(async (email: string): Promise<boolean> => {
    try {
      await sendPasswordResetEmail(auth, email);
      return true;
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
    resetPassword,
    changePassword,
  }), [
    appUser, firebaseUser, users, activeUsers, terminatedUsers, loading, profilesLoading,
    permissionsReady, permissions, login, logout, addUser, updateUser, deleteUser, terminateUser, resetPassword, changePassword,
  ]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
