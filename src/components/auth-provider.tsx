
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
  addUser: (userData: Omit<User, 'id' | 'email'>, email: string, password: string) => Promise<string | null>;
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
    const unsubscribeAuth = onAuthStateChanged(auth, async (user) => {
      setFirebaseUser(user);
      if (user) {
        // Wait for profiles to be loaded before proceeding
        if (!profilesContext || profilesContext.loading) {
            return;
        }

        const userDocRef = doc(db, 'users', user.uid);
        let userDocSnap = await getDoc(userDocRef);

        if (!userDocSnap.exists()) {
          const usersQuery = query(collection(db, 'users'));
          const existingUsersSnap = await getDocs(usersQuery);

          if (existingUsersSnap.empty) {
            const adminProfile = profilesContext.profiles.find(p => p.isDefaultAdmin);
            if(adminProfile) {
                console.log("Creating first admin user document in Firestore...");
                const firstAdminData: Omit<User, 'id'> = {
                    username: user.displayName || user.email!.split('@')[0],
                    email: user.email!,
                    profileId: adminProfile.id,
                    assignedKioskIds: [],
                    turno: null,
                    folguista: false,
                    operacional: false,
                };
                await setDoc(userDocRef, firstAdminData);
                userDocSnap = await getDoc(userDocRef);
            }
          }
        }

        if (userDocSnap.exists()) {
          const userData = { id: userDocSnap.id, ...userDocSnap.data() } as User;
           if (!appUser || JSON.stringify(userData) !== JSON.stringify(appUser)) {
              setAppUser(userData);
           }
        } else {
           console.warn(`Firestore document not found for authenticated user ${user.uid}`);
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
  }, [profilesContext, appUser]);

  useEffect(() => {
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
    
    const userProfile = profilesContext.profiles.find(p => p.id === appUser.profileId);
    
    if (userProfile?.isDefaultAdmin) {
      setPermissions(defaultAdminPermissions);
      return;
    }

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

  const addUser = async (userData: Omit<User, 'id' | 'email'>, email: string, password: string):Promise<string | null> => {
    try {
      // This is a temporary solution for client-side user creation.
      // For production, this should be moved to a secure backend function.
      const userCredential = await createUserWithEmailAndPassword(auth, email, password);
      const user = userCredential.user;
      
      const userDocRef = doc(db, 'users', user.uid);
      await setDoc(userDocRef, { ...userData, email });
      
      return user.uid;
    } catch (error) {
      console.error("Error adding user:", error);
      return null;
    }
  };

  const updateUser = async (updatedUser: User) => {
    const userRef = doc(db, "users", updatedUser.id);
    const { id, email, ...dataToUpdate } = updatedUser as any;
    delete dataToUpdate.password;
    await updateDoc(userRef, dataToUpdate);
  };
  
  const deleteUser = async (userId: string) => {
    // Note: This only deletes the Firestore record.
    // Deleting from Firebase Auth requires admin privileges and a backend function.
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
