

"use client";

import React, { createContext, useState, useEffect, useCallback, useMemo } from 'react';
import { type ProductSimulation, type ProductSimulationItem, type SimulationPriceHistory } from '@/types';
import { db } from '@/lib/firebase';
import { collection, onSnapshot, addDoc, updateDoc, deleteDoc, doc, query, writeBatch, where, getDocs } from 'firebase/firestore';
import { useAuth } from '@/hooks/use-auth';
import { useBaseProducts } from '@/hooks/use-base-products';

interface SimulationData {
    name: string;
    categoryId?: string | null;
    lineId?: string | null;
    items: {
        baseProductId: string;
        quantity: number;
        useDefault: boolean;
        overrideCostPerUnit?: number;
        overrideUnit?: string;
    }[];
    operationPercentage?: number;
    salePrice?: number;
    profitGoal?: number | null;
    notes?: string;
    totalCmv: number;
    grossCost: number;
    profitValue: number;
    profitPercentage: number;
    markup: number;
}

export interface ProductSimulationContextType {
  simulations: ProductSimulation[];
  simulationItems: ProductSimulationItem[];
  priceHistory: SimulationPriceHistory[];
  loading: boolean;
  addSimulation: (data: SimulationData) => Promise<void>;
  updateSimulation: (data: ProductSimulation & { items: SimulationData['items'] }) => Promise<void>;
  deleteSimulation: (simulationId: string) => Promise<void>;
  bulkUpdatePrices: (simulations: ProductSimulation[], adjustmentType: 'increase' | 'decrease', valueType: 'percentage' | 'fixed', value: number) => Promise<void>;
}

export const ProductSimulationContext = createContext<ProductSimulationContextType | undefined>(undefined);

export function ProductSimulationProvider({ children }: { children: React.ReactNode }) {
    const { user } = useAuth();
    const { baseProducts } = useBaseProducts();
    const [simulations, setSimulations] = useState<ProductSimulation[]>([]);
    const [simulationItems, setSimulationItems] = useState<ProductSimulationItem[]>([]);
    const [priceHistory, setPriceHistory] = useState<SimulationPriceHistory[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const qSims = query(collection(db, "productSimulations"));
        const unsubSims = onSnapshot(qSims, (snapshot) => {
            const data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as ProductSimulation));
            setSimulations(data.sort((a,b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()));
            setLoading(false);
        }, (error) => {
            console.error("Error fetching simulations:", error);
            setLoading(false);
        });

        const qItems = query(collection(db, "productSimulationItems"));
        const unsubItems = onSnapshot(qItems, (snapshot) => {
            const data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as ProductSimulationItem));
            setSimulationItems(data);
        }, (error) => {
            console.error("Error fetching simulation items:", error);
        });
        
        const qHistory = query(collection(db, "simulationPriceHistory"));
        const unsubHistory = onSnapshot(qHistory, (snapshot) => {
            const data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as SimulationPriceHistory));
            setPriceHistory(data.sort((a,b) => new Date(b.changedAt).getTime() - new Date(a.changedAt).getTime()));
        }, (error) => {
            console.error("Error fetching price history:", error);
        });

        return () => {
            unsubSims();
            unsubItems();
            unsubHistory();
        };
    }, []);

    const addSimulation = useCallback(async (data: SimulationData) => {
        if (!user) return;
        
        const now = new Date().toISOString();
        const {items, ...simulationHeader} = data;

        const newSimulation: Omit<ProductSimulation, 'id'> = {
            ...simulationHeader,
            userId: user.id,
            status: 'draft',
            createdAt: now,
            updatedAt: now,
        };

        try {
            const simulationRef = await addDoc(collection(db, "productSimulations"), newSimulation);
            const batch = writeBatch(db);
            
            items.forEach(item => {
                const itemRef = doc(collection(db, "productSimulationItems"));
                const newItem: Omit<ProductSimulationItem, 'id'> = {
                    simulationId: simulationRef.id,
                    baseProductId: item.baseProductId,
                    quantity: item.quantity,
                    useDefault: item.useDefault,
                    overrideCostPerUnit: item.overrideCostPerUnit,
                    overrideUnit: item.overrideUnit
                };
                batch.set(itemRef, newItem);
            });
            
            await batch.commit();

        } catch (error) {
            console.error("Error adding simulation:", error);
        }
    }, [user]);
    
    const updateSimulation = useCallback(async (data: ProductSimulation & { items: SimulationData['items'] }) => {
        if (!user) return;
        
        const now = new Date().toISOString();
        const { items, id: simulationId, ...simulationData } = data;
        const simulationRef = doc(db, "productSimulations", simulationId);
        
        const existingSimulation = simulations.find(s => s.id === simulationId);
        if (!existingSimulation) {
            console.error("Simulation to update not found");
            return;
        }
        
        const oldPrice = existingSimulation.salePrice;
        const newPrice = simulationData.salePrice;

        try {
            const batch = writeBatch(db);
            
            const { createdAt, userId, status, ...restOfData } = simulationData;
            const updatePayload = {
              ...restOfData,
              updatedAt: now
            };
            batch.update(simulationRef, updatePayload);
            
            if (oldPrice !== newPrice) {
                const historyRef = doc(collection(db, "simulationPriceHistory"));
                const historyEntry: Omit<SimulationPriceHistory, 'id'> = {
                    simulationId,
                    oldPrice,
                    newPrice,
                    changedAt: now,
                    changedBy: { userId: user.id, username: user.username },
                };
                batch.set(historyRef, historyEntry);
            }

            const oldItemsQuery = query(collection(db, "productSimulationItems"), where("simulationId", "==", simulationId));
            const oldItemsSnapshot = await getDocs(oldItemsQuery);
            oldItemsSnapshot.forEach(doc => batch.delete(doc.ref));

            items.forEach(item => {
                const itemRef = doc(collection(db, "productSimulationItems"));
                 const newItem: Omit<ProductSimulationItem, 'id'> = {
                    simulationId: simulationId,
                    baseProductId: item.baseProductId,
                    quantity: item.quantity,
                    useDefault: item.useDefault,
                    overrideCostPerUnit: item.overrideCostPerUnit,
                    overrideUnit: item.overrideUnit
                };
                batch.set(itemRef, newItem);
            });

            await batch.commit();
        } catch (error) {
            console.error("Error updating simulation:", error);
        }
    }, [user, simulations]);

    const deleteSimulation = useCallback(async (simulationId: string) => {
        try {
            const batch = writeBatch(db);
            
            batch.delete(doc(db, "productSimulations", simulationId));

            const itemsQuery = query(collection(db, "productSimulationItems"), where("simulationId", "==", simulationId));
            const itemsSnapshot = await getDocs(itemsQuery);
            itemsSnapshot.forEach(doc => batch.delete(doc.ref));
            
            const historyQuery = query(collection(db, "simulationPriceHistory"), where("simulationId", "==", simulationId));
            const historySnapshot = await getDocs(historyQuery);
            historySnapshot.forEach(doc => batch.delete(doc.ref));

            await batch.commit();
        } catch (error) {
            console.error("Error deleting simulation:", error);
        }
    }, []);
    
    const bulkUpdatePrices = useCallback(async (
        simulationsToUpdate: ProductSimulation[],
        adjustmentType: 'increase' | 'decrease',
        valueType: 'percentage' | 'fixed',
        value: number
    ) => {
        if (!user || value <= 0) return;

        const batch = writeBatch(db);
        const now = new Date().toISOString();

        simulationsToUpdate.forEach(sim => {
            const oldPrice = sim.salePrice;
            let newSalePrice = sim.salePrice;
            const multiplier = adjustmentType === 'increase' ? 1 : -1;

            if (valueType === 'percentage') {
                newSalePrice = sim.salePrice * (1 + (value / 100) * multiplier);
            } else { // fixed
                newSalePrice = sim.salePrice + (value * multiplier);
            }
            
            newSalePrice = Math.max(0, newSalePrice); 

            if (oldPrice !== newSalePrice) {
                const newProfitValue = newSalePrice - sim.grossCost;
                const newProfitPercentage = newSalePrice > 0 ? (newProfitValue / newSalePrice) * 100 : 0;
                const newMarkup = sim.grossCost > 0 ? (newSalePrice / sim.grossCost) -1 : 0;
                
                const simRef = doc(db, "productSimulations", sim.id);
                batch.update(simRef, {
                    salePrice: newSalePrice,
                    profitValue: newProfitValue,
                    profitPercentage: newProfitPercentage,
                    markup: newMarkup,
                    updatedAt: now,
                });
                
                const historyRef = doc(collection(db, "simulationPriceHistory"));
                const historyEntry: Omit<SimulationPriceHistory, 'id'> = {
                    simulationId: sim.id,
                    oldPrice,
                    newPrice: newSalePrice,
                    changedAt: now,
                    changedBy: { userId: user.id, username: user.username },
                };
                batch.set(historyRef, historyEntry);
            }
        });

        try {
            await batch.commit();
        } catch (error) {
            console.error("Error performing bulk price update:", error);
        }
    }, [user]);


    const value = useMemo(() => {
        return {
            simulations,
            simulationItems,
            priceHistory,
            loading,
            addSimulation,
            updateSimulation,
            deleteSimulation,
            bulkUpdatePrices,
        }
    }, [simulations, simulationItems, priceHistory, loading, addSimulation, updateSimulation, deleteSimulation, bulkUpdatePrices, baseProducts]);
    
    return <ProductSimulationContext.Provider value={value}>{children}</ProductSimulationContext.Provider>;
}
