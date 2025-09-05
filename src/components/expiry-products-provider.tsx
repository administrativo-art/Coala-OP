
"use client";

import React, { createContext, useState, useEffect, useCallback, useMemo } from 'react';
import { type LotEntry, type MovementRecord, type MovementType, type User } from '@/types';
import { db } from '@/lib/firebase';
import { collection, onSnapshot, addDoc, updateDoc, deleteDoc, doc, query, where, getDocs, writeBatch, setDoc, runTransaction, increment, serverTimestamp } from 'firebase/firestore';
import { useAuth } from '@/hooks/use-auth';
import { pruneUndefined } from '@/lib/utils';


export type MoveLotParams = {
  lotId: string;
  toKioskId: string;
  quantityToMove: number;
  fromKioskId: string;
  fromKioskName: string;
  toKioskName: string;
  productName: string; // This should be the full formatted name
  lotNumber: string;
  productId: string;
};

type MoveOptions = {
  isFinalizingReposition?: boolean;
  activityId?: string;
  allowPartialOnFinalize?: boolean;
};

export type ConsumeLotParams = {
  lotId: string;
  quantityToConsume: number;
  type: 'SAIDA_CONSUMO' | 'SAIDA_DESCARTE' | 'SAIDA_CORRECAO';
  notes?: string;
};

export interface ExpiryProductsContextType {
  lots: LotEntry[];
  loading: boolean;
  addLot: (lot: Omit<LotEntry, 'id'>, user: User) => Promise<void>;
  updateLot: (lot: Partial<LotEntry> & { id: string }) => Promise<void>;
  deleteLotsByIds: (lotIds: string[]) => Promise<boolean>;
  forceDeleteLotById: (lotId: string) => Promise<boolean>;
  moveMultipleLots: (params: MoveLotParams[], user: User, options?: MoveOptions) => Promise<{lotId: string, requested: number, moved: number, pending: number}[]>;
  consumeFromLot: (params: ConsumeLotParams, user: User) => Promise<void>;
  adjustLotQuantity: (lotId: string, newQuantity: number, countedBy: { userId: string, username: string }, approvedBy: User) => Promise<void>;
}

export const ExpiryProductsContext = createContext<ExpiryProductsContextType | undefined>(undefined);

function destLotIdKey(params: {
  productId: string;
  kioskId: string;
  expiryDate?: string | null;
  lotNumber: string;
}) {
  const { productId, kioskId, lotNumber, expiryDate = 'null' } = params;
  // Use a format that avoids invalid characters for Firestore IDs
  const cleanLotNumber = lotNumber.replace(/[^a-zA-Z0-9-]/g, '_');
  return `prod_${productId}__kiosk_${kioskId}__lot_${cleanLotNumber}__exp_${expiryDate}`;
}


export function ExpiryProductsProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const [lots, setLots] = useState<LotEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const q = query(collection(db, "lots"));
    const unsubscribe = onSnapshot(q, (querySnapshot) => {
      const lotsData = querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as LotEntry));
      setLots(lotsData);
      setLoading(false);
    }, (error) => {
        console.error("Error fetching lots from Firestore: ", error);
        setLoading(false);
    });

    return () => unsubscribe();
  }, []);

  const addMovementRecord = (batchOrTx: any, record: Omit<MovementRecord, 'id'>) => {
    const movementHistoryRef = doc(collection(db, "movementHistory"));
    batchOrTx.set(movementHistoryRef, pruneUndefined(record));
  };

  const addLot = useCallback(async (lot: Omit<LotEntry, 'id'>, user: User) => {
    if (!user) throw new Error("Usuário não autenticado");

    try {
        await runTransaction(db, async (transaction) => {
            const uniqueId = destLotIdKey({
                productId: lot.productId,
                kioskId: lot.kioskId,
                lotNumber: lot.lotNumber,
                expiryDate: lot.expiryDate,
            });
            
            const lotRef = doc(db, 'lots', uniqueId);
            const existingDoc = await transaction.get(lotRef);

            if (existingDoc.exists()) {
                transaction.update(lotRef, {
                    quantity: increment(lot.quantity),
                    imageUrl: lot.imageUrl || existingDoc.data().imageUrl || null,
                    locationId: lot.locationId || existingDoc.data().locationId || null,
                    locationName: lot.locationName || existingDoc.data().locationName || null,
                    locationCode: lot.locationCode || existingDoc.data().locationCode || null,
                    updatedAt: serverTimestamp(),
                });
            } else {
                transaction.set(lotRef, {
                  ...lot,
                  createdAt: serverTimestamp(),
                  updatedAt: serverTimestamp(),
                });
            }

             const movementRecord: Omit<MovementRecord, 'id'> = {
                lotId: uniqueId,
                productId: lot.productId,
                productName: lot.productName,
                lotNumber: lot.lotNumber,
                type: 'ENTRADA',
                quantityChange: lot.quantity,
                toKioskId: lot.kioskId,
                userId: user.id,
                username: user.username,
                timestamp: new Date().toISOString(),
                notes: existingDoc.exists() ? 'Adição de quantidade a lote existente.' : 'Criação de novo lote no sistema.',
            };
            addMovementRecord(transaction, movementRecord);
        });

    } catch (error) {
        console.error("Error adding lot:", error);
        throw error;
    }
  }, []);
  
  const updateLot = useCallback(async (updatedLot: Partial<LotEntry> & { id: string }) => {
    const lotRef = doc(db, "lots", updatedLot.id);
    const { id, ...dataToUpdate } = updatedLot;
    try {
      await setDoc(lotRef, dataToUpdate, { merge: true });
    } catch (error) {
      console.error(`Error updating lot with ID ${id}:`, error);
      throw error; 
    }
  }, []);

  const deleteLotsByIds = useCallback(async (lotIds: string[]): Promise<boolean> => {
    if (!lotIds || lotIds.length === 0) {
      return false;
    }
    const batch = writeBatch(db);
    lotIds.forEach(id => {
      batch.delete(doc(db, "lots", id));
    });

    try {
      await batch.commit();
      return true;
    } catch (error) {
      console.error("Error batch deleting lots:", error);
      return false;
    }
  }, []);
  
  const forceDeleteLotById = useCallback(async (lotId: string): Promise<boolean> => {
    if (!lotId) {
        console.error("forceDeleteLotById called with no ID.");
        return false;
    }
    try {
        await deleteDoc(doc(db, "lots", lotId));
        return true;
    } catch (error) {
        console.error(`Force delete failed for lot ID ${lotId}:`, error);
        return false;
    }
  }, []);

  const moveMultipleLots = useCallback(async (paramsArray: MoveLotParams[], user: User, options: MoveOptions = {}) => {
    const { isFinalizingReposition = false, allowPartialOnFinalize = false, activityId } = options;
    const results: { lotId: string; requested: number; moved: number; pending: number }[] = [];

    if (!paramsArray?.length) throw new Error('Nenhum item para movimentar.');

    await runTransaction(db, async (transaction) => {
        for (const it of paramsArray) {
            const { lotId, quantityToMove, toKioskId, productId, lotNumber } = it;

            if (!lotId || !Number.isFinite(quantityToMove) || quantityToMove <= 0) {
                throw new Error(`Parâmetros inválidos para o lote ${lotId}.`);
            }
            
            // 1. LEITURAS PRIMEIRO
            const sourceRef = doc(db, 'lots', lotId);
            const sourceSnap = await transaction.get(sourceRef);
            if (!sourceSnap.exists()) throw new Error(`Lote de origem ${lotId} não encontrado.`);
            const source = sourceSnap.data() as LotEntry;
            
            const destId = destLotIdKey({
                productId: productId,
                kioskId: toKioskId,
                lotNumber: lotNumber,
                expiryDate: source.expiryDate,
            });
            const destRef = doc(db, 'lots', destId);
            const destSnap = await transaction.get(destRef);

            // 2. LÓGICA / VALIDAÇÕES
            const quantity = Number(source.quantity ?? 0);
            const reserved = Number(source.reservedQuantity ?? 0);
            let movable = quantityToMove;
            
            if (isFinalizingReposition) {
                const maxByReserved = Math.max(0, Math.min(reserved, quantity));
                if (maxByReserved < movable) {
                    if (!allowPartialOnFinalize) {
                        throw new Error(`Finalização impraticável no lote ${lotId}: reservado ${reserved}, total ${quantity}, solicitado ${quantityToMove}.`);
                    }
                    movable = maxByReserved; 
                }
            } else {
                const available = quantity - reserved;
                if (available < movable) {
                    throw new Error(`Quantidade inválida no lote ${lotId}: disponível ${available} < mover ${movable}.`);
                }
            }
            
            if (movable <= 0) {
                results.push({ lotId, requested: quantityToMove, moved: 0, pending: quantityToMove });
                continue;
            }

            // 3. ESCRITAS
            const newQuantity = quantity - movable;
            const newReserved = isFinalizingReposition ? Math.max(0, reserved - movable) : reserved;
            
            if (newReserved < 0) throw new Error(`Invariante violada: reservado negativo em ${lotId}.`);
            if (newReserved > newQuantity) {
              throw new Error(`Invariante violada: reservado ${newReserved} > total ${newQuantity} em ${lotId}.`);
            }
            
            transaction.update(sourceRef, {
                quantity: newQuantity,
                reservedQuantity: newReserved,
            });

            if (destSnap.exists()) {
                transaction.update(destRef, { quantity: increment(movable) });
            } else {
                transaction.set(destRef, {
                    ...source,
                    kioskId: toKioskId,
                    quantity: movable,
                    reservedQuantity: 0,
                    locationId: null,
                    locationName: null,
                    locationCode: null,
                    createdAt: serverTimestamp(),
                    updatedAt: serverTimestamp(),
                });
            }

            const now = new Date().toISOString();
            const commonData = {
                productId: source.productId,
                productName: it.productName,
                lotNumber: it.lotNumber,
                quantityChange: movable,
                userId: user.id,
                username: user.username,
                timestamp: now
            };
            
            addMovementRecord(transaction, { ...commonData, lotId: source.id, sourceLotId: source.id, destLotId: destRef.id, type: 'TRANSFERENCIA_SAIDA', fromKioskId: it.fromKioskId, fromKioskName: it.fromKioskName, toKioskId: it.toKioskId, toKioskName: it.toKioskName });
            addMovementRecord(transaction, { ...commonData, lotId: destRef.id, sourceLotId: source.id, destLotId: destRef.id, type: 'TRANSFERENCIA_ENTRADA', fromKioskId: it.fromKioskId, fromKioskName: it.fromKioskName, toKioskId: it.toKioskId, toKioskName: it.toKioskName });

            results.push({
              lotId,
              requested: quantityToMove,
              moved: movable,
              pending: quantityToMove - movable,
            });
        }
    });

    return results;
  }, [lots, user]);

  const consumeFromLot = useCallback(async (params: ConsumeLotParams, user: User) => {
    if (!user) {
        throw new Error("Usuário de baixa não autenticado.");
    }
    await runTransaction(db, async (transaction) => {
        const lotRef = doc(db, "lots", params.lotId);
        const lotDoc = await transaction.get(lotRef);

        if (!lotDoc.exists()) {
            throw new Error("Lote não encontrado para dar baixa.");
        }
        
        const currentLot = lotDoc.data() as LotEntry;
        const availableQty = (currentLot.quantity || 0) - (currentLot.reservedQuantity || 0);

        if(params.quantityToConsume > availableQty) {
            throw new Error(`Quantidade a ser baixada (${params.quantityToConsume}) é maior que o estoque disponível (${availableQty}).`);
        }

        const newQuantity = currentLot.quantity - params.quantityToConsume;
        
        const movementRecord: Omit<MovementRecord, 'id'> = {
            lotId: params.lotId,
            productId: currentLot.productId,
            productName: currentLot.productName,
            lotNumber: currentLot.lotNumber,
            type: params.type,
            quantityChange: params.quantityToConsume,
            fromKioskId: currentLot.kioskId,
            userId: user.id,
            username: user.username,
            timestamp: new Date().toISOString(),
            notes: params.notes,
        };

        addMovementRecord(transaction, movementRecord);
        transaction.update(lotRef, { quantity: newQuantity });
    });
  }, []);

  const adjustLotQuantity = useCallback(async (lotId: string, newQuantity: number, countedBy: { userId: string, username: string }, approvedBy: User) => {
    if (!approvedBy) {
        throw new Error("Usuário de aprovação não autenticado.");
    }
    await runTransaction(db, async (transaction) => {
        const lotRef = doc(db, "lots", lotId);
        const lotDoc = await transaction.get(lotRef);

        if (!lotDoc.exists()) {
            throw new Error("Lote não encontrado para ajuste.");
        }

        const currentLot = lotDoc.data() as LotEntry;
        const currentQuantity = currentLot.quantity;
        const difference = newQuantity - currentQuantity;

        if (difference === 0) return; // No change needed

        const movementType: MovementType = difference > 0 ? 'ENTRADA_CORRECAO' : 'SAIDA_CORRECAO';
        const movementNotes = `Ajuste de estoque aprovado por ${approvedBy.username}. Contado por ${countedBy.username}.`;

        const movementRecord: Omit<MovementRecord, 'id'> = {
            lotId: lotId,
            productId: currentLot.productId,
            productName: currentLot.productName,
            lotNumber: currentLot.lotNumber,
            type: movementType,
            quantityChange: Math.abs(difference),
            fromKioskId: currentLot.kioskId,
            userId: approvedBy.id,
            username: approvedBy.username,
            timestamp: new Date().toISOString(),
            notes: movementNotes,
        };

        addMovementRecord(transaction, movementRecord);
        transaction.update(lotRef, { quantity: newQuantity });
    });
}, []);

  const value: ExpiryProductsContextType = useMemo(() => ({
      lots,
      loading,
      addLot,
      updateLot,
      deleteLotsByIds,
      forceDeleteLotById,
      moveMultipleLots,
      consumeFromLot,
      adjustLotQuantity,
  }), [lots, loading, addLot, updateLot, deleteLotsByIds, forceDeleteLotById, moveMultipleLots, consumeFromLot, adjustLotQuantity]);

  return <ExpiryProductsContext.Provider value={value}>{children}</ExpiryProductsContext.Provider>;
}
