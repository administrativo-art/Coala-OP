
"use client";

import React, { createContext, useState, useEffect, useCallback, useMemo } from 'react';
import { type PurchaseItem, type LastEffectivePrice, type PriceHistoryEntry } from '@/types';
import { db } from '@/lib/firebase';
import { collection, onSnapshot, addDoc, updateDoc, doc, query, where, getDocs, writeBatch, deleteDoc } from 'firebase/firestore';
import { useAuth } from '@/hooks/use-auth';
import { useBaseProducts } from '@/hooks/use-base-products';

export interface PurchaseContextType {
  items: PurchaseItem[];
  priceHistory: PriceHistoryEntry[];
  loading: boolean;
  lastEffectivePrices: Map<string, LastEffectivePrice>;
  lastSavedPrices: Map<string, number>;
  savePrice: (sessionId: string, productId: string, price: number) => Promise<void>;
  confirmPurchase: (itemId: string, baseProductId: string, pricePerUnit: number) => Promise<void>;
  deletePriceHistoryEntry: (historyId: string) => Promise<void>;
}

export const PurchaseContext = createContext<PurchaseContextType | undefined>(undefined);

export function PurchaseProvider({ children }: { children: React.ReactNode }) {
    const { user } = useAuth();
    const { baseProducts, loading: loadingBaseProducts } = useBaseProducts();

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

        items.forEach(item => {
            if (item.price > 0 && item.createdAt) { // Assuming createdAt exists on purchase item
                const existing = priceMap.get(item.productId);
                if (!existing || new Date(item.createdAt) > new Date(existing.date)) {
                    priceMap.set(item.productId, { price: item.price, date: item.createdAt });
                }
            }
        });
        
        const finalMap = new Map<string, number>();
        priceMap.forEach((value, key) => {
            finalMap.set(key, value.price);
        });

        return finalMap;

    }, [items]);

    useEffect(() => {
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
            unsubscribeItems();
            unsubscribeHistory();
        };
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
                    createdAt: new Date().toISOString(),
                };
                await addDoc(collection(db, "purchaseItems"), newItem);
            }
        } catch (error) {
            console.error("Error saving price:", error);
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
                'lastEffectivePrice.entityId': 'automatic', // Or find a way to associate entity
                'lastEffectivePrice.updatedAt': now
            });
            
            // 3. Log the price to the history collection
            const historyRef = doc(collection(db, "priceHistory"));
            const historyEntry: Omit<PriceHistoryEntry, 'id'> = {
                baseProductId: baseProductId,
                productId: itemToConfirm.productId,
                pricePerUnit: pricePerUnit,
                entityId: 'automatic', // Or find a way to associate entity
                confirmedBy: user.id,
                confirmedAt: now,
            };
            batch.set(historyRef, historyEntry);
            
            await batch.commit();

        } catch (error) {
            console.error("Error confirming purchase:", error);
        }
    }, [user, items, baseProducts]);
    
    const deletePriceHistoryEntry = useCallback(async (historyId: string) => {
        try {
            await deleteDoc(doc(db, "priceHistory", historyId));
        } catch (error) {
            console.error("Error deleting price history entry:", error);
        }
    }, []);

    const value: PurchaseContextType = useMemo(() => ({
        items,
        priceHistory,
        loading: loading || loadingBaseProducts,
        lastEffectivePrices,
        lastSavedPrices,
        savePrice,
        confirmPurchase,
        deletePriceHistoryEntry,
    }), [items, priceHistory, loading, loadingBaseProducts, lastEffectivePrices, lastSavedPrices, savePrice, confirmPurchase, deletePriceHistoryEntry]);

    return <PurchaseContext.Provider value={value}>{children}</PurchaseContext.Provider>;
}
