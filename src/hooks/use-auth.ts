
"use client";

import { useContext } from 'react';
import { AuthContext, type AuthContextType } from '@/components/auth-provider';

export const useAuth = (): AuthContextType => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};

// useUser is deprecated, useAuth should be used instead
export const useUser = () => {
    const context = useContext(AuthContext);
    if (context === undefined) {
        throw new Error('useUser must be used within an AuthProvider');
    }
    return {
        user: context.user,
        users: context.users,
        logout: context.logout,
        updateUser: context.updateUser,
    }
}
