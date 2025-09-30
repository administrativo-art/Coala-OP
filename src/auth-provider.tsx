
"use client";

import React, { createContext, useState, useEffect, useCallback, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { type User, type PermissionSet, defaultGuestPermissions, defaultAdminPermissions } from '@/types';
import { db } from '@/lib/firebase';
import { collection, onSnapshot, addDoc, doc, updateDoc, deleteDoc, query, where, getDocs } from "firebase/firestore";
import { ProfilesContext } from '@/components/profiles-provider';

// Este provider está obsoleto e foi substituído por src/components/auth-provider.tsx
// Esta versão customizada não é mais utilizada.

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
  const profilesContext = React.useContext(ProfilesContext);

  const logout = useCallback(() => {}, [router]);
  
  const login = async (username: string, password: string): Promise<boolean> => {
    return false;
  };

  const addUser = async (userData: Omit<User, 'id'>) => {};
  const updateUser = async (updatedUser: User) => {};
  const deleteUser = async (userId: string) => {};
  
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
