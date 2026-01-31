

"use client";

import React, { createContext, useState, useEffect, useCallback, useMemo } from 'react';
import { type PurchaseItem, type PriceHistoryEntry, type PurchaseSession, type BaseProduct } from '@/types';
import { db } from '@/lib/firebase';
import { collection, onSnapshot, addDoc, updateDoc, doc, query, where, getDocs, writeBatch, deleteDoc, runTransaction, increment } from 'firebase/firestore';
import { useAuth } from '@/hooks/use-auth';
import { useProducts } from '@/hooks/use-products';
import { useBaseProducts } from '@/hooks/use-base-products';
import { convertValue } from '@/lib/conversion';

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
  deletePriceHistoryEntry: (historyId: string) => Promise<void>;
}

export const PurchaseContext = createContext<PurchaseContextType | undefined>(undefined);

export function PurchaseProvider({ children }: { children: React.ReactNode }) {
    const { user } = useAuth();
    const { products } = useProducts();
    const { baseProducts } = useBaseProducts();
    
    const [sessions, setSessions] = useState<PurchaseSession[]>([]);
    const [items, setItems] = useState<PurchaseItem[]>([]);
    const [priceHistory, setPriceHistory] = useState<PriceHistoryEntry[]>([]);
    const [loading, setLoading] = useState(true);

    const findPricePerUnit = useCallback((item: PurchaseItem): number | null => {
        const product = products.find(p => p.id === item.productId);
        const baseProduct = baseProducts.find(bp => bp.id === product?.baseProductId);
    
        if (!product || !baseProduct || !item.price || item.price <= 0) {
            return null;
        }
    
        try {
            if (baseProduct.category === 'Unidade') {
                if (product.packageSize > 0) {
                    return item.price / product.packageSize;
                }
            }

            if (product.category === baseProduct.category) {
                const quantityInBaseUnit = convertValue(product.packageSize, product.unit, baseProduct.unit, product.category);
                 if (quantityInBaseUnit > 0) {
                    return item.price / quantityInBaseUnit;
                }
            }
            return null;
        } catch (e) {
            console.error(`Error calculating price per unit for item ${item.id} (${product.baseName}):`, e);
            return null;
        }
    
        return null;
    }, [products, baseProducts]);

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
        if (!user) throw new Error("Usuário não autenticado.");
    
        const sessionRef = doc(db, "purchaseSessions", sessionId);
        
        await runTransaction(db, async (transaction) => {
            const itemsQuery = query(collection(db, "purchaseItems"), where("sessionId", "==", sessionId));
            const itemsSnapshot = await getDocs(itemsQuery);
            const sessionItems = itemsSnapshot.docs.map(d => ({id: d.id, ...d.data()} as PurchaseItem));
    
            let totalValue = 0;
    
            for (const itemId of confirmedItemIds) {
                const item = sessionItems.find(i => i.id === itemId);
                if (!item) continue;
                
                transaction.update(doc(db, "purchaseItems", itemId), { isConfirmed: true });
    
                const product = products.find(p => p.id === item.productId);
                if (!product || !product.baseProductId) continue;
                
                const baseProduct = baseProducts.find(bp => bp.id === product.baseProductId);
                if (!baseProduct) continue;
    
                const pricePerUnit = findPricePerUnit(item);
                if (pricePerUnit === null) continue;
                
                totalValue += item.price;
    
                const historyEntry: Omit<PriceHistoryEntry, 'id'> = {
                    baseProductId: baseProduct.id,
                    productId: item.productId,
                    pricePerUnit,
                    entityId: item.entityId || 'N/A',
                    confirmedBy: user.id,
                    confirmedAt: new Date().toISOString(),
                };
                transaction.set(doc(collection(db, "priceHistory")), historyEntry);
    
                transaction.update(doc(db, "baseProducts", baseProduct.id), { lastEffectivePrice: historyEntry });
            }
            
            for (const item of sessionItems) {
                if (!confirmedItemIds.includes(item.id)) {
                    transaction.update(doc(db, "purchaseItems", item.id), { isConfirmed: false });
                }
            }
    
            transaction.update(sessionRef, {
                status: 'closed',
                closedAt: new Date().toISOString(),
                confirmedItemIds: confirmedItemIds,
                valor_total_estimado: totalValue,
            });
        });
    }, [user, products, baseProducts, findPricePerUnit]);

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
                    entityId: data.entityId,
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
        deletePriceHistoryEntry,
    }), [sessions, items, priceHistory, loading, addSession, closeSession, deleteSession, savePrice, deletePurchaseItem, deletePriceHistoryEntry]);

    return <PurchaseContext.Provider value={value}>{children}</PurchaseContext.Provider>;
}
