
"use client";

import React, { createContext, useState, useEffect, useCallback, useMemo } from 'react';
import { type PurchaseSession, type PurchaseItem } from '@/types';
import { db } from '@/lib/firebase';
import { collection, onSnapshot, addDoc, updateDoc, doc, query, where, getDocs, serverTimestamp, writeBatch } from 'firebase/firestore';
import { useAuth } from '@/hooks/use-auth';

export interface PurchaseContextType {
  sessions: PurchaseSession[];
  items: PurchaseItem[];
  loading: boolean;
  startOrGetOpenSession: (baseProductId: string, userId: string) => Promise<string | null>;
  savePrice: (sessionId: string, productId: string, price: number) => Promise<void>;
  closeSession: (sessionId: string) => Promise<void>;
  confirmPurchase: (itemId: string, comment?: string) => Promise<void>;
}

export const PurchaseContext = createContext<PurchaseContextType | undefined>(undefined);

export function PurchaseProvider({ children }: { children: React.ReactNode }) {
    const { user } = useAuth();
    const [sessions, setSessions] = useState<PurchaseSession[]>([]);
    const [items, setItems] = useState<PurchaseItem[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const qSessions = query(collection(db, "purchaseSessions"));
        const unsubscribeSessions = onSnapshot(qSessions, (snapshot) => {
            const data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as PurchaseSession));
            setSessions(data);
            setLoading(false);
        }, (error) => {
            console.error("Error fetching purchase sessions:", error);
            setLoading(false);
        });

        const qItems = query(collection(db, "purchaseItems"));
        const unsubscribeItems = onSnapshot(qItems, (snapshot) => {
            const data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as PurchaseItem));
            setItems(data);
        }, (error) => {
            console.error("Error fetching purchase items:", error);
        });

        return () => {
            unsubscribeSessions();
            unsubscribeItems();
        };
    }, []);

    const startOrGetOpenSession = useCallback(async (baseProductId: string, userId: string): Promise<string | null> => {
        const q = query(
            collection(db, "purchaseSessions"),
            where("baseProductId", "==", baseProductId),
            where("status", "==", "open")
        );

        try {
            const querySnapshot = await getDocs(q);
            if (!querySnapshot.empty) {
                return querySnapshot.docs[0].id;
            } else {
                const newSession: Omit<PurchaseSession, 'id'> = {
                    baseProductId,
                    userId,
                    status: 'open',
                    createdAt: new Date().toISOString(),
                };
                const docRef = await addDoc(collection(db, "purchaseSessions"), newSession);
                return docRef.id;
            }
        } catch (error) {
            console.error("Error starting or getting session:", error);
            return null;
        }
    }, []);

    const savePrice = useCallback(async (sessionId: string, productId: string, price: number) => {
        const q = query(
            collection(db, "purchaseItems"),
            where("sessionId", "==", sessionId),
            where("productId", "==", productId)
        );
        
        try {
            const querySnapshot = await getDocs(q);
            if (!querySnapshot.empty) {
                const itemDoc = querySnapshot.docs[0];
                if (!itemDoc.data().isConfirmed) {
                    await updateDoc(doc(db, "purchaseItems", itemDoc.id), { price });
                }
            } else {
                const newItem: Omit<PurchaseItem, 'id'> = {
                    sessionId,
                    productId,
                    price,
                    isConfirmed: false,
                };
                await addDoc(collection(db, "purchaseItems"), newItem);
            }
        } catch (error) {
            console.error("Error saving price:", error);
        }
    }, []);

    const closeSession = useCallback(async (sessionId: string) => {
        try {
            await updateDoc(doc(db, "purchaseSessions", sessionId), {
                status: 'closed',
                closedAt: new Date().toISOString()
            });
        } catch (error) {
            console.error("Error closing session:", error);
        }
    }, []);

    const confirmPurchase = useCallback(async (itemId: string, comment?: string) => {
        if (!user) return;
        try {
            await updateDoc(doc(db, "purchaseItems", itemId), {
                isConfirmed: true,
                confirmedBy: user.id,
                confirmedAt: new Date().toISOString(),
                confirmationComment: comment || "",
            });
        } catch (error) {
            console.error("Error confirming purchase:", error);
        }
    }, [user]);

    const value: PurchaseContextType = useMemo(() => ({
        sessions,
        items,
        loading,
        startOrGetOpenSession,
        savePrice,
        closeSession,
        confirmPurchase,
    }), [sessions, items, loading, startOrGetOpenSession, savePrice, closeSession, confirmPurchase]);

    return <PurchaseContext.Provider value={value}>{children}</PurchaseContext.Provider>;
}
