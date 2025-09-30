
"use client";

import React, { createContext, useState, useEffect, useCallback, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { type User, type PermissionSet, defaultGuestPermissions, defaultAdminPermissions } from '@/types';
import { db, auth } from '@/lib/firebase';
import { collection, onSnapshot, addDoc, doc, updateDoc, deleteDoc, query, where, getDocs, getDoc, setDoc } from "firebase/firestore";
import { onAuthStateChanged, signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut, sendPasswordResetEmail, type User as FirebaseUser } from "firebase/auth";
import { useProfiles } from '@/hooks/use-profiles';
import { produce } from 'immer';
import { ProfilesContext } from './profiles-provider';

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
  addUser: (userData: Omit<User, 'id'>, password: string) => Promise<string | null>;
  updateUser: (user: User) => Promise<void>;
  deleteUser: (userId: string) => Promise<void>;
  resetPassword: (email: string) => Promise<boolean>;
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
  const profilesContext = React.useContext(ProfilesContext);
  const router = useRouter();

  useEffect(() => {
    // Listener for auth state
    const unsubscribeAuth = onAuthStateChanged(auth, async (user) => {
      setFirebaseUser(user);
      if (user) {
        // User is signed in, get their app-specific data
        const userDocRef = doc(db, 'users', user.uid);
        const userDocSnap = await getDoc(userDocRef);
        if (userDocSnap.exists()) {
          setAppUser({ id: userDocSnap.id, ...userDocSnap.data() } as User);
        } else {
          setAppUser(null);
        }
      } else {
        setAppUser(null);
      }
      setLoading(false);
    });

    // Load impersonation state from localStorage
    try {
      const storedOriginalUser = localStorage.getItem(ORIGINAL_USER_STORAGE_KEY);
      if (storedOriginalUser) setOriginalUser(JSON.parse(storedOriginalUser));
    } catch (error) {
        console.error("Failed to load original user state from storage", error);
    }

    return () => {
      unsubscribeAuth();
    };
  }, []);

  useEffect(() => {
    // Listener for all users in the collection
    const q = query(collection(db, "users"));
    const unsubscribeUsers = onSnapshot(q, (snapshot) => {
        const usersData = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as User));
        setUsers(usersData);
    });
    return () => unsubscribeUsers();
  }, []);

  useEffect(() => {
    if (loading || !appUser || !profilesContext || profilesContext.loading) {
      setPermissions(defaultGuestPermissions);
      return;
    }
    
    if (appUser.username === 'Tiago Brasil') {
      setPermissions(defaultAdminPermissions);
      return;
    }

    const userProfile = profilesContext.profiles.find(p => p.id === appUser.profileId);
    if (!userProfile?.permissions) {
      setPermissions(defaultGuestPermissions);
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
  }, [appUser, profilesContext, loading]);

  const login = async (email: string, password: string): Promise<boolean> => {
    try {
      await signInWithEmailAndPassword(auth, email, password);
      return true;
    } catch (error) {
      console.error("Login error:", error);
      return false;
    }
  };

  const logout = async () => {
    stopImpersonating();
    await signOut(auth);
    router.push('/login');
  };

  const addUser = async (userData: Omit<User, 'id'>, password: string):Promise<string | null> => {
    try {
      // Create user in Firebase Auth
      const userCredential = await createUserWithEmailAndPassword(auth, userData.email, password);
      const user = userCredential.user;
      
      // Create user document in Firestore with the UID from Auth
      const userDocRef = doc(db, 'users', user.uid);
      const { password: _, ...userDataWithoutPassword } = userData as any;
      await setDoc(userDocRef, userDataWithoutPassword);
      
      return user.uid;
    } catch (error) {
      console.error("Error adding user:", error);
      return null;
    }
  };

  const updateUser = async (updatedUser: User) => {
    const userRef = doc(db, "users", updatedUser.id);
    const { id, ...dataToUpdate } = updatedUser;
    // Email and password are not updatable through this function
    delete (dataToUpdate as any).email;
    delete (dataToUpdate as any).password;
    await updateDoc(userRef, dataToUpdate as any);
  };
  
  const deleteUser = async (userId: string) => {
    await deleteDoc(doc(db, "users", userId));
  };
  
  const resetPassword = async (email: string): Promise<boolean> => {
    try {
      await sendPasswordResetEmail(auth, email);
      return true;
    } catch (error) {
      console.error("Password reset error:", error);
      return false;
    }
  };

  const impersonate = (userId: string) => {
    const userToImpersonate = users.find(u => u.id === userId);
    if (userToImpersonate && appUser && !originalUser) {
      setOriginalUser(appUser);
      setAppUser(userToImpersonate);
      localStorage.setItem(ORIGINAL_USER_STORAGE_KEY, JSON.stringify(appUser));
    }
  };

  const stopImpersonating = () => {
    if (originalUser) {
      setAppUser(originalUser);
      setOriginalUser(null);
      localStorage.removeItem(ORIGINAL_USER_STORAGE_KEY);
    }
  };

  const value = useMemo(() => ({
    user: appUser,
    firebaseUser,
    originalUser,
    users,
    isAuthenticated: !!appUser,
    loading: loading || (profilesContext ? profilesContext.loading : true),
    permissions,
    login,
    logout,
    addUser,
    updateUser,
    deleteUser,
    resetPassword,
    impersonate,
    stopImpersonating,
  }), [
    appUser, firebaseUser, originalUser, users, loading, profilesContext, permissions,
  ]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
