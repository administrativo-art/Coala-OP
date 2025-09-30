
"use client";

// This component is no longer necessary as the logic has been consolidated
// into the main AuthProvider. It can be removed.
import React, { useContext } from 'react';
import { AuthProvider } from './auth-provider';
import { ProfilesProvider } from './profiles-provider';


export function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <ProfilesProvider>
      <AuthProvider>
        {children}
      </AuthProvider>
    </ProfilesProvider>
  );
}
