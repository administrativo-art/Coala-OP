

"use client";

import React, { createContext, useState, useEffect, useCallback, useMemo } from 'react';
import { type PurchaseItem, type PriceHistoryEntry, type PurchaseSession, type BaseProduct } from '@/types';
import { db } from '@/lib/firebase';
import { collection, onSnapshot, addDoc, updateDoc, doc, query, where, getDocs, writeBatch, deleteDoc } from 'firebase/firestore';
import { useAuth } from '@/hooks/use-auth';

export interface PurchaseContextType {
  sessions: PurchaseSession[];
  items: PurchaseItem[];
  priceHistory: PriceHistoryEntry[];
  loading: boolean;
  addSession: (data: Omit<PurchaseSession, 'id' | 'userId' | 'status' | 'createdAt' | 'closedAt' | 'entityId'>) => Promise<void>;
  closeSession: (sessionId: string, confirmedItemIds: string[]) => Promise<void>;
  deleteSession: (sessionId: string) => Promise<void>;
  savePrice: (itemId: string | null, data: Partial<Omit<PurchaseItem, 'id'>>) => Promise<void>;
  deletePurchaseItem: (itemId: string) => Promise<void>;
  confirmPurchase: (itemId: string, baseProductId: string, pricePerUnit: number) => Promise<void>;
  deletePriceHistoryEntry: (historyId: string) => Promise<void>;
}

export const PurchaseContext = createContext<PurchaseContextType | undefined>(undefined);

export function PurchaseProvider({ children }: { children: React.ReactNode }) {
    const { user } = useAuth();
    
    const [sessions, setSessions] = useState<PurchaseSession[]>([]);
    const [items, setItems] = useState<PurchaseItem[]>([]);
    const [priceHistory, setPriceHistory] = useState<PriceHistoryEntry[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const qSessions = query(collection(db, "purchaseSessions"));
        const unsubscribeSessions = onSnapshot(qSessions, (snapshot) => {
            const data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as PurchaseSession));
            setSessions(data.sort((a,b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()));
        }, (error) => console.error("Error fetching purchase sessions:", error));

        const qItems = query(collection(db, "purchaseItems"));
        const unsubscribeItems = onSnapshot(qItems, (snapshot) => {
            const data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as PurchaseItem));
            setItems(data);
            setLoading(false);
        }, (error) => {
            console.error("Error fetching purchase items:", error);
            setLoading(false);
        });
        
        const qHistory = query(collection(db, "priceHistory"));
        const unsubscribeHistory = onSnapshot(qHistory, (snapshot) => {
            const data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as PriceHistoryEntry));
            setPriceHistory(data.sort((a, b) => new Date(b.confirmedAt).getTime() - new Date(a.confirmedAt).getTime()));
        }, (error) => {
            console.error("Error fetching price history:", error);
        });

        return () => {
            unsubscribeSessions();
            unsubscribeItems();
            unsubscribeHistory();
        };
    }, []);

     const addSession = useCallback(async (data: Omit<PurchaseSession, 'id' | 'userId' | 'status' | 'createdAt' | 'closedAt' | 'entityId'>) => {
        if (!user) return;
        const { entityId, ...restOfData } = data as any; 
        const newSession: Omit<PurchaseSession, 'id' | 'entityId' | 'closedAt' | 'confirmedItemIds'> = {
            ...restOfData,
            userId: user.id,
            status: 'open',
            createdAt: new Date().toISOString(),
        };
        try {
            await addDoc(collection(db, "purchaseSessions"), newSession);
        } catch (error) {
            console.error("Error adding purchase session:", error);
        }
    }, [user]);

    const closeSession = useCallback(async (sessionId: string, confirmedItemIds: string[]) => {
        try {
            await updateDoc(doc(db, "purchaseSessions", sessionId), {
                status: 'closed',
                closedAt: new Date().toISOString(),
                confirmedItemIds: confirmedItemIds
            });
        } catch (error) {
            console.error("Error closing session:", error);
        }
    }, []);

    const deleteSession = useCallback(async (sessionId: string) => {
        try {
            const batch = writeBatch(db);
            batch.delete(doc(db, "purchaseSessions", sessionId));
            
            const itemsQuery = query(collection(db, "purchaseItems"), where("sessionId", "==", sessionId));
            const itemsSnapshot = await getDocs(itemsQuery);
            itemsSnapshot.forEach(itemDoc => {
                batch.delete(itemDoc.ref);
            });

            await batch.commit();
        } catch (error) {
            console.error("Error deleting session and its items:", error);
        }
    }, []);
    
    const savePrice = useCallback(async (itemId: string | null, data: Partial<Omit<PurchaseItem, 'id'>>) => {
        try {
            if (itemId) {
                await updateDoc(doc(db, "purchaseItems", itemId), data);
            } else {
                const newItem: Omit<PurchaseItem, 'id'> = {
                    sessionId: data.sessionId!,
                    productId: data.productId!,
                    price: data.price || 0,
                    isConfirmed: false,
                    createdAt: new Date().toISOString(),
                };
                await addDoc(collection(db, "purchaseItems"), newItem);
            }
        } catch (error) {
            console.error("Error saving price:", error);
        }
    }, []);

    const deletePurchaseItem = useCallback(async (itemId: string) => {
        try {
            await deleteDoc(doc(db, "purchaseItems", itemId));
        } catch (error) {
            console.error("Error deleting purchase item:", error);
        }
    }, []);


    const confirmPurchase = useCallback(async (itemId: string, baseProductId: string, pricePerUnit: number) => {
        if (!user) return;
        const itemToConfirm = items.find(i => i.id === itemId);
        if (!itemToConfirm) return;
        
        const session = sessions.find(s => s.id === itemToConfirm.sessionId);

        try {
            const batch = writeBatch(db);
            const now = new Date().toISOString();
            
            const itemRef = doc(db, "purchaseItems", itemId);
            batch.update(itemRef, {
                isConfirmed: true,
                confirmedBy: user.id,
                confirmedAt: now,
            });
            
            const historyRef = doc(collection(db, "priceHistory"));
            const historyEntry: Omit<PriceHistoryEntry, 'id'> = {
                baseProductId: baseProductId,
                productId: itemToConfirm.productId,
                pricePerUnit: pricePerUnit,
                entityId: itemToConfirm.entityId || session?.entityId || 'automatic',
                confirmedBy: user.id,
                confirmedAt: now,
            };
            batch.set(historyRef, historyEntry);
            
            await batch.commit();

        } catch (error) {
            console.error("Error confirming purchase:", error);
        }
    }, [user, items, sessions]);
    
    const deletePriceHistoryEntry = useCallback(async (historyId: string) => {
        try {
            await deleteDoc(doc(db, "priceHistory", historyId));
        } catch (error) {
            console.error("Error deleting price history entry:", error);
        }
    }, []);

    const value: PurchaseContextType = useMemo(() => ({
        sessions,
        items,
        priceHistory,
        loading,
        addSession,
        closeSession,
        deleteSession,
        savePrice,
        deletePurchaseItem,
        confirmPurchase,
        deletePriceHistoryEntry,
    }), [sessions, items, priceHistory, loading, addSession, closeSession, deleteSession, savePrice, deletePurchaseItem, confirmPurchase, deletePriceHistoryEntry]);

    return <PurchaseContext.Provider value={value}>{children}</PurchaseContext.Provider>;
}
