"use client";

import React, { createContext, useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { type User, type PermissionSet, type UserRole } from '@/types';
import { db } from '@/lib/firebase';
import { collection, onSnapshot, addDoc, doc, updateDoc, deleteDoc, query, where, getDocs } from "firebase/firestore";

const CURRENT_USER_STORAGE_KEY = 'smart-converter-current-user';

const defaultPermissions: { [key in UserRole]: PermissionSet } = {
  admin: {
    products: { add: true, edit: true, delete: true },
    lots: { add: true, edit: true, move: true, delete: true },
    users: { add: true, edit: true, delete: true },
    kiosks: { add: true, delete: true },
    predefinedLists: { add: true, edit: true, delete: true },
  },
  user: {
    products: { add: false, edit: false, delete: false },
    lots: { add: false, edit: false, move: false, delete: false },
    users: { add: false, edit: false, delete: false },
    kiosks: { add: false, delete: false },
    predefinedLists: { add: false, edit: false, delete: false },
  },
};

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

const getValidPermissions = (user: User | null): PermissionSet => {
    if (!user) return defaultPermissions.user;
    
    const roleDefault = defaultPermissions[user.role] || defaultPermissions.user;

    if (!user.permissions || 'canManageProducts' in user.permissions) {
        return roleDefault;
    }
    
    const completePermissions = { ...user.permissions };
    
    if (!completePermissions.predefinedLists) {
        completePermissions.predefinedLists = roleDefault.predefinedLists;
    }

    return completePermissions;
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [users, setUsers] = useState<User[]>([]);
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const router = useRouter();

  // Load current user from sessionStorage on initial load
  useEffect(() => {
    try {
      const storedCurrentUser = window.sessionStorage.getItem(CURRENT_USER_STORAGE_KEY);
      if (storedCurrentUser) {
        setCurrentUser(JSON.parse(storedCurrentUser));
      }
    } catch (error) {
        console.error("Failed to load current user", error);
    }
    // We set loading to false in the onSnapshot listener
  }, []);

  const logout = useCallback(() => {
    setCurrentUser(null);
    window.sessionStorage.removeItem(CURRENT_USER_STORAGE_KEY);
    router.push('/login');
  }, [router]);

  // Listen for real-time updates to users collection
  useEffect(() => {
    const q = query(collection(db, "users"));
    const unsubscribe = onSnapshot(q, async (querySnapshot) => {
        if (querySnapshot.empty && !localStorage.getItem('users_seeded')) {
            console.log("No users found. Seeding master user...");
            const masterUser: Omit<User, 'id'> = {
              username: 'master',
              password: 'master',
              role: 'admin',
              permissions: defaultPermissions.admin,
              kioskId: 'matriz',
            };
            try {
              await addDoc(collection(db, "users"), masterUser as any);
              localStorage.setItem('users_seeded', 'true');
            } catch (seedError) {
              console.error("Error seeding master user: ", seedError);
            }
            // The listener will re-run with the newly added user.
            return;
        }

        const usersData = querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as User));
        setUsers(usersData);
        
        if (currentUser) {
            const foundUser = usersData.find(u => u.id === currentUser.id);
            if (!foundUser) {
                logout(); // User was deleted elsewhere
            } else if (JSON.stringify(foundUser) !== JSON.stringify(currentUser)) {
                setCurrentUser(foundUser);
                sessionStorage.setItem(CURRENT_USER_STORAGE_KEY, JSON.stringify(foundUser));
            }
        }
        
        setLoading(false);
    }, (error) => {
        console.error("Error fetching users from Firestore: ", error);
        setLoading(false);
    });

    return () => unsubscribe();
  }, [currentUser, logout]);
  
  const login = async (username: string, password: string): Promise<boolean> => {
    const q = query(collection(db, "users"), where("username", "==", username), where("password", "==", password));
    try {
        const querySnapshot = await getDocs(q);
        if (!querySnapshot.empty) {
            const userDoc = querySnapshot.docs[0];
            const userToLogin = { id: userDoc.id, ...userDoc.data() } as User;
            setCurrentUser(userToLogin);
            window.sessionStorage.setItem(CURRENT_USER_STORAGE_KEY, JSON.stringify(userToLogin));
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
    if (userId === 'master-user') return; // Should be based on ID, not username. Assuming a fixed ID for master user is not ideal.
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
    loading,
    permissions: getValidPermissions(currentUser),
    login,
    logout,
    addUser,
    updateUser,
    deleteUser,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
