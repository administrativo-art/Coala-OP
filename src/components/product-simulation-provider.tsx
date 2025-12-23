
"use client";

import React, { createContext, useState, useEffect, useCallback, useMemo } from 'react';
import { type ProductSimulation, type ProductSimulationItem, type SimulationPriceHistory, type SimulationChangeHistory, type PricingParameters } from '@/types';
import { db } from '@/lib/firebase';
import { collection, onSnapshot, addDoc, updateDoc, deleteDoc, doc, query, writeBatch, where, getDocs, arrayUnion } from 'firebase/firestore';
import { useAuth } from '@/hooks/use-auth';
import { useBaseProducts } from '@/hooks/use-base-products';
import { useCompanySettings } from '@/hooks/use-company-settings';
import { convertValue } from '@/lib/conversion';

interface SimulationData {
    name: string;
    kioskIds?: string[];
    categoryIds: string[];
    lineId?: string | null;
    groupIds: string[];
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
    ppo?: ProductSimulation['ppo'];
    status?: 'active' | 'archived';
}

interface BulkUpdatePayload {
    status: { action: 'keep' | 'set', value?: 'active' | 'archived' };
    kiosk: { action: 'keep' | 'add' | 'remove' | 'set', ids: string[] };
    line: { action: 'keep' | 'set' | 'clear', id?: string };
    category: { action: 'keep' | 'set' | 'clear', id?: string };
    group: { action: 'keep' | 'add' | 'remove' | 'set', id?: string };
    price: { action: 'keep' | 'change', type: 'percentage' | 'fixed', value: number };
    ncm: { action: 'keep' | 'set', value?: string };
    cest: { action: 'keep' | 'set', value?: string };
    cfop: { action: 'keep' | 'set', value?: string };
}

export interface ProductSimulationContextType {
  simulations: ProductSimulation[];
  simulationItems: ProductSimulationItem[];
  priceHistory: SimulationPriceHistory[];
  loading: boolean;
  addSimulation: (data: SimulationData) => Promise<void>;
  updateSimulation: (data: Partial<Omit<ProductSimulation, 'totalCmv' | 'grossCost' | 'profitValue' | 'profitPercentage' | 'markup'>> & { id: string, items?: SimulationData['items'] }) => Promise<void>;
  deleteSimulation: (simulationId: string) => Promise<void>;
  bulkUpdateSimulations: (simulations: ProductSimulation[], updates: BulkUpdatePayload) => Promise<void>;
}

export const ProductSimulationContext = createContext<ProductSimulationContextType | undefined>(undefined);

export function ProductSimulationProvider({ children }: { children: React.ReactNode }) {
    const { user } = useAuth();
    const { baseProducts, loading: loadingBases } = useBaseProducts();
    const [rawSimulations, setRawSimulations] = useState<ProductSimulation[]>([]);
    const [simulationItems, setSimulationItems] = useState<ProductSimulationItem[]>([]);
    const [priceHistory, setPriceHistory] = useState<SimulationPriceHistory[]>([]);
    const [loading, setLoading] = useState(true);

    const simulations = useMemo(() => {
        if (loading || !baseProducts.length) return rawSimulations;

        return rawSimulations.map(sim => {
            const items = simulationItems.filter(item => item.simulationId === sim.id);
            let totalCmv = 0;

            items.forEach(item => {
                const baseProduct = baseProducts.find(bp => bp.id === item.baseProductId);
                if (!baseProduct || !item.quantity) return;

                let partialCost = 0;
                
                const costSource = baseProduct.lastEffectivePrice?.pricePerUnit ?? baseProduct.initialCostPerUnit ?? 0;
                
                if (item.useDefault) {
                    if(costSource > 0) {
                        partialCost = item.quantity * costSource;
                    }
                } else if (item.overrideCostPerUnit && item.overrideUnit) {
                    try {
                        const valueInBase = convertValue(1, item.overrideUnit, baseProduct.unit, baseProduct.category);
                        if (valueInBase > 0) {
                            partialCost = item.quantity * (item.overrideCostPerUnit / valueInBase);
                        }
                    } catch (e) {
                        console.error(`Error calculating cost for item ${item.id} in simulation ${sim.id}:`, e);
                    }
                }
                totalCmv += partialCost;
            });
            
            const operationPercentage = sim.operationPercentage || 0;
            const salePrice = sim.salePrice || 0;

            const grossCost = totalCmv + (totalCmv * (operationPercentage / 100));
            const profitValue = salePrice - grossCost;
            const profitPercentage = salePrice > 0 ? (profitValue / salePrice) * 100 : 0;
            const markup = grossCost > 0 ? (salePrice / grossCost) - 1 : 0;
            
            return {
                ...sim,
                totalCmv,
                grossCost,
                profitValue,
                profitPercentage,
                markup,
            };
        });

    }, [rawSimulations, simulationItems, baseProducts, loading]);

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
            if(!loadingBases) setLoading(false);
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
    }, [loadingBases]);

    const addSimulation = useCallback(async (data: SimulationData) => {
        if (!user) return;
        
        const now = new Date().toISOString();
        const {items, ...simulationHeader} = data;

        const newSimulation: Omit<ProductSimulation, 'id' | 'totalCmv' | 'grossCost' | 'profitValue' | 'profitPercentage' | 'markup'> = {
            ...simulationHeader,
            status: data.status === 'archived' ? 'archived' : 'active',
            userId: user.id,
            createdAt: now,
            updatedAt: now,
            updatedBy: { userId: user.id, username: user.username },
            ppo: data.ppo || {},
            kioskIds: data.kioskIds || [],
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
    
    const updateSimulation = useCallback(async (data: Partial<Omit<ProductSimulation, 'totalCmv' | 'grossCost' | 'profitValue' | 'profitPercentage' | 'markup'>> & { id: string, items?: SimulationData['items'] }) => {
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
            
            const { createdAt, userId, ...restOfData } = simulationData;
            const updatePayload: Record<string, any> = {
              ...restOfData,
              updatedAt: now,
              updatedBy: { userId: user.id, username: user.username },
            };

            // Ensure PPO is merged, not overwritten
            if (simulationData.ppo) {
                updatePayload.ppo = {
                    ...(existingSimulation.ppo || {}),
                    ...simulationData.ppo
                };
            }
            
            // Clean undefined fields to prevent Firestore errors
            Object.keys(updatePayload).forEach(key => {
              if (updatePayload[key] === undefined) {
                delete updatePayload[key];
              }
            });
            if (updatePayload.ppo) {
              Object.keys(updatePayload.ppo).forEach(key => {
                if (updatePayload.ppo[key] === undefined) {
                  delete updatePayload.ppo[key];
                }
              });
            }

            batch.update(simulationRef, updatePayload);
            
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
    
    const bulkUpdateSimulations = useCallback(async (
        simulationsToUpdate: ProductSimulation[],
        updates: BulkUpdatePayload
    ) => {
        if (!user || simulationsToUpdate.length === 0) return;

        const batch = writeBatch(db);
        const now = new Date().toISOString();

        for (const sim of simulationsToUpdate) {
            const simRef = doc(db, "productSimulations", sim.id);
            const ppo = sim.ppo || {};
            const updatePayload: Partial<ProductSimulation> & { ppo?: Partial<ProductSimulation['ppo']> } = {
                updatedAt: now,
                updatedBy: { userId: user.id, username: user.username },
                ppo: { ...ppo }
            };

            // Handle Status
            if (updates.status.action === 'set' && updates.status.value) {
                updatePayload.status = updates.status.value;
            }

            // Handle Kiosk
            if (updates.kiosk.action === 'set') {
                updatePayload.kioskIds = updates.kiosk.ids;
            } else if (updates.kiosk.action === 'add') {
                updatePayload.kioskIds = Array.from(new Set([...(sim.kioskIds || []), ...updates.kiosk.ids]));
            } else if (updates.kiosk.action === 'remove') {
                const idsToRemove = new Set(updates.kiosk.ids);
                updatePayload.kioskIds = (sim.kioskIds || []).filter(id => !idsToRemove.has(id));
            }
            
            // Handle Line
            if (updates.line.action === 'set' && updates.line.id) {
                updatePayload.lineId = updates.line.id;
            } else if (updates.line.action === 'clear') {
                updatePayload.lineId = null;
            }
            
            // Handle Category
             if (updates.category.action === 'set' && updates.category.id) {
                updatePayload.categoryIds = [updates.category.id];
            } else if (updates.category.action === 'clear') {
                updatePayload.categoryIds = [];
            }

            // Handle Group
            if (updates.group.action === 'set' && updates.group.id) {
                updatePayload.groupIds = [updates.group.id];
            } else if (updates.group.action === 'add' && updates.group.id) {
                updatePayload.groupIds = Array.from(new Set([...(sim.groupIds || []), updates.group.id]));
            } else if (updates.group.action === 'remove' && updates.group.id) {
                updatePayload.groupIds = (sim.groupIds || []).filter(id => id !== updates.group.id);
            }

            // Handle Fiscal Info
            if (updates.ncm.action === 'set' && updates.ncm.value) updatePayload.ppo!.ncm = updates.ncm.value;
            if (updates.cest.action === 'set' && updates.cest.value) updatePayload.ppo!.cest = updates.cest.value;
            if (updates.cfop.action === 'set' && updates.cfop.value) updatePayload.ppo!.cfop = updates.cfop.value;
            
            // Handle Price
            if (updates.price.action === 'change' && updates.price.value !== 0) {
                 const oldPrice = sim.salePrice;
                 let newSalePrice = oldPrice;

                 if (updates.price.type === 'percentage') {
                     newSalePrice = oldPrice * (1 + (updates.price.value / 100));
                 } else { // fixed
                     newSalePrice = updates.price.value;
                 }
                 
                 newSalePrice = Math.max(0, newSalePrice); 

                 if (oldPrice !== newSalePrice) {
                    // Recalculate profit metrics based on the new price
                    // The CMV and Gross Cost are already calculated in the main `simulations` memo
                    const { grossCost } = sim;
                    const newProfitValue = newSalePrice - grossCost;
                    const newProfitPercentage = newSalePrice > 0 ? (newProfitValue / newSalePrice) * 100 : 0;
                    const newMarkup = grossCost > 0 ? (newSalePrice / grossCost) - 1 : 0;
                    
                    updatePayload.salePrice = newSalePrice;
                    updatePayload.profitValue = newProfitValue;
                    updatePayload.profitPercentage = newProfitPercentage;
                    updatePayload.markup = newMarkup;
                    
                    const historyRef = doc(collection(db, "simulationPriceHistory"));
                    const historyEntry: Omit<SimulationPriceHistory, 'id'> = {
                        simulationId: sim.id, oldPrice, newPrice: newSalePrice,
                        changedAt: now, changedBy: { userId: user.id, username: user.username },
                    };
                    batch.set(historyRef, historyEntry);
                 }
            }
            
            batch.update(simRef, updatePayload as any);
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
            bulkUpdateSimulations,
        }
    }, [simulations, simulationItems, priceHistory, loading, addSimulation, updateSimulation, deleteSimulation, bulkUpdateSimulations, baseProducts]);
    
    return <ProductSimulationContext.Provider value={value}>{children}</ProductSimulationContext.Provider>;
}
