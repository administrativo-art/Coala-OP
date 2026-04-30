
"use client";

import React, { createContext, useState, useEffect, useCallback, useMemo } from 'react';
import { type EffectivePriceResolution, type PriceOverride, type ProductSimulation, type ProductSimulationItem, type SimulationPriceHistory } from '@/types';
import { db } from '@/lib/firebase';
import { collection, onSnapshot, addDoc, updateDoc, deleteDoc, doc, query, writeBatch, where, getDocs, runTransaction } from 'firebase/firestore';
import { useAuth } from '@/hooks/use-auth';
import { useBaseProducts } from '@/hooks/use-base-products';
import { useCompanySettings } from '@/hooks/use-company-settings';
import { useChannels } from '@/hooks/use-channels';
import { convertValue } from '@/lib/conversion';
import { buildPriceOverrideId, calculateSimulationMetrics, resolveEffectivePrice } from '@/lib/pricing-context';

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
    salePrice?: number;
    profitGoal?: number | null;
    notes?: string;
    ppo?: ProductSimulation['ppo'];
}

interface PriceOverrideInput {
    simulationId: string;
    unitId: string | null;
    channelId: string | null;
    finalPrice: number | null;
    available: boolean;
    updatedAt?: string;
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
  priceOverrides: PriceOverride[];
  loading: boolean;
  addSimulation: (data: SimulationData) => Promise<void>;
  updateSimulation: (data: Partial<Omit<ProductSimulation, 'totalCmv' | 'profitValue' | 'profitPercentage' | 'markup'>> & { id: string, items?: SimulationData['items'] }) => Promise<void>;
  deleteSimulation: (simulationId: string) => Promise<void>;
  bulkUpdateSimulations: (simulations: ProductSimulation[], updates: BulkUpdatePayload) => Promise<void>;
  upsertPriceOverride: (data: PriceOverrideInput) => Promise<void>;
  deletePriceOverride: (overrideId: string) => Promise<void>;
  getSimulationOverrides: (simulationId: string) => PriceOverride[];
  resolveSimulationPrice: (simulation: ProductSimulation, unitId: string | null, channelId: string | null) => EffectivePriceResolution;
}

export const ProductSimulationContext = createContext<ProductSimulationContextType | undefined>(undefined);

export function ProductSimulationProvider({ children }: { children: React.ReactNode }) {
    const { user, permissions } = useAuth();
    const { baseProducts, loading: loadingBases } = useBaseProducts();
    const { pricingParameters } = useCompanySettings();
    const { channels } = useChannels();
    const [rawSimulations, setRawSimulations] = useState<ProductSimulation[]>([]);
    const [simulationItems, setSimulationItems] = useState<ProductSimulationItem[]>([]);
    const [priceHistory, setPriceHistory] = useState<SimulationPriceHistory[]>([]);
    const [priceOverrides, setPriceOverrides] = useState<PriceOverride[]>([]);
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
            
            const salePrice = sim.salePrice || 0;
            const taxPercent = pricingParameters?.averageTaxPercentage || 0;
            const feePercent = pricingParameters?.averageCardFeePercentage || 0;
            const metrics = calculateSimulationMetrics(salePrice, totalCmv, taxPercent, feePercent);
            
            return {
                ...sim,
                totalCmv,
                profitValue: metrics.profitValue,
                profitPercentage: metrics.profitPercentage,
                markup: metrics.markup,
            };
        });

    }, [rawSimulations, simulationItems, baseProducts, loading, pricingParameters]);

    useEffect(() => {
        const canRead = permissions?.pricing?.view || permissions?.dashboard?.technicalSheets;
        if (!canRead) {
            setRawSimulations([]);
            setSimulationItems([]);
            setPriceHistory([]);
            setPriceOverrides([]);
            setLoading(false);
            return;
        }
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

        const qOverrides = query(collection(db, "priceOverrides"));
        const unsubOverrides = onSnapshot(qOverrides, (snapshot) => {
            const data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as PriceOverride));
            setPriceOverrides(data.sort((a, b) => a.id.localeCompare(b.id)));
        }, (error) => {
            console.error("Error fetching price overrides:", error);
        });

        return () => {
            unsubSims();
            unsubItems();
            unsubHistory();
            unsubOverrides();
        };
    }, [loadingBases, permissions?.pricing?.view, permissions?.dashboard?.technicalSheets]);

    const getSimulationOverrides = useCallback((simulationId: string) => {
        return priceOverrides.filter(override => override.simulationId === simulationId);
    }, [priceOverrides]);

    const resolveSimulationPrice = useCallback((simulation: ProductSimulation, unitId: string | null, channelId: string | null) => {
        return resolveEffectivePrice(simulation, unitId, channelId, channels, getSimulationOverrides(simulation.id));
    }, [channels, getSimulationOverrides]);

    const validateOverrideScope = useCallback((simulation: ProductSimulation, unitId: string | null, channelId: string | null) => {
        if (unitId === null && channelId === null) {
            throw new Error('Override global não é permitido. Edite o preço base da mercadoria.');
        }

        if (unitId && !(simulation.kioskIds || []).includes(unitId)) {
            throw new Error('Habilite a mercadoria nesta unidade antes de criar o override.');
        }

        if (channelId) {
            const channel = channels.find(item => item.id === channelId);
            if (!channel || !channel.active) {
                throw new Error('Não é possível criar override para canal inativo.');
            }
        }
    }, [channels]);

    const deletePriceOverride = useCallback(async (overrideId: string) => {
        await deleteDoc(doc(db, 'priceOverrides', overrideId));
    }, []);

    const upsertPriceOverride = useCallback(async (data: PriceOverrideInput) => {
        if (!user) return;

        const simulation = rawSimulations.find(item => item.id === data.simulationId);
        if (!simulation) {
            throw new Error('Mercadoria não encontrada.');
        }

        validateOverrideScope(simulation, data.unitId, data.channelId);

        if (data.finalPrice === null || data.finalPrice === undefined) {
            await deletePriceOverride(buildPriceOverrideId(data.simulationId, data.unitId, data.channelId));
            return;
        }

        if (data.available && data.finalPrice <= 0) {
            throw new Error('Preço zero ou negativo não é permitido para override disponível. Deixe o campo vazio ou use "Remover override".');
        }

        const overrideId = buildPriceOverrideId(data.simulationId, data.unitId, data.channelId);
        const overrideRef = doc(db, 'priceOverrides', overrideId);
        const now = new Date().toISOString();

        await runTransaction(db, async (transaction) => {
            const currentSnap = await transaction.get(overrideRef);
            const current = currentSnap.exists() ? (currentSnap.data() as PriceOverride) : null;

            if (current && data.updatedAt && current.updatedAt !== data.updatedAt) {
                const conflictError = new Error('Conflito de edição. Atualize a matriz e tente novamente.');
                (conflictError as Error & { status?: number }).status = 409;
                throw conflictError;
            }

            const basePayload = {
                simulationId: data.simulationId,
                unitId: data.unitId,
                channelId: data.channelId,
                finalPrice: data.finalPrice,
                available: data.available,
                updatedAt: now,
                updatedBy: { userId: user.id, username: user.username },
            };

            if (current) {
                transaction.update(overrideRef, basePayload);
                return;
            }

            transaction.set(overrideRef, {
                ...basePayload,
                createdAt: now,
                createdBy: { userId: user.id, username: user.username },
            });
        });
    }, [deletePriceOverride, rawSimulations, user, validateOverrideScope]);

    const addSimulation = useCallback(async (data: SimulationData) => {
        if (!user) return;
        
        const now = new Date().toISOString();
        const {items, ...simulationHeader} = data;

        const newSimulation: Omit<ProductSimulation, 'id' | 'totalCmv' | 'profitValue' | 'profitPercentage' | 'markup'> = {
            name: simulationHeader.name,
            kioskIds: simulationHeader.kioskIds ?? [],
            categoryIds: simulationHeader.categoryIds,
            lineId: simulationHeader.lineId ?? null,
            groupIds: simulationHeader.groupIds,
            userId: user.id,
            salePrice: simulationHeader.salePrice ?? 0,
            profitGoal: simulationHeader.profitGoal,
            notes: simulationHeader.notes,
            ppo: data.ppo ?? {},
            createdAt: now,
            updatedAt: now,
            updatedBy: { userId: user.id, username: user.username },
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
    
    const updateSimulation = useCallback(async (data: Partial<Omit<ProductSimulation, 'totalCmv' | 'profitValue' | 'profitPercentage' | 'markup'>> & { id: string, items?: SimulationData['items'] }) => {
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
    }, [user, simulations, getSimulationOverrides]);

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

            const overridesQuery = query(collection(db, "priceOverrides"), where("simulationId", "==", simulationId));
            const overridesSnapshot = await getDocs(overridesQuery);
            overridesSnapshot.forEach(doc => batch.delete(doc.ref));

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
                    const { totalCmv } = sim;
                    const taxPercent = pricingParameters?.averageTaxPercentage || 0;
                    const feePercent = pricingParameters?.averageCardFeePercentage || 0;
                    const metrics = calculateSimulationMetrics(newSalePrice, totalCmv, taxPercent, feePercent);
                    
                    updatePayload.salePrice = newSalePrice;
                    updatePayload.profitValue = metrics.profitValue;
                    updatePayload.profitPercentage = metrics.profitPercentage;
                    updatePayload.markup = metrics.markup;
                    
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
    }, [user, pricingParameters]);


    const value = useMemo(() => {
        return {
            simulations,
            simulationItems,
            priceHistory,
            priceOverrides,
            loading,
            addSimulation,
            updateSimulation,
            deleteSimulation,
            bulkUpdateSimulations,
            upsertPriceOverride,
            deletePriceOverride,
            getSimulationOverrides,
            resolveSimulationPrice,
        }
    }, [simulations, simulationItems, priceHistory, priceOverrides, loading, addSimulation, updateSimulation, deleteSimulation, bulkUpdateSimulations, upsertPriceOverride, deletePriceOverride, getSimulationOverrides, resolveSimulationPrice, baseProducts]);
    
    return <ProductSimulationContext.Provider value={value}>{children}</ProductSimulationContext.Provider>;
}
