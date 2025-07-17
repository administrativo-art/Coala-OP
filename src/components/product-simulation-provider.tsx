

"use client";

import React, { createContext, useState, useEffect, useCallback, useMemo } from 'react';
import { type ProductSimulation, type ProductSimulationItem } from '@/types';
import { db } from '@/lib/firebase';
import { collection, onSnapshot, addDoc, updateDoc, deleteDoc, doc, query, writeBatch, where, getDocs } from 'firebase/firestore';
import { useAuth } from '@/hooks/use-auth';
import { useBaseProducts } from '@/hooks/use-base-products';

interface SimulationData {
    name: string;
    categoryId?: string;
    subcategoryId?: string | null;
    items: {
        baseProductId: string;
        quantity: number;
        unit: string;
        useDefaultCost: boolean;
        overrideCostPerUnit?: number;
    }[];
    operationPercentage?: number;
    salePrice?: number;
    notes?: string;
    totalCmv: number;
    grossCost: number;
    profitValue: number;
    profitPercentage: number;
}

export interface ProductSimulationContextType {
  simulations: ProductSimulation[];
  simulationItems: ProductSimulationItem[];
  loading: boolean;
  addSimulation: (data: SimulationData) => Promise<void>;
  updateSimulation: (data: ProductSimulation & { items: SimulationData['items'] }) => Promise<void>;
  deleteSimulation: (simulationId: string) => Promise<void>;
}

export const ProductSimulationContext = createContext<ProductSimulationContextType | undefined>(undefined);

export function ProductSimulationProvider({ children }: { children: React.ReactNode }) {
    const { user } = useAuth();
    const { baseProducts } = useBaseProducts();
    const [simulations, setSimulations] = useState<ProductSimulation[]>([]);
    const [simulationItems, setSimulationItems] = useState<ProductSimulationItem[]>([]);
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

        return () => {
            unsubSims();
            unsubItems();
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
                    unit: item.unit,
                    useDefaultCost: item.useDefaultCost,
                    overrideCostPerUnit: item.overrideCostPerUnit,
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
        const { items, id, ...simulationData } = data;
        const simulationRef = doc(db, "productSimulations", id);
        
        try {
            const batch = writeBatch(db);
            
            // Update simulation document
            batch.update(simulationRef, { ...simulationData, updatedAt: now });

            // Delete old items
            const oldItemsQuery = query(collection(db, "productSimulationItems"), where("simulationId", "==", id));
            const oldItemsSnapshot = await getDocs(oldItemsQuery);
            oldItemsSnapshot.forEach(doc => batch.delete(doc.ref));

            // Add new items
            items.forEach(item => {
                const itemRef = doc(collection(db, "productSimulationItems"));
                 const newItem: Omit<ProductSimulationItem, 'id'> = {
                    simulationId: id,
                    baseProductId: item.baseProductId,
                    quantity: item.quantity,
                    unit: item.unit,
                    useDefaultCost: item.useDefaultCost,
                    overrideCostPerUnit: item.overrideCostPerUnit,
                };
                batch.set(itemRef, newItem);
            });

            await batch.commit();
        } catch (error) {
            console.error("Error updating simulation:", error);
        }
    }, [user]);

    const deleteSimulation = useCallback(async (simulationId: string) => {
        try {
            const batch = writeBatch(db);
            
            // Delete simulation
            batch.delete(doc(db, "productSimulations", simulationId));

            // Delete associated items
            const itemsQuery = query(collection(db, "productSimulationItems"), where("simulationId", "==", simulationId));
            const itemsSnapshot = await getDocs(itemsQuery);
            itemsSnapshot.forEach(doc => batch.delete(doc.ref));

            await batch.commit();
        } catch (error) {
            console.error("Error deleting simulation:", error);
        }
    }, []);


    const value = useMemo(() => {
        return {
            simulations,
            simulationItems,
            loading,
            addSimulation,
            updateSimulation,
            deleteSimulation,
        }
    }, [simulations, simulationItems, loading, addSimulation, updateSimulation, deleteSimulation, baseProducts]);
    
    return <ProductSimulationContext.Provider value={value}>{children}</ProductSimulationContext.Provider>;
}
