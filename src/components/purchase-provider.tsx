
"use client";

import React, { createContext, useState, useEffect, useCallback, useMemo, useContext } from 'react';
import { type PurchaseSession, type PurchaseItem, type BaseProduct } from '@/types';
import { db } from '@/lib/firebase';
import { collection, onSnapshot, addDoc, updateDoc, doc, query, where, getDocs, writeBatch } from 'firebase/firestore';
import { useAuth } from '@/hooks/use-auth';
import { useProducts } from '@/hooks/use-products';
import { BaseProductsContext } from './base-products-provider';

export interface PurchaseContextType {
  sessions: PurchaseSession[];
  items: PurchaseItem[];
  loading: boolean;
  startNewSession: (data: { baseProductIds: string[], entityId: string, description: string }) => Promise<string | null>;
  savePrice: (sessionId: string, productId: string, price: number) => Promise<void>;
  closeSession: (sessionId: string) => Promise<void>;
  deleteSession: (sessionId: string) => Promise<void>;
  confirmPurchase: (itemId: string, baseProductId: string, pricePerUnit: number) => Promise<void>;
}

export const PurchaseContext = createContext<PurchaseContextType | undefined>(undefined);

export function PurchaseProvider({ children }: { children: React.ReactNode }) {
    const { user } = useAuth();
    const baseProductsContext = useContext(BaseProductsContext);
    if (!baseProductsContext) {
        throw new Error("PurchaseProvider must be used within a BaseProductsProvider");
    }
    const { baseProducts, updateBaseProduct } = baseProductsContext;

    const [sessions, setSessions] = useState<PurchaseSession[]>([]);
    const [items, setItems] = useState<PurchaseItem[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const qSessions = query(collection(db, "purchaseSessions"));
        const unsubscribeSessions = onSnapshot(qSessions, (snapshot) => {
            const data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as PurchaseSession));
            setSessions(data.sort((a,b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()));
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

    const startNewSession = useCallback(async (data: { baseProductIds: string[], entityId: string, description: string }): Promise<string | null> => {
        if (!user) return null;

        try {
            const newSession: Omit<PurchaseSession, 'id'> = {
                ...data,
                userId: user.id,
                status: 'open',
                createdAt: new Date().toISOString(),
            };
            const docRef = await addDoc(collection(db, "purchaseSessions"), newSession);
            return docRef.id;
        } catch (error) {
            console.error("Error starting new session:", error);
            return null;
        }
    }, [user]);

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

    const deleteSession = useCallback(async (sessionId: string) => {
        try {
            const batch = writeBatch(db);
            
            // Delete the session itself
            const sessionRef = doc(db, "purchaseSessions", sessionId);
            batch.delete(sessionRef);

            // Find and delete all associated items
            const itemsQuery = query(collection(db, "purchaseItems"), where("sessionId", "==", sessionId));
            const itemsSnapshot = await getDocs(itemsQuery);
            itemsSnapshot.forEach(itemDoc => {
                batch.delete(doc(db, "purchaseItems", itemDoc.id));
            });
            
            await batch.commit();
        } catch (error) {
            console.error("Error deleting session and its items:", error);
        }
    }, []);

    const confirmPurchase = useCallback(async (itemId: string, baseProductId: string, pricePerUnit: number) => {
        if (!user) return;
        const itemToConfirm = items.find(i => i.id === itemId);
        if (!itemToConfirm) return;
        
        const baseProduct = baseProducts.find(bp => bp.id === baseProductId);
        if(!baseProduct) return;

        try {
            const batch = writeBatch(db);

            const itemRef = doc(db, "purchaseItems", itemId);
            batch.update(itemRef, {
                isConfirmed: true,
                confirmedBy: user.id,
                confirmedAt: new Date().toISOString(),
                confirmationComment: "",
            });

            const baseProductRef = doc(db, "baseProducts", baseProductId);
            const sessionRef = doc(db, "purchaseSessions", itemToConfirm.sessionId);
            const session = sessions.find(s => s.id === itemToConfirm.sessionId);

            batch.update(baseProductRef, {
                'effectivePrice.pricePerUnit': pricePerUnit,
                'effectivePrice.productId': itemToConfirm.productId,
                'effectivePrice.entityId': session?.entityId || '',
                'effectivePrice.updatedAt': new Date().toISOString()
            });
            
            await batch.commit();

        } catch (error) {
            console.error("Error confirming purchase:", error);
        }
    }, [user, items, baseProducts, sessions]);

    const value: PurchaseContextType = useMemo(() => ({
        sessions,
        items,
        loading,
        startNewSession,
        savePrice,
        closeSession,
        deleteSession,
        confirmPurchase,
    }), [sessions, items, loading, startNewSession, savePrice, closeSession, deleteSession, confirmPurchase]);

    return <PurchaseContext.Provider value={value}>{children}</PurchaseContext.Provider>;
}
