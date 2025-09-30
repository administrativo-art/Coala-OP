
"use client";

import React, { createContext, useState, useEffect, useCallback, useMemo } from 'react';
import { type Profile, defaultAdminPermissions, defaultUserPermissions, defaultGuestPermissions } from '@/types';
import { db } from '@/lib/firebase';
import { collection, onSnapshot, addDoc, updateDoc, deleteDoc, doc, writeBatch, query, getDocs } from 'firebase/firestore';

export interface ProfilesContextType {
  profiles: Profile[];
  loading: boolean;
  addProfile: (profile: Omit<Profile, 'id'>) => Promise<void>;
  updateProfile: (profile: Profile) => Promise<void>;
  deleteProfile: (profileId: string) => Promise<void>;
  adminProfileId: string | null;
}

export const ProfilesContext = createContext<ProfilesContextType | undefined>(undefined);

export function ProfilesProvider({ children }: { children: React.ReactNode }) {
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [adminProfileId, setAdminProfileId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const q = query(collection(db, "profiles"));
    const unsubscribe = onSnapshot(q, async (querySnapshot) => {
      
      let profilesData = querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Profile));

      if (querySnapshot.empty && !localStorage.getItem('profiles_seeded')) {
        console.log("No profiles found. Seeding default profiles...");
        const batch = writeBatch(db);
        
        const adminProfileRef = doc(db, "profiles", "admin");
        const adminData = { name: 'Administrador', permissions: defaultAdminPermissions, isDefaultAdmin: true };
        batch.set(adminProfileRef, adminData);
        
        const userProfileRef = doc(collection(db, "profiles"));
        const userData = { name: 'Usuário padrão', permissions: defaultUserPermissions };
        batch.set(userProfileRef, userData);
        
        try {
            await batch.commit();
            localStorage.setItem('profiles_seeded', 'true');
            // Manually set state since listener won't re-fire immediately
            setProfiles([{id: 'admin', ...adminData}, {id: userProfileRef.id, ...userData}]);
            setAdminProfileId('admin');
            setLoading(false);
        } catch (seedError) {
            console.error("Error seeding profiles:", seedError);
            setLoading(false);
        }
        return; 
      }

      const adminProfile = profilesData.find(p => p.isDefaultAdmin);
      if (adminProfile) {
        setAdminProfileId(adminProfile.id);
        const adminPerms = adminProfile.permissions || {};
        const defaultAdminPerms = defaultAdminPermissions;
        let needsUpdate = false;

        // Deep-check and merge permissions
        for (const key in defaultAdminPerms) {
          const typedKey = key as keyof typeof defaultAdminPerms;
          if (!adminPerms[typedKey]) {
            (adminPerms as any)[typedKey] = defaultAdminPerms[typedKey];
            needsUpdate = true;
          } else if (typeof (defaultAdminPerms as any)[typedKey] === 'object' && (defaultAdminPerms as any)[typedKey] !== null) {
            for (const subKey in (defaultAdminPerms as any)[typedKey]) {
              if ((adminPerms[typedKey] as any)?.[subKey as keyof typeof adminPerms[typeof typedKey]] === undefined) {
                 if (!(adminPerms[typedKey])) (adminPerms as any)[typedKey] = {};
                 (adminPerms[typedKey] as any)[subKey] = (defaultAdminPerms[typedKey] as any)[subKey];
                 needsUpdate = true;
              }
            }
          }
        }
        
        if (needsUpdate) {
            console.log("Admin profile is outdated. Auto-updating...");
            const adminProfileRef = doc(db, "profiles", adminProfile.id);
            const updatedAdminProfile = {...adminProfile, permissions: adminPerms};
            const index = profilesData.findIndex(p => p.id === adminProfile.id);
            if(index !== -1) {
              profilesData[index] = updatedAdminProfile;
            }
            updateDoc(adminProfileRef, { permissions: adminPerms }).catch(error => {
                console.error("Failed to auto-update admin profile:", error);
            });
        }
      }
      
      setProfiles(profilesData);
      setLoading(false);
    }, (error) => {
        console.error("Error fetching profiles from Firestore: ", error);
        setLoading(false);
    });

    return () => unsubscribe();
  }, []);

  const addProfile = useCallback(async (profile: Omit<Profile, 'id'>) => {
    try {
        await addDoc(collection(db, "profiles"), profile);
    } catch(error) {
        console.error("Error adding profile:", error);
    }
  }, []);

  const updateProfile = useCallback(async (updatedProfile: Profile) => {
    const profileRef = doc(db, "profiles", updatedProfile.id);
    const { id, ...dataToUpdate } = updatedProfile;
    try {
        await updateDoc(profileRef, dataToUpdate);
    } catch(error) {
        console.error("Error updating profile:", error);
    }
  }, []);

  const deleteProfile = useCallback(async (profileId: string) => {
    const profileToDelete = profiles.find(p => p.id === profileId);
    if (profileToDelete?.isDefaultAdmin) {
      console.error("Cannot delete the default admin profile.");
      return;
    }
    try {
        await deleteDoc(doc(db, "profiles", profileId));
    } catch(error) {
        console.error("Error deleting profile:", error);
    }
  }, [profiles]);

  const value: ProfilesContextType = useMemo(() => ({
    profiles,
    loading,
    addProfile,
    updateProfile,
    deleteProfile,
    adminProfileId
  }), [profiles, loading, addProfile, updateProfile, deleteProfile, adminProfileId]);

  return <ProfilesContext.Provider value={value}>{children}</ProfilesContext.Provider>;
}
