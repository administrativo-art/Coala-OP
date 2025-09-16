
"use client";

import React, { createContext, useState, useEffect, useCallback, useMemo } from 'react';
import { type ProductSimulation, type ProductSimulationItem, type SimulationPriceHistory, type SimulationChangeHistory, type PricingParameters } from '@/types';
import { db } from '@/lib/firebase';
import { collection, onSnapshot, addDoc, updateDoc, deleteDoc, doc, query, writeBatch, where, getDocs, arrayUnion } from 'firebase/firestore';
import { useAuth } from '@/hooks/use-auth';
import { useBaseProducts } from '@/hooks/use-base-products';
import { useCompanySettings } from '@/hooks/use-company-settings';

interface SimulationData {
    name: string;
    categoryIds: string[];
    lineId?: string | null;
    items: {
        id?: string;
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
    ppo?: ProductSimulation['ppo'];
}

export interface ProductSimulationContextType {
  simulations: ProductSimulation[];
  simulationItems: ProductSimulationItem[];
  priceHistory: SimulationPriceHistory[];
  loading: boolean;
  addSimulation: (data: SimulationData) => Promise<void>;
  updateSimulation: (data: Partial<ProductSimulation> & { id: string, items?: SimulationData['items'] }) => Promise<void>;
  deleteSimulation: (simulationId: string) => Promise<void>;
  bulkUpdatePrices: (simulations: ProductSimulation[], adjustmentType: 'increase' | 'decrease', valueType: 'percentage' | 'fixed', value: number) => Promise<void>;
  bulkUpdateSimulations: (simulationIds: string[], updates: Partial<Pick<ProductSimulation, 'lineId' | 'categoryIds'>>) => Promise<void>;
}

export const ProductSimulationContext = createContext<ProductSimulationContextType | undefined>(undefined);

export function ProductSimulationProvider({ children }: { children: React.ReactNode }) {
    const { user } = useAuth();
    const { baseProducts } = useBaseProducts();
    const { pricingParameters } = useCompanySettings();
    const [rawSimulations, setRawSimulations] = useState<ProductSimulation[]>([]);
    const [simulationItems, setSimulationItems] = useState<ProductSimulationItem[]>([]);
    const [priceHistory, setPriceHistory] = useState<SimulationPriceHistory[]>([]);
    const [loading, setLoading] = useState(true);

    const simulations = useMemo(() => {
        if (!pricingParameters || !rawSimulations.length) return rawSimulations;
        const { priceCategories } = pricingParameters;
        if (!priceCategories) return rawSimulations;

        const activeCategories = priceCategories
            .filter(c => c.status === 'active')
            .sort((a,b) => a.priority - b.priority);

        return rawSimulations.map(sim => {
            const salePrice = sim.salePrice;
            let priceCategoryId: string | null = null;
            let matchingCategory = null;

            const applicableCategories = activeCategories.filter(cat => salePrice >= cat.min && salePrice < cat.max);
            
            if (applicableCategories.length > 0) {
                 // Here you would evaluate rules to find the best match
                 // For now, we'll just take the first one found by priority
                 matchingCategory = applicableCategories[0];
                 priceCategoryId = matchingCategory.id;
            }

            return { ...sim, priceCategoryId };
        });

    }, [rawSimulations, pricingParameters]);

    useEffect(() => {
        const qSims = query(collection(db, "productSimulations"));
        const unsubSims = onSnapshot(qSims, (snapshot) => {
            const data = snapshot.docs.map(doc => {
                const docData = doc.data();
                if (docData.categoryId && !docData.categoryIds) {
                    docData.categoryIds = [docData.categoryId];
                } else if (!docData.categoryIds) {
                    docData.categoryIds = [];
                }
                delete docData.categoryId;
                return { id: doc.id, ...docData } as ProductSimulation;
            });
            setRawSimulations(data.sort((a,b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()));
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
            updatedBy: { userId: user.id, username: user.username },
            ppo: data.ppo || {},
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
    
    const updateSimulation = useCallback(async (data: Partial<ProductSimulation> & { id: string, items?: SimulationData['items'] }) => {
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
              updatedAt: now,
              updatedBy: { userId: user.id, username: user.username },
            };
            batch.update(simulationRef, updatePayload as any);
            
            if (newPrice !== undefined && oldPrice !== newPrice) {
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

            if (items) {
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
            }

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
                    updatedBy: { userId: user.id, username: user.username },
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

    const bulkUpdateSimulations = useCallback(async (simulationIds: string[], updates: Partial<Pick<ProductSimulation, 'lineId' | 'categoryIds'>>) => {
        if (!user) throw new Error("Usuário não autenticado.");
        if (simulationIds.length === 0) return;

        const batch = writeBatch(db);
        const now = new Date().toISOString();
        
        for (const simId of simulationIds) {
            const simRef = doc(db, "productSimulations", simId);
            const currentSim = simulations.find(s => s.id === simId);
            if (!currentSim) continue;
            
            const historyDetails: SimulationChangeHistory['details'] = [];
            
            if (updates.hasOwnProperty('lineId')) {
                historyDetails.push({ field: 'lineId', from: currentSim.lineId || null, to: updates.lineId! });
            }
            if (updates.hasOwnProperty('categoryIds')) {
                historyDetails.push({ field: 'categoria', from: (currentSim.categoryIds || []).join(','), to: updates.categoryIds!.join(',') });
            }
            
            const historyEntry: SimulationChangeHistory = {
                timestamp: now,
                userId: user.id,
                username: user.username,
                action: 'batch_edit',
                details: historyDetails,
            };
            
            batch.update(simRef, { 
                ...updates,
                updatedAt: now,
                updatedBy: { userId: user.id, username: user.username },
                historicoAlteracoes: arrayUnion(historyEntry)
            });
        }

        try {
            await batch.commit();
        } catch (error) {
            console.error("Error performing bulk simulation update:", error);
            throw error;
        }
    }, [user, simulations]);


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
            bulkUpdateSimulations,
        }
    }, [simulations, simulationItems, priceHistory, loading, addSimulation, updateSimulation, deleteSimulation, bulkUpdatePrices, bulkUpdateSimulations, baseProducts]);
    
    return <ProductSimulationContext.Provider value={value}>{children}</ProductSimulationContext.Provider>;
}
