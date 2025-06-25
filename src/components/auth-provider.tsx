"use client";

import React, { createContext, useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { type User, type PermissionSet, type UserRole } from '@/types';

const USERS_STORAGE_KEY = 'smart-converter-users';
const CURRENT_USER_STORAGE_KEY = 'smart-converter-current-user';

const defaultPermissions: { [key in UserRole]: PermissionSet } = {
  admin: {
    products: { add: true, edit: true, delete: true },
    lots: { add: true, edit: true, move: true, delete: true },
    locations: { add: true, delete: true },
    users: { add: true, edit: true, delete: true },
    kiosks: { add: true, delete: true },
  },
  user: {
    products: { add: false, edit: false, delete: false },
    lots: { add: false, edit: false, move: false, delete: false },
    locations: { add: false, delete: false },
    users: { add: false, edit: false, delete: false },
    kiosks: { add: false, delete: false },
  },
};

export interface AuthContextType {
  user: User | null;
  users: User[];
  isAuthenticated: boolean;
  loading: boolean;
  permissions: PermissionSet;
  login: (username: string, password: string) => boolean;
  logout: () => void;
  addUser: (user: Omit<User, 'id'>) => void;
  updateUser: (user: User) => void;
  deleteUser: (userId: string) => void;
}

export const AuthContext = createContext<AuthContextType | undefined>(undefined);

const getValidPermissions = (user: User | null): PermissionSet => {
    if (!user) return defaultPermissions.user;
    // Simple migration: if old format is detected, assign default for the role.
    if (!user.permissions || 'canManageProducts' in user.permissions) {
        return defaultPermissions[user.role] || defaultPermissions.user;
    }
    return user.permissions;
}

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
          kioskId: 'matriz',
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
      const storedCurrentUser = window.sessionStorage.getItem(CURRENT_USER_STORAGE_KEY);
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
  
  const login = (username: string, password: string): boolean => {
    const userToLogin = users.find(u => u.username === username && u.password === password);
    if (userToLogin) {
      setCurrentUser(userToLogin);
      window.sessionStorage.setItem(CURRENT_USER_STORAGE_KEY, JSON.stringify(userToLogin));
      return true;
    }
    return false;
  };

  const logout = () => {
    setCurrentUser(null);
    window.sessionStorage.removeItem(CURRENT_USER_STORAGE_KEY);
    router.push('/login');
  };

  const addUser = (userData: Omit<User, 'id'>) => {
    const newUser: User = {
      ...userData,
      id: new Date().toISOString(),
    };
    saveUsers([...users, newUser]);
  };

  const updateUser = (updatedUser: User) => {
    const updatedUsers = users.map(u => u.id === updatedUser.id ? updatedUser : u);
    saveUsers(updatedUsers);
    // If the updated user is the current user, update the current user state as well
    if (currentUser?.id === updatedUser.id) {
        setCurrentUser(updatedUser);
        window.sessionStorage.setItem(CURRENT_USER_STORAGE_KEY, JSON.stringify(updatedUser));
    }
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
    permissions: getValidPermissions(currentUser),
    login,
    logout,
    addUser,
    updateUser,
    deleteUser,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
