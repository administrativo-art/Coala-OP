
"use client";

import React, { createContext, useState, useEffect, useCallback, useContext, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { type User, type PermissionSet, defaultGuestPermissions, defaultAdminPermissions } from '@/types';
import { db } from '@/lib/firebase';
import { collection, onSnapshot, addDoc, doc, updateDoc, deleteDoc, query, where, getDocs } from "firebase/firestore";
import { ProfilesContext } from '@/components/profiles-provider';
import { produce } from 'immer';

const CURRENT_USER_STORAGE_KEY = 'smart-converter-current-user';
const ORIGINAL_USER_STORAGE_KEY = 'smart-converter-original-user';

// 1. User Context: Manages only the current user identity
// This is the key to forcing a remount of the AuthProvider
export interface UserContextType {
  user: User | null;
  originalUser: User | null;
  users: User[];
  loading: boolean;
  impersonate: (userId: string) => void;
  stopImpersonating: () => void;
  logout: () => void;
  updateUser: (user: User) => Promise<void>;
}

export const UserContext = createContext<UserContextType | undefined>(undefined);

export function UserProvider({ children }: { children: React.ReactNode }) {
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [originalUser, setOriginalUser] = useState<User | null>(null);
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const router = useRouter();

  useEffect(() => {
    try {
      const storedUser = localStorage.getItem(CURRENT_USER_STORAGE_KEY);
      if (storedUser) setCurrentUser(JSON.parse(storedUser));
      const storedOriginalUser = localStorage.getItem(ORIGINAL_USER_STORAGE_KEY);
      if (storedOriginalUser) setOriginalUser(JSON.parse(storedOriginalUser));
    } catch (error) {
      console.error("Failed to load user state from storage", error);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    const q = query(collection(db, "users"));
    const unsubscribe = onSnapshot(q, (querySnapshot) => {
        const usersData = querySnapshot.docs.map(docData => {
            const data = docData.data();
            return { 
                id: docData.id, 
                ...data,
                assignedKioskIds: data.assignedKioskIds ?? [data.kioskId].filter(Boolean) ?? [],
             } as User
        });
        setUsers(usersData);
    });
    return () => unsubscribe();
  }, []);

  const logout = useCallback(() => {
    setCurrentUser(null);
    setOriginalUser(null);
    localStorage.removeItem(CURRENT_USER_STORAGE_KEY);
    localStorage.removeItem(ORIGINAL_USER_STORAGE_KEY);
    router.push('/login');
  }, [router]);

  const impersonate = useCallback((userId: string) => {
    const userToImpersonate = users.find(u => u.id === userId);
    if (userToImpersonate && currentUser) {
      setOriginalUser(currentUser);
      setCurrentUser(userToImpersonate);
      localStorage.setItem(ORIGINAL_USER_STORAGE_KEY, JSON.stringify(currentUser));
      localStorage.setItem(CURRENT_USER_STORAGE_KEY, JSON.stringify(userToImpersonate));
    }
  }, [users, currentUser]);

  const stopImpersonating = useCallback(() => {
    if (originalUser) {
      setCurrentUser(originalUser);
      setOriginalUser(null);
      localStorage.setItem(CURRENT_USER_STORAGE_KEY, JSON.stringify(originalUser));
      localStorage.removeItem(ORIGINAL_USER_STORAGE_KEY);
    }
  }, [originalUser]);

  const updateUser = useCallback(async (updatedUser: User) => {
    const userRef = doc(db, "users", updatedUser.id);
    const { id, ...dataToUpdate } = updatedUser;
    try {
        await updateDoc(userRef, dataToUpdate as any);
        // Also update the current user in state if they are the one being edited
        if (currentUser?.id === id) {
            const newCurrentUser = { ...currentUser, ...dataToUpdate };
            setCurrentUser(newCurrentUser);
            localStorage.setItem(CURRENT_USER_STORAGE_KEY, JSON.stringify(newCurrentUser));
        }
    } catch (error) {
        console.error("Error updating user:", error);
    }
  }, [currentUser]);

  const value = useMemo(() => ({
    user: currentUser,
    originalUser,
    users,
    loading,
    impersonate,
    stopImpersonating,
    logout,
    updateUser,
  }), [currentUser, originalUser, users, loading, impersonate, stopImpersonating, logout, updateUser]);

  return <UserContext.Provider value={value}>{children}</UserContext.Provider>;
}

// 2. Auth Context: Manages permissions for the current user.
// This component will be remounted on user change, ensuring a clean state.
export interface AuthContextType {
  user: User | null;
  originalUser: User | null;
  users: User[];
  isAuthenticated: boolean;
  loading: boolean;
  permissions: PermissionSet;
  login: (username: string, password: string) => Promise<boolean>;
  logout: () => void;
  addUser: (user: Omit<User, 'id'>) => Promise<void>;
  updateUser: (user: User) => Promise<void>;
  deleteUser: (userId: string) => Promise<void>;
  changePassword: (username: string, oldPassword: string, newPassword: string) => Promise<boolean>;
  impersonate: (userId: string) => void;
  stopImpersonating: () => void;
}

export const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const userContext = useContext(UserContext);
  if (!userContext) throw new Error("AuthProvider must be used within a UserProvider");

  const { user, originalUser, users, loading: userLoading, impersonate, stopImpersonating, logout, updateUser: rawUpdateUser } = userContext;

  const [permissions, setPermissions] = useState<PermissionSet>(defaultGuestPermissions);
  const [loadingPermissions, setLoadingPermissions] = useState(true);
  const profilesContext = useContext(ProfilesContext);

  useEffect(() => {
    setLoadingPermissions(true);
    if (!user || !profilesContext || profilesContext.loading) {
      setPermissions(defaultGuestPermissions);
      setLoadingPermissions(false);
      return;
    }
    
    if (user.username === 'Tiago Brasil') {
      setPermissions(defaultAdminPermissions);
      setLoadingPermissions(false);
      return;
    }

    const userProfile = profilesContext.profiles.find(p => p.id === user.profileId);

    if (!userProfile?.permissions) {
      setPermissions(defaultGuestPermissions);
      setLoadingPermissions(false);
      return;
    }
    
    const finalPermissions = produce(defaultGuestPermissions, draftState => {
      const profilePermissions = userProfile.permissions;
      for (const moduleKey in profilePermissions) {
        const key = moduleKey as keyof PermissionSet;
        const modulePerms = profilePermissions[key];
        if (draftState[key] && typeof modulePerms === 'object' && modulePerms !== null) {
          for (const subKey in modulePerms) {
             if (subKey in draftState[key]) {
                (draftState[key] as any)[subKey] = (modulePerms as any)[subKey];
             }
          }
        }
      }
    });

    setPermissions(finalPermissions);
    setLoadingPermissions(false);
  }, [user, profilesContext, profilesContext.loading, profilesContext.profiles]);

  const login = useCallback(async (username: string, password: string): Promise<boolean> => {
    const q = query(collection(db, "users"), where("username", "==", username), where("password", "==", password));
    const querySnapshot = await getDocs(q);
    if (!querySnapshot.empty) {
        const userDoc = querySnapshot.docs[0];
        const data = userDoc.data();
        const userToLogin = {
            id: userDoc.id,
            ...data,
            assignedKioskIds: data.assignedKioskIds ?? [data.kioskId].filter(Boolean) ?? [],
        } as User;
        // This will now be handled by the parent UserProvider
        localStorage.setItem(CURRENT_USER_STORAGE_KEY, JSON.stringify(userToLogin));
        window.dispatchEvent(new Event("storage")); // Force update across tabs
        return true;
    }
    return false;
  }, []);

  const addUser = useCallback(async (userData: Omit<User, 'id'>) => {
    await addDoc(collection(db, "users"), userData as any);
  }, []);

  const updateUser = useCallback(async (updatedUser: User) => {
    await rawUpdateUser(updatedUser);
  }, [rawUpdateUser]);

  const deleteUser = useCallback(async (userId: string) => {
    await deleteDoc(doc(db, "users", userId));
  }, []);

  const changePassword = useCallback(async (username: string, oldPassword: string, newPassword: string): Promise<boolean> => {
    const q = query(collection(db, "users"), where("username", "==", username), where("password", "==", oldPassword));
    const querySnapshot = await getDocs(q);
    if (!querySnapshot.empty) {
        const userDoc = querySnapshot.docs[0];
        await updateDoc(doc(db, "users", userDoc.id), { password: newPassword });
        return true;
    }
    return false;
  }, []);

  const value: AuthContextType = useMemo(() => ({
    user,
    originalUser,
    users,
    isAuthenticated: !!user,
    loading: userLoading || loadingPermissions,
    permissions,
    login,
    logout,
    addUser,
    updateUser,
    deleteUser,
    changePassword,
    impersonate,
    stopImpersonating,
  }), [
    user, originalUser, users, userLoading, loadingPermissions, permissions,
    login, logout, addUser, updateUser, deleteUser, changePassword, impersonate, stopImpersonating
  ]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

    