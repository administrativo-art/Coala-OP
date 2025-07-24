

"use client";

import React, { createContext, useState, useEffect, useCallback, useContext, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { type User, type PermissionSet, defaultGuestPermissions, defaultAdminPermissions } from '@/types';
import { db } from '@/lib/firebase';
import { collection, onSnapshot, addDoc, doc, updateDoc, deleteDoc, query, where, getDocs, runTransaction, serverTimestamp, setDoc } from "firebase/firestore";
import { ProfilesContext } from '@/components/profiles-provider';

const CURRENT_USER_STORAGE_KEY = 'smart-converter-current-user';
const ORIGINAL_USER_STORAGE_KEY = 'smart-converter-original-user'; // New key

export interface AuthContextType {
  user: User | null;
  originalUser: User | null; // To track impersonation
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
  const [users, setUsers] = useState<User[]>([]);
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [originalUser, setOriginalUser] = useState<User | null>(null); // New state for impersonation
  const [permissions, setPermissions] = useState<PermissionSet>(defaultGuestPermissions);
  const [authLoading, setAuthLoading] = useState(true);
  const router = useRouter();
  const profilesContext = useContext(ProfilesContext);

  useEffect(() => {
    try {
      const storedCurrentUser = window.localStorage.getItem(CURRENT_USER_STORAGE_KEY);
      const storedOriginalUser = window.localStorage.getItem(ORIGINAL_USER_STORAGE_KEY);
      if (storedCurrentUser) {
        setCurrentUser(JSON.parse(storedCurrentUser));
      }
      if (storedOriginalUser) {
        setOriginalUser(JSON.parse(storedOriginalUser));
      }
    } catch (error) {
        console.error("Failed to load user state from storage", error);
    }
    setAuthLoading(false); // Initial load done
  }, []);
  
    // Presence management
  useEffect(() => {
    if (!currentUser) return;

    const userPresenceRef = doc(db, 'userPresence', currentUser.id);

    // Set online status
    setDoc(userPresenceRef, {
        username: currentUser.username,
        status: 'online',
        last_seen: serverTimestamp(),
    });

    // Update last_seen timestamp periodically
    const interval = setInterval(() => {
        if (document.hasFocus()) {
            updateDoc(userPresenceRef, { last_seen: serverTimestamp() });
        }
    }, 60 * 1000); // every minute

    // Set offline on unload
    const handleBeforeUnload = () => {
      updateDoc(userPresenceRef, { status: 'offline' });
    };
    window.addEventListener('beforeunload', handleBeforeUnload);


    return () => {
        clearInterval(interval);
        window.removeEventListener('beforeunload', handleBeforeUnload);
        // Note: 'offline' on unload is best-effort and might not always run.
        // A Cloud Function with Realtime Database is the most reliable way.
        updateDoc(userPresenceRef, { status: 'offline' });
    };
  }, [currentUser]);

  const logout = useCallback(() => {
    if (currentUser) {
        const userPresenceRef = doc(db, 'userPresence', currentUser.id);
        updateDoc(userPresenceRef, { status: 'offline' });
    }
    setCurrentUser(null);
    setOriginalUser(null); // Clear impersonation state
    setPermissions(defaultGuestPermissions);
    window.localStorage.removeItem(CURRENT_USER_STORAGE_KEY);
    window.localStorage.removeItem(ORIGINAL_USER_STORAGE_KEY); // Clear impersonation from storage
    router.push('/login');
  }, [router, currentUser]);

  useEffect(() => {
    if (!profilesContext || profilesContext.loading) {
      setPermissions(defaultGuestPermissions);
      return;
    }

    if (currentUser) {
      if (currentUser.username === 'Tiago Brasil') {
        setPermissions(defaultAdminPermissions);
        return;
      }
      
      if (profilesContext.profiles.length > 0) {
        const userProfile = profilesContext.profiles.find(p => p.id === currentUser.profileId);
        
        const profilePermissions = userProfile ? userProfile.permissions : defaultGuestPermissions;
        
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
            consumptionAnalysis: { ...defaultGuestPermissions.consumptionAnalysis, ...profilePermissions?.consumptionAnalysis },
            returns: { ...defaultGuestPermissions.returns, ...profilePermissions?.returns },
            team: { ...defaultGuestPermissions.team, ...profilePermissions?.team },
            purchasing: { ...defaultGuestPermissions.purchasing, ...profilePermissions?.purchasing },
            stockCount: { ...defaultGuestPermissions.stockCount, ...profilePermissions?.stockCount },
            itemRequests: { ...defaultGuestPermissions.itemRequests, ...profilePermissions?.itemRequests },
            pricing: { ...defaultGuestPermissions.pricing, ...profilePermissions?.pricing },
            help: { ...defaultGuestPermissions.help, ...profilePermissions?.help },
            audit: { ...defaultGuestPermissions.audit, ...profilePermissions?.audit },
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
              username: 'Tiago Brasil',
              password: 'master',
              profileId: profilesContext.adminProfileId,
              assignedKioskIds: ['matriz'],
              turno: null,
              folguista: false,
              operacional: true,
              valeTransporte: 0,
              color: null,
            };
            try {
              await addDoc(collection(db, "users"), masterUser as any);
              localStorage.setItem('users_seeded', 'true');
            } catch (seedError) {
              console.error("Error seeding master user: ", seedError);
            }
            return;
        }

        const usersData = querySnapshot.docs.map(docData => {
            const data = docData.data();
            return { 
                id: docData.id, 
                ...data,
                assignedKioskIds: data.assignedKioskIds ?? [data.kioskId].filter(Boolean) ?? [],
                turno: data.turno ?? null,
                folguista: data.folguista ?? false,
                operacional: data.operacional ?? false,
                valeTransporte: data.valeTransporte ?? 0,
                color: data.color ?? null,
             } as User
        });

        setUsers(usersData);
        
        // Update current user if their data changed in Firestore
        if (currentUser) {
            const foundUser = usersData.find(u => u.id === currentUser.id);
            if (!foundUser) {
                logout();
            } else if (JSON.stringify(foundUser) !== JSON.stringify(currentUser)) {
                setCurrentUser(foundUser);
                window.localStorage.setItem(CURRENT_USER_STORAGE_KEY, JSON.stringify(foundUser));
            }
        }
        
        // Update original user if their data changed
        if (originalUser) {
            const foundOriginalUser = usersData.find(u => u.id === originalUser.id);
            if (!foundOriginalUser) {
                logout(); // If the original user was deleted, log out entirely.
            } else if (JSON.stringify(foundOriginalUser) !== JSON.stringify(originalUser)) {
                setOriginalUser(foundOriginalUser);
                window.localStorage.setItem(ORIGINAL_USER_STORAGE_KEY, JSON.stringify(foundOriginalUser));
            }
        }
        
    }, (error) => {
        console.error("Error fetching users from Firestore: ", error);
    });

    return () => unsubscribe();
  }, [currentUser, originalUser, logout, profilesContext, profilesContext?.loading, profilesContext?.adminProfileId]);
  
  const login = useCallback(async (username: string, password: string): Promise<boolean> => {
    const q = query(collection(db, "users"), where("username", "==", username), where("password", "==", password));
    try {
        const querySnapshot = await getDocs(q);
        if (!querySnapshot.empty) {
            const userDoc = querySnapshot.docs[0];
            const data = userDoc.data();
            const userToLogin = { 
                id: userDoc.id, 
                ...data,
                assignedKioskIds: data.assignedKioskIds ?? [data.kioskId].filter(Boolean) ?? [],
                turno: data.turno ?? null,
                folguista: data.folguista ?? false,
                operacional: data.operacional ?? false,
                valeTransporte: data.valeTransporte ?? 0,
                color: data.color ?? null,
             } as User;
            setCurrentUser(userToLogin);
            window.localStorage.setItem(CURRENT_USER_STORAGE_KEY, JSON.stringify(userToLogin));
            return true;
        }
        return false;
    } catch (error) {
        console.error("Login error:", error);
        return false;
    }
  }, []);

  const addUser = useCallback(async (userData: Omit<User, 'id'>) => {
    try {
        await addDoc(collection(db, "users"), userData as any);
    } catch(error) {
        console.error("Error adding user:", error);
    }
  }, []);

  const updateUser = useCallback(async (updatedUser: User) => {
    const userRef = doc(db, "users", updatedUser.id);
    const { id, ...dataToUpdate } = updatedUser;
    try {
        await updateDoc(userRef, dataToUpdate as any);
    } catch (error) {
        console.error("Error updating user:", error);
    }
  }, []);

  const deleteUser = useCallback(async (userId: string) => {
    try {
        await deleteDoc(doc(db, "users", userId));
    } catch (error) {
        console.error("Error deleting user:", error);
        throw error;
    }
  }, []);

  const changePassword = useCallback(async (username: string, oldPassword: string, newPassword: string): Promise<boolean> => {
    const q = query(collection(db, "users"), where("username", "==", username), where("password", "==", oldPassword));
    try {
        const querySnapshot = await getDocs(q);
        if (!querySnapshot.empty) {
            const userDoc = querySnapshot.docs[0];
            const userRef = doc(db, "users", userDoc.id);
            await updateDoc(userRef, { password: newPassword });
            return true;
        }
        return false;
    } catch (error) {
        console.error("Change password error:", error);
        return false;
    }
  }, []);
  
  const impersonate = useCallback((userId: string) => {
    if (!permissions.users.impersonate) {
        console.error("User does not have permission to impersonate.");
        return;
    }
    const userToImpersonate = users.find(u => u.id === userId);
    if (userToImpersonate) {
        setOriginalUser(currentUser);
        setCurrentUser(userToImpersonate);
        window.localStorage.setItem(ORIGINAL_USER_STORAGE_KEY, JSON.stringify(currentUser));
        window.localStorage.setItem(CURRENT_USER_STORAGE_KEY, JSON.stringify(userToImpersonate));
    }
  }, [users, currentUser, permissions]);

  const stopImpersonating = useCallback(() => {
    if (originalUser) {
        setCurrentUser(originalUser);
        setOriginalUser(null);
        window.localStorage.setItem(CURRENT_USER_STORAGE_KEY, JSON.stringify(originalUser));
        window.localStorage.removeItem(ORIGINAL_USER_STORAGE_KEY);
    }
  }, [originalUser]);

  const value: AuthContextType = useMemo(() => ({
    user: currentUser,
    originalUser,
    users,
    isAuthenticated: !!currentUser,
    loading: authLoading || (!!currentUser && (!profilesContext || profilesContext.loading)),
    permissions,
    login,
    logout,
    addUser,
    updateUser,
    deleteUser,
    changePassword,
    impersonate,
    stopImpersonating,
  }), [currentUser, originalUser, users, authLoading, profilesContext, permissions, login, logout, addUser, updateUser, deleteUser, changePassword, impersonate, stopImpersonating]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
