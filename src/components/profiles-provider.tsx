
"use client";

import React, { createContext, useState, useEffect, useCallback, useMemo } from 'react';
import { type Profile, defaultAdminPermissions, defaultUserPermissions } from '@/types';
import { db, auth } from '@/lib/firebase';
import { onAuthStateChanged } from 'firebase/auth';
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

export function ProfilesProvider({ children }: { children: React.ReactNode }) {
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [adminProfileId, setAdminProfileId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsubAuth = onAuthStateChanged(auth, (user) => {
      if (!user) {
        setProfiles([]);
        setAdminProfileId(null);
        setLoading(false);
        return;
      }

      const q = query(collection(db, "profiles"));
      const unsubscribe = onSnapshot(q, async (querySnapshot) => {
        let profilesData = querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Profile));

        if (querySnapshot.empty && !localStorage.getItem('profiles_seeded')) {
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
          const templatePerms = defaultAdminPermissions;
          let needsUpdate = false;
          
          const deepUpdateRecursive = (target: Record<string, any>, template: Record<string, any>) => {
              if (!template || typeof template !== 'object' || Array.isArray(template)) return;
              if (!target || typeof target !== 'object' || Array.isArray(target)) return;
              
              Object.keys(template).forEach(key => {
                  const templateValue = template[key];
                  const targetValue = target[key];

                  if (targetValue === undefined) {
                      target[key] = JSON.parse(JSON.stringify(templateValue));
                      needsUpdate = true;
                  } else if (
                    templateValue && 
                    typeof templateValue === 'object' && 
                    !Array.isArray(templateValue) &&
                    targetValue &&
                    typeof targetValue === 'object' &&
                    !Array.isArray(targetValue)
                  ) {
                      deepUpdateRecursive(targetValue, templateValue);
                  }
              });
          };

          const newAdminPerms = JSON.parse(JSON.stringify(adminPerms));
          deepUpdateRecursive(newAdminPerms, templatePerms);

          if (needsUpdate) {
              const adminProfileRef = doc(db, "profiles", adminProfile.id);
              updateDoc(adminProfileRef, { permissions: newAdminPerms }).catch(console.error);
          }
        }
        
        setProfiles(profilesData);
        setLoading(false);
      }, (error) => {
          console.error("Error fetching profiles:", error);
          setLoading(false);
      });

      return () => unsubscribe();
    });

    return () => unsubAuth();
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
    if (profileToDelete?.isDefaultAdmin) return;
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

  return (
    <ProfilesContext.Provider value={value}>
      {children}
    </ProfilesContext.Provider>
  );
}
