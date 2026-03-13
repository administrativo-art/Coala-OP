
"use client";

import React, { createContext, useState, useEffect, useCallback, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { type User, type PermissionSet, defaultGuestPermissions, defaultAdminPermissions } from '@/types';
import { db, auth, functions } from '@/lib/firebase';
import { collection, onSnapshot, doc, query, getDoc, updateDoc, deleteDoc } from "firebase/firestore";
import { onAuthStateChanged, signInWithEmailAndPassword, signOut, sendPasswordResetEmail, type User as FirebaseUser, EmailAuthProvider, reauthenticateWithCredential, updatePassword } from "firebase/auth";
import { httpsCallable } from "firebase/functions";
import { useProfiles } from '@/hooks/use-profiles';
import { produce } from 'immer';

export interface AuthContextType {
  user: User | null;
  firebaseUser: FirebaseUser | null;
  users: User[];
  isAuthenticated: boolean;
  loading: boolean;
  permissions: PermissionSet;
  login: (email: string, password: string) => Promise<boolean>;
  logout: () => void;
  addUser: (userData: Omit<User, 'id' | 'email'>, email: string, password: string) => Promise<string | null>;
  updateUser: (user: User) => Promise<void>;
  deleteUser: (userId: string) => Promise<void>;
  resetPassword: (email: string) => Promise<boolean>;
  changePassword: (oldPassword: string, newPassword: string) => Promise<{ success: boolean; error?: string }>;
}

export const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [firebaseUser, setFirebaseUser] = useState<FirebaseUser | null>(null);
  const [appUser, setAppUser] = useState<User | null>(null);
  const [users, setUsers] = useState<User[]>([]);
  const [permissions, setPermissions] = useState<PermissionSet>(defaultGuestPermissions);
  const [loading, setLoading] = useState(true);
  const { profiles, adminProfileId, loading: profilesLoading } = useProfiles();
  const router = useRouter();

  useEffect(() => {
    const unsubscribeAuth = onAuthStateChanged(auth, async (user) => {
      setFirebaseUser(user);
      if (user) {
        if (profilesLoading) {
            setLoading(true);
            return;
        }

        const userDocRef = doc(db, 'users', user.uid);
        const userDocSnap = await getDoc(userDocRef);
        
        if (userDocSnap.exists()) {
          const userData = { id: userDocSnap.id, ...userDocSnap.data() } as User;
          setAppUser(userData);
        } else {
          // Aguarda documento ser criado pela Cloud Function
          await new Promise(resolve => setTimeout(resolve, 2000));
          const retrySnap = await getDoc(userDocRef);
          if (retrySnap.exists()) {
            const userData = { id: retrySnap.id, ...retrySnap.data() } as User;
            setAppUser(userData);
          } else {
            await signOut(auth);
            setAppUser(null);
          }
        }
      } else {
        setAppUser(null);
      }
      setLoading(false);
    });

    return () => unsubscribeAuth();
  }, [profilesLoading, adminProfileId]);

  useEffect(() => {
    if (profilesLoading) return; 
    const q = query(collection(db, "users"));
    const unsubscribeUsers = onSnapshot(q, (snapshot) => {
        const usersData = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as User));
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
    if (loading || !appUser || profilesLoading || !profiles || !adminProfileId) {
      setPermissions(defaultGuestPermissions);
      return;
    }
    
    const userProfile = profiles.find(p => p.id === appUser.profileId);
    
    if (userProfile?.isDefaultAdmin) {
      setPermissions(defaultAdminPermissions);
      return;
    }

    if (!userProfile?.permissions) {
      setPermissions(defaultGuestPermissions);
      return;
    }
    
    const finalPermissions = produce(defaultGuestPermissions, (draft: any) => {
        mergeRecursive(draft, userProfile.permissions);
    });

    setPermissions(finalPermissions);
  }, [appUser, profiles, loading, profilesLoading, adminProfileId, mergeRecursive]);

  const login = useCallback(async (email: string, password: string): Promise<boolean> => {
    try {
      const credential = await signInWithEmailAndPassword(auth, email, password);
      // Força refresh do token para pegar os custom claims mais recentes
      await credential.user.getIdToken(true);
      return true;
    } catch (error) {
      console.error("Login error:", error);
      return false;
    }
  }, []);

  const logout = useCallback(async () => {
    await signOut(auth);
    router.push('/login');
  }, [router]);

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
    await updateDoc(userRef, dataToUpdate);
  }, []);
  
  const deleteUser = useCallback(async (userId: string) => {
    await deleteDoc(doc(db, "users", userId));
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

  const value = useMemo(() => ({
    user: appUser,
    firebaseUser,
    users,
    isAuthenticated: !!appUser,
    loading: loading || profilesLoading,
    permissions,
    login,
    logout,
    addUser,
    updateUser,
    deleteUser,
    resetPassword,
    changePassword,
  }), [
    appUser, firebaseUser, users, loading, profilesLoading, permissions, login, logout, addUser, updateUser, deleteUser, resetPassword, changePassword
  ]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
