"use client";

import React, { createContext, useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { type User, type PermissionSet } from '@/types';

const USERS_STORAGE_KEY = 'smart-converter-users';
const CURRENT_USER_STORAGE_KEY = 'smart-converter-current-user';

const defaultPermissions: { [key in User['role']]: PermissionSet } = {
  admin: {
    canManageProducts: true,
    canManageLocations: true,
    canManageUsers: true,
    canManageKiosks: true,
  },
  user: {
    canManageProducts: false,
    canManageLocations: false,
    canManageUsers: false,
    canManageKiosks: false,
  },
};

export interface AuthContextType {
  user: User | null;
  users: User[];
  isAuthenticated: boolean;
  loading: boolean;
  permissions: PermissionSet;
  login: (username: string, password: string, kioskId: string) => boolean;
  logout: () => void;
  addUser: (user: Omit<User, 'id' | 'permissions'>) => void;
  updateUser: (user: User) => void;
  deleteUser: (userId: string) => void;
}

export const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [users, setUsers] = useState<User[]>([]);
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const router = useRouter();

  const loadUsersFromStorage = useCallback(() => {
    try {
      const storedUsers = window.localStorage.getItem(USERS_STORAGE_KEY);
      if (storedUsers) {
        return JSON.parse(storedUsers);
      } else {
        const masterUser: User = {
          id: 'master-user',
          username: 'master',
          password: 'master',
          role: 'admin',
          permissions: defaultPermissions.admin,
        };
        window.localStorage.setItem(USERS_STORAGE_KEY, JSON.stringify([masterUser]));
        return [masterUser];
      }
    } catch (error) {
      console.error("Failed to load users from storage", error);
      return [];
    }
  }, []);

  useEffect(() => {
    const allUsers = loadUsersFromStorage();
    setUsers(allUsers);
    
    try {
      const storedCurrentUser = window.localStorage.getItem(CURRENT_USER_STORAGE_KEY);
      if (storedCurrentUser) {
        const parsedUser = JSON.parse(storedCurrentUser);
        // re-validate user from the main user list
        const foundUser = allUsers.find((u: User) => u.id === parsedUser.id);
        setCurrentUser(foundUser || null);
      }
    } catch (error) {
        console.error("Failed to load current user", error);
        setCurrentUser(null);
    }

    setLoading(false);
  }, [loadUsersFromStorage]);

  const saveUsers = useCallback((newUsers: User[]) => {
    setUsers(newUsers);
    window.localStorage.setItem(USERS_STORAGE_KEY, JSON.stringify(newUsers));
  }, []);
  
  const login = (username: string, password: string, kioskId: string): boolean => {
    const userToLogin = users.find(u => u.username === username && u.password === password);
    if (userToLogin) {
      const loggedInUser = { ...userToLogin, kioskId: kioskId };
      setCurrentUser(loggedInUser);
      window.localStorage.setItem(CURRENT_USER_STORAGE_KEY, JSON.stringify(loggedInUser));
      return true;
    }
    return false;
  };

  const logout = () => {
    setCurrentUser(null);
    window.localStorage.removeItem(CURRENT_USER_STORAGE_KEY);
    router.push('/login');
  };

  const addUser = (userData: Omit<User, 'id'|'permissions'>) => {
    const newUser: User = {
      ...userData,
      id: new Date().toISOString(),
      permissions: defaultPermissions[userData.role] || defaultPermissions.user,
    };
    saveUsers([...users, newUser]);
  };

  const updateUser = (updatedUser: User) => {
    const updatedUsers = users.map(u => u.id === updatedUser.id ? updatedUser : u);
    saveUsers(updatedUsers);
  };

  const deleteUser = (userId: string) => {
    if (userId === 'master-user') return; // Cannot delete master user
    const filteredUsers = users.filter(u => u.id !== userId);
    saveUsers(filteredUsers);
  };
  
  const value: AuthContextType = {
    user: currentUser,
    users,
    isAuthenticated: !!currentUser,
    loading,
    permissions: currentUser?.permissions || defaultPermissions.user,
    login,
    logout,
    addUser,
    updateUser,
    deleteUser,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
