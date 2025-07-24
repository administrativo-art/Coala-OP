

"use client";

import React, { createContext, useState, useEffect, useCallback, useMemo } from 'react';
import { type PurchaseSession, type PurchaseItem, type BaseProduct, type LastEffectivePrice, type PriceHistoryEntry } from '@/types';
import { db } from '@/lib/firebase';
import { collection, onSnapshot, addDoc, updateDoc, doc, query, where, getDocs, writeBatch, deleteDoc } from 'firebase/firestore';
import { useAuth } from '@/hooks/use-auth';
import { useBaseProducts } from '@/hooks/use-base-products';

export interface PurchaseContextType {
  sessions: PurchaseSession[];
  items: PurchaseItem[];
  priceHistory: PriceHistoryEntry[];
  loading: boolean;
  lastEffectivePrices: Map<string, LastEffectivePrice>;
  lastSavedPrices: Map<string, number>; // New map for last saved prices
  startNewSession: (data: { baseProductIds: string[], entityId: string, description: string }) => Promise<string | null>;
  savePrice: (sessionId: string, productId: string, price: number) => Promise<void>;
  closeSession: (sessionId: string) => Promise<void>;
  deleteSession: (sessionId: string) => Promise<void>;
  confirmPurchase: (itemId: string, baseProductId: string, pricePerUnit: number) => Promise<void>;
  deletePriceHistoryEntry: (historyId: string) => Promise<void>;
}

export const PurchaseContext = createContext<PurchaseContextType | undefined>(undefined);

export function PurchaseProvider({ children }: { children: React.ReactNode }) {
    const { user } = useAuth();
    const { baseProducts, loading: loadingBaseProducts } = useBaseProducts();

    const [sessions, setSessions] = useState<PurchaseSession[]>([]);
    const [items, setItems] = useState<PurchaseItem[]>([]);
    const [priceHistory, setPriceHistory] = useState<PriceHistoryEntry[]>([]);
    const [loading, setLoading] = useState(true);

    const lastEffectivePrices = useMemo((): Map<string, LastEffectivePrice> => {
        const priceMap = new Map<string, LastEffectivePrice>();
        if (loadingBaseProducts || !baseProducts || baseProducts.length === 0) {
            return priceMap;
        }

        baseProducts.forEach(bp => {
            if (bp.lastEffectivePrice && bp.lastEffectivePrice.productId && bp.lastEffectivePrice.updatedAt) {
                const currentPriceInfo = bp.lastEffectivePrice;
                const existingPriceInfo = priceMap.get(currentPriceInfo.productId);
                 
                if (!existingPriceInfo || new Date(currentPriceInfo.updatedAt) > new Date(existingPriceInfo.updatedAt)) {
                    priceMap.set(currentPriceInfo.productId, currentPriceInfo);
                }
            }
        });
        return priceMap;
    }, [baseProducts, loadingBaseProducts]);

    const lastSavedPrices = useMemo((): Map<string, number> => {
        const priceMap = new Map<string, { price: number; date: string }>();
        const closedSessionsMap = new Map(sessions.filter(s => s.status === 'closed').map(s => [s.id, s]));

        items.forEach(item => {
            const session = closedSessionsMap.get(item.sessionId);
            if (session && item.price > 0 && session.closedAt) {
                const existing = priceMap.get(item.productId);
                if (!existing || new Date(session.closedAt) > new Date(existing.date)) {
                    priceMap.set(item.productId, { price: item.price, date: session.closedAt });
                }
            }
        });
        
        const finalMap = new Map<string, number>();
        priceMap.forEach((value, key) => {
            finalMap.set(key, value.price);
        });

        return finalMap;

    }, [items, sessions]);

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
            
            const sessionRef = doc(db, "purchaseSessions", sessionId);
            batch.delete(sessionRef);

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
            const now = new Date().toISOString();
            const session = sessions.find(s => s.id === itemToConfirm.sessionId);
            
            // 1. Update the purchase item
            const itemRef = doc(db, "purchaseItems", itemId);
            batch.update(itemRef, {
                isConfirmed: true,
                confirmedBy: user.id,
                confirmedAt: now,
            });

            // 2. Update the base product with the last effective price
            const baseProductRef = doc(db, "baseProducts", baseProductId);
            batch.update(baseProductRef, {
                'lastEffectivePrice.pricePerUnit': pricePerUnit,
                'lastEffectivePrice.productId': itemToConfirm.productId,
                'lastEffectivePrice.entityId': session?.entityId || '',
                'lastEffectivePrice.updatedAt': now
            });
            
            // 3. Log the price to the history collection
            const historyRef = doc(collection(db, "priceHistory"));
            const historyEntry: Omit<PriceHistoryEntry, 'id'> = {
                baseProductId: baseProductId,
                productId: itemToConfirm.productId,
                pricePerUnit: pricePerUnit,
                entityId: session?.entityId || '',
                confirmedBy: user.id,
                confirmedAt: now,
            };
            batch.set(historyRef, historyEntry);
            
            await batch.commit();

        } catch (error) {
            console.error("Error confirming purchase:", error);
        }
    }, [user, items, baseProducts, sessions]);
    
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
        loading: loading || loadingBaseProducts,
        lastEffectivePrices,
        lastSavedPrices,
        startNewSession,
        savePrice,
        closeSession,
        deleteSession,
        confirmPurchase,
        deletePriceHistoryEntry,
    }), [sessions, items, priceHistory, loading, loadingBaseProducts, lastEffectivePrices, lastSavedPrices, startNewSession, savePrice, closeSession, deleteSession, confirmPurchase, deletePriceHistoryEntry]);

    return <PurchaseContext.Provider value={value}>{children}</PurchaseContext.Provider>;
}

    