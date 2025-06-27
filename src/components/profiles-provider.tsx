
"use client";

import React, { createContext, useState, useEffect, useCallback } from 'react';
import { type Profile, type PermissionSet } from '@/types';
import { db } from '@/lib/firebase';
import { collection, onSnapshot, addDoc, updateDoc, deleteDoc, doc, writeBatch, query } from 'firebase/firestore';

export interface ProfilesContextType {
  profiles: Profile[];
  loading: boolean;
  addProfile: (profile: Omit<Profile, 'id'>) => Promise<void>;
  updateProfile: (profile: Profile) => Promise<void>;
  deleteProfile: (profileId: string) => Promise<void>;
  adminProfileId: string | null;
}

export const ProfilesContext = createContext<ProfilesContextType | undefined>(undefined);

const defaultAdminPermissions: PermissionSet = {
    products: { add: true, edit: true, delete: true },
    lots: { add: true, edit: true, move: true, delete: true },
    users: { add: true, edit: true, delete: true },
    kiosks: { add: true, delete: true },
    predefinedLists: { add: true, edit: true, delete: true },
};

const defaultUserPermissions: PermissionSet = {
    products: { add: false, edit: false, delete: false },
    lots: { add: true, edit: true, move: true, delete: false },
    users: { add: false, edit: false, delete: false },
    kiosks: { add: false, delete: false },
    predefinedLists: { add: true, edit: true, delete: false },
};

export function ProfilesProvider({ children }: { children: React.ReactNode }) {
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [adminProfileId, setAdminProfileId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const q = query(collection(db, "profiles"));
    const unsubscribe = onSnapshot(q, async (querySnapshot) => {
      if (querySnapshot.empty && !localStorage.getItem('profiles_seeded')) {
        console.log("No profiles found. Seeding default profiles...");
        const batch = writeBatch(db);
        
        const adminProfileRef = doc(db, "profiles", "admin");
        batch.set(adminProfileRef, { name: 'Administrador', permissions: defaultAdminPermissions, isDefaultAdmin: true });
        
        const userProfileRef = doc(collection(db, "profiles"));
        batch.set(userProfileRef, { name: 'Usuário Padrão', permissions: defaultUserPermissions });
        
        try {
            await batch.commit();
            localStorage.setItem('profiles_seeded', 'true');
        } catch (seedError) {
            console.error("Error seeding profiles:", seedError);
        }
        return; 
      }

      let profilesData = querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Profile));
      
      const adminProfile = profilesData.find(p => p.isDefaultAdmin === true);
      if (adminProfile) {
        const currentPerms = adminProfile.permissions || {};
        
        const permissionsNeedUpdate = (current: Partial<PermissionSet>, defaults: PermissionSet): boolean => {
            for (const key of Object.keys(defaults) as Array<keyof PermissionSet>) {
                if (!current[key] || typeof current[key] !== 'object') return true;
                for (const subKey of Object.keys(defaults[key])) {
                    if (current[key]![subKey as keyof typeof current[key]] === undefined) {
                        return true;
                    }
                }
            }
            return false;
        };
        
        if (permissionsNeedUpdate(currentPerms, defaultAdminPermissions)) {
            console.warn("Admin profile permissions are outdated. Updating automatically.");
            
            const correctedProfiles = profilesData.map(p => 
                p.id === adminProfile.id 
                ? { ...p, permissions: defaultAdminPermissions } 
                : p
            );
            // This is the key fix: update the local state immediately to prevent UI race conditions.
            setProfiles(correctedProfiles);
            profilesData = correctedProfiles; // Use the corrected data for subsequent logic in this run

            const adminProfileRef = doc(db, "profiles", adminProfile.id);
            try {
                await updateDoc(adminProfileRef, { permissions: defaultAdminPermissions });
            } catch (error) {
                console.error("Failed to auto-update admin profile permissions:", error);
            }
        }
      }

      setProfiles(profilesData);

      const adminProfileForId = profilesData.find(p => p.isDefaultAdmin);
      setAdminProfileId(adminProfileForId ? adminProfileForId.id : 'admin');

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

  const value: ProfilesContextType = {
    profiles,
    loading,
    addProfile,
    updateProfile,
    deleteProfile,
    adminProfileId
  };

  return <ProfilesContext.Provider value={value}>{children}</ProfilesContext.Provider>;
}
