"use client";

import React, { createContext, useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { type User, type PermissionSet, defaultGuestPermissions, defaultAdminPermissions } from '@/types';
import { db, auth } from '@/lib/firebase';
import { collection, onSnapshot, doc, query, getDoc, setDoc, updateDoc, deleteDoc } from "firebase/firestore";
import { onAuthStateChanged, signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut, sendPasswordResetEmail, type User as FirebaseUser, EmailAuthProvider, reauthenticateWithCredential, updatePassword } from "firebase/auth";
import { useProfiles } from '@/hooks/use-profiles';
import { produce } from 'immer';

const ORIGINAL_USER_STORAGE_KEY = 'smart-converter-original-user';

export interface AuthContextType {
  user: User | null;
  firebaseUser: FirebaseUser | null;
  originalUser: User | null;
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
  impersonate: (userId: string) => void;
  stopImpersonating: () => void;
}

export const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [firebaseUser, setFirebaseUser] = useState<FirebaseUser | null>(null);
  const [appUser, setAppUser] = useState<User | null>(null);
  const [originalUser, setOriginalUser] = useState<User | null>(null);
  const [users, setUsers] = useState<User[]>([]);
  const [permissions, setPermissions] = useState<PermissionSet>(defaultGuestPermissions);
  const [loading, setLoading] = useState(true);
  const { profiles, adminProfileId, loading: profilesLoading } = useProfiles();
  const router = useRouter();

  const adminCredentials = useRef<{email: string, password: string} | null>(null);

  useEffect(() => {
    const unsubscribeAuth = onAuthStateChanged(auth, async (user) => {
      setFirebaseUser(user);
      if (user) {
        if (profilesLoading) {
            setLoading(true);
            return;
        }

        const userDocRef = doc(db, 'users', user.uid);
        let userDocSnap = await getDoc(userDocRef);
        
        if (!userDocSnap.exists() && user.email === 'administrativo@coalashakes.com') {
          if (adminProfileId) {
            const firstAdminData: Omit<User, 'id'> = {
                username: user.displayName || user.email!.split('@')[0],
                email: user.email!,
                profileId: adminProfileId,
                assignedKioskIds: [],
            };
            await setDoc(userDocRef, firstAdminData);
            userDocSnap = await getDoc(userDocRef);
          }
        }
        
        if (userDocSnap.exists()) {
          const userData = { id: userDocSnap.id, ...userDocSnap.data() } as User;
          setAppUser(userData);
        } else {
           await signOut(auth);
           setAppUser(null);
        }
      } else {
        setAppUser(null);
      }
      setLoading(false);
    });

    try {
      const storedOriginalUser = localStorage.getItem(ORIGINAL_USER_STORAGE_KEY);
      if (storedOriginalUser) setOriginalUser(JSON.parse(storedOriginalUser));
    } catch (error) {
        console.error("Failed to load original user state from storage", error);
    }

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
    
    const mergeRecursive = (target: Record<string, any>, source: Record<string, any>) => {
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
    };

    const finalPermissions = produce(defaultGuestPermissions, (draft: any) => {
        mergeRecursive(draft, userProfile.permissions);
    });

    setPermissions(finalPermissions);
  }, [appUser, profiles, loading, profilesLoading, adminProfileId]);

  const login = useCallback(async (email: string, password: string): Promise<boolean> => {
    try {
      await signInWithEmailAndPassword(auth, email, password);
      if (email === 'administrativo@coalashakes.com') {
        adminCredentials.current = { email, password };
      }
      return true;
    } catch (error) {
      console.error("Login error:", error);
      return false;
    }
  }, []);

  const stopImpersonating = useCallback(() => {
    if (originalUser) {
      setAppUser(originalUser);
      setOriginalUser(null);
      localStorage.removeItem(ORIGINAL_USER_STORAGE_KEY);
    }
  }, [originalUser]);

  const logout = useCallback(async () => {
    stopImpersonating();
    adminCredentials.current = null;
    await signOut(auth);
    router.push('/login');
  }, [router, stopImpersonating]);

  const addUser = useCallback(async (userData: Omit<User, 'id' | 'email'>, email: string, password: string):Promise<string | null> => {
    try {
      const userCredential = await createUserWithEmailAndPassword(auth, email, password);
      const newUser = userCredential.user;
      const userDocRef = doc(db, 'users', newUser.uid);
      await setDoc(userDocRef, { ...userData, email });
      
      if (adminCredentials.current && auth.currentUser?.email !== 'administrativo@coalashakes.com') {
         await signInWithEmailAndPassword(auth, adminCredentials.current.email, adminCredentials.current.password);
      }
      return newUser.uid;
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

  const changePassword = useCallback(async (oldPassword: string, newPassword: string): Promise<{ success: boolean; error?: string }> => {
    const user = auth.currentUser;
    if (!user || !user.email) return { success: false, error: 'Usuário não autenticado.' };
    const credential = EmailAuthProvider.credential(user.email, oldPassword);
    try {
      await reauthenticateWithCredential(user, credential);
      await updatePassword(user, newPassword);
      if (adminCredentials.current) adminCredentials.current.password = newPassword;
      return { success: true };
    } catch (error: any) {
      let errorMessage = 'Ocorreu um erro ao alterar a senha.';
      if (error.code === 'auth/wrong-password') errorMessage = 'A senha antiga está incorreta.';
      return { success: false, error: errorMessage };
    }
  }, []);

  const impersonate = useCallback((userId: string) => {
    if (!permissions.settings.impersonate) return;
    const userToImpersonate = users.find(u => u.id === userId);
    if (userToImpersonate && appUser && !originalUser) {
      setOriginalUser(appUser);
      setAppUser(userToImpersonate);
      localStorage.setItem(ORIGINAL_USER_STORAGE_KEY, JSON.stringify(appUser));
    }
  }, [appUser, originalUser, users, permissions.settings.impersonate]);

  const value = useMemo(() => ({
    user: appUser,
    firebaseUser,
    originalUser,
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
    impersonate,
    stopImpersonating,
  }), [
    appUser, firebaseUser, originalUser, users, loading, profilesLoading, permissions, login, logout, addUser, updateUser, deleteUser, resetPassword, changePassword, impersonate, stopImpersonating
  ]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}