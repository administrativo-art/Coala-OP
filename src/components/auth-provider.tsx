
"use client";

import React, { createContext, useState, useEffect, useCallback, useContext } from 'react';
import { useRouter } from 'next/navigation';
import { type User, type PermissionSet, defaultGuestPermissions, defaultAdminPermissions } from '@/types';
import { db } from '@/lib/firebase';
import { collection, onSnapshot, addDoc, doc, updateDoc, deleteDoc, query, where, getDocs } from "firebase/firestore";
import { ProfilesContext } from '@/components/profiles-provider';

const CURRENT_USER_STORAGE_KEY = 'smart-converter-current-user';

export interface AuthContextType {
  user: User | null;
  users: User[];
  isAuthenticated: boolean;
  loading: boolean;
  permissions: PermissionSet;
  login: (username: string, password: string) => Promise<boolean>;
  logout: () => void;
  addUser: (user: Omit<User, 'id'>) => Promise<void>;
  updateUser: (user: User) => Promise<void>;
  deleteUser: (userId: string) => Promise<void>;
}

export const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [users, setUsers] = useState<User[]>([]);
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [permissions, setPermissions] = useState<PermissionSet>(defaultGuestPermissions);
  const [authLoading, setAuthLoading] = useState(true);
  const router = useRouter();
  const profilesContext = useContext(ProfilesContext);

  useEffect(() => {
    try {
      const storedCurrentUser = window.localStorage.getItem(CURRENT_USER_STORAGE_KEY);
      if (storedCurrentUser) {
        setCurrentUser(JSON.parse(storedCurrentUser));
      }
    } catch (error) {
        console.error("Failed to load current user", error);
    }
    // We set authLoading to false later, after checking user validity.
  }, []);

  const logout = useCallback(() => {
    setCurrentUser(null);
    setPermissions(defaultGuestPermissions);
    window.localStorage.removeItem(CURRENT_USER_STORAGE_KEY);
    router.push('/login');
  }, [router]);

  useEffect(() => {
    if (!profilesContext || profilesContext.loading) {
      setPermissions(defaultGuestPermissions);
      return;
    }

    if (currentUser) {
      // FAILSAFE: If the user is 'master', always grant full admin permissions,
      // bypassing the profile system for this specific user to ensure functionality.
      if (currentUser.username === 'master') {
        setPermissions(defaultAdminPermissions);
        return;
      }
      
      if (profilesContext.profiles.length > 0) {
        const userProfile = profilesContext.profiles.find(p => p.id === currentUser.profileId);
        
        const profilePermissions = userProfile ? userProfile.permissions : defaultGuestPermissions;
        
        // Deep merge to ensure all permission keys exist, preventing crashes.
        const finalPermissions: PermissionSet = {
            ...defaultGuestPermissions,
            ...profilePermissions,
            products: { ...defaultGuestPermissions.products, ...profilePermissions?.products },
            lots: { ...defaultGuestPermissions.lots, ...profilePermissions?.lots },
            users: { ...defaultGuestPermissions.users, ...profilePermissions?.users },
            kiosks: { ...defaultGuestPermissions.kiosks, ...profilePermissions?.kiosks },
            predefinedLists: { ...defaultGuestPermissions.predefinedLists, ...profilePermissions?.predefinedLists },
            forms: { ...defaultGuestPermissions.forms, ...profilePermissions?.forms },
            stockAnalysis: { ...defaultGuestPermissions.stockAnalysis, ...profilePermissions?.stockAnalysis },
        };

        setPermissions(userProfile ? finalPermissions : defaultGuestPermissions);
      } else {
        setPermissions(defaultGuestPermissions);
      }
    } else {
      setPermissions(defaultGuestPermissions);
    }
  }, [currentUser, profilesContext, profilesContext?.loading, profilesContext?.profiles]);


  useEffect(() => {
    if (!profilesContext || profilesContext.loading) return; 

    const q = query(collection(db, "users"));
    const unsubscribe = onSnapshot(q, async (querySnapshot) => {
        if (querySnapshot.empty && !localStorage.getItem('users_seeded') && profilesContext.adminProfileId) {
            console.log("No users found. Seeding master user...");
            const masterUser: Omit<User, 'id'> = {
              username: 'master',
              password: 'master',
              profileId: profilesContext.adminProfileId,
              kioskId: 'matriz',
            };
            try {
              await addDoc(collection(db, "users"), masterUser as any);
              localStorage.setItem('users_seeded', 'true');
            } catch (seedError) {
              console.error("Error seeding master user: ", seedError);
            }
            return;
        }

        const usersData = querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as User));
        setUsers(usersData);
        
        // Final validation of current user
        if (currentUser) {
            const foundUser = usersData.find(u => u.id === currentUser.id);
            if (!foundUser) {
                // The stored user no longer exists in the DB
                logout();
            } else if (JSON.stringify(foundUser) !== JSON.stringify(currentUser)) {
                // User data has changed (e.g., profile), update local state
                setCurrentUser(foundUser);
                window.localStorage.setItem(CURRENT_USER_STORAGE_KEY, JSON.stringify(foundUser));
            }
        }
        
        setAuthLoading(false);
    }, (error) => {
        console.error("Error fetching users from Firestore: ", error);
        setAuthLoading(false);
    });

    return () => unsubscribe();
  }, [currentUser, logout, profilesContext, profilesContext?.loading, profilesContext?.adminProfileId]);
  
  const login = async (username: string, password: string): Promise<boolean> => {
    const q = query(collection(db, "users"), where("username", "==", username), where("password", "==", password));
    try {
        const querySnapshot = await getDocs(q);
        if (!querySnapshot.empty) {
            const userDoc = querySnapshot.docs[0];
            const userToLogin = { id: userDoc.id, ...userDoc.data() } as User;
            setCurrentUser(userToLogin);
            window.localStorage.setItem(CURRENT_USER_STORAGE_KEY, JSON.stringify(userToLogin));
            return true;
        }
        return false;
    } catch (error) {
        console.error("Login error:", error);
        return false;
    }
  };

  const addUser = async (userData: Omit<User, 'id'>) => {
    try {
        await addDoc(collection(db, "users"), userData as any);
    } catch(error) {
        console.error("Error adding user:", error);
    }
  };

  const updateUser = async (updatedUser: User) => {
    const userRef = doc(db, "users", updatedUser.id);
    const { id, ...dataToUpdate } = updatedUser;
    try {
        await updateDoc(userRef, dataToUpdate);
    } catch (error) {
        console.error("Error updating user:", error);
    }
  };

  const deleteUser = async (userId: string) => {
    try {
        await deleteDoc(doc(db, "users", userId));
    } catch (error) {
        console.error("Error deleting user:", error);
    }
  };
  
  const value: AuthContextType = {
    user: currentUser,
    users,
    isAuthenticated: !!currentUser,
    loading: authLoading || (!!currentUser && (!profilesContext || profilesContext.loading)),
    permissions,
    login,
    logout,
    addUser,
    updateUser,
    deleteUser,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
