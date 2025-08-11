

"use client";

import React, { createContext, useState, useEffect, useCallback, useMemo } from 'react';
import { type LotEntry, type MovementRecord, type MovementType, type User } from '@/types';
import { db } from '@/lib/firebase';
import { collection, onSnapshot, addDoc, updateDoc, deleteDoc, doc, query, where, getDocs, writeBatch, setDoc, runTransaction, increment } from 'firebase/firestore';

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
  moveMultipleLots: (params: MoveLotParams[], user: User) => Promise<void>;
  consumeFromLot: (params: ConsumeLotParams, user: User) => Promise<void>;
  adjustLotQuantity: (lotId: string, newQuantity: number, countedBy: { userId: string, username: string }, approvedBy: User) => Promise<void>;
}

export const ExpiryProductsContext = createContext<ExpiryProductsContextType | undefined>(undefined);

export function ExpiryProductsProvider({ children }: { children: React.ReactNode }) {
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

  const addMovementRecord = (batch: any, record: Omit<MovementRecord, 'id'>) => {
    const movementHistoryRef = doc(collection(db, "movementHistory"));
    batch.set(movementHistoryRef, record);
  };

  const addLot = useCallback(async (lot: Omit<LotEntry, 'id'>, user: User) => {
    if (!user) throw new Error("Usuário não autenticado");

    const batch = writeBatch(db);
    let lotRefToUpdate: import("firebase/firestore").DocumentReference | null = null;
    let existingQuantity = 0;

    let q;
    if (lot.locationId) {
        q = query(
          collection(db, "lots"),
          where("productId", "==", lot.productId),
          where("lotNumber", "==", lot.lotNumber),
          where("expiryDate", "==", lot.expiryDate),
          where("kioskId", "==", lot.kioskId),
          where("locationId", "==", lot.locationId)
        );
    } else {
        q = query(
          collection(db, "lots"),
          where("productId", "==", lot.productId),
          where("lotNumber", "==", lot.lotNumber),
          where("expiryDate", "==", lot.expiryDate),
          where("kioskId", "==", lot.kioskId),
          where("locationId", "==", null)
        );
    }

    try {
        const querySnapshot = await getDocs(q);
        let lotIdForHistory: string;
        
        if (!querySnapshot.empty) {
            const existingDoc = querySnapshot.docs[0];
            lotRefToUpdate = existingDoc.ref;
            existingQuantity = (existingDoc.data() as LotEntry).quantity;
            lotIdForHistory = existingDoc.id;
            batch.update(lotRefToUpdate, {
                quantity: existingQuantity + lot.quantity,
                imageUrl: lot.imageUrl || (existingDoc.data() as LotEntry).imageUrl,
            });
        } else {
            const newLotRef = doc(collection(db, "lots"));
            lotIdForHistory = newLotRef.id;
            batch.set(newLotRef, lot);
        }

        const movementRecord: Omit<MovementRecord, 'id'> = {
            lotId: lotIdForHistory,
            productId: lot.productId,
            productName: lot.productName,
            lotNumber: lot.lotNumber,
            type: 'ENTRADA',
            quantityChange: lot.quantity,
            toKioskId: lot.kioskId,
            userId: user.id,
            username: user.username,
            timestamp: new Date().toISOString(),
            notes: 'Criação de novo lote no sistema.',
        };
        addMovementRecord(batch, movementRecord);

        await batch.commit();

    } catch (error) {
        console.error("Error adding lot:", error);
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

 const moveMultipleLots = useCallback(async (paramsArray: MoveLotParams[], user: User) => {
    try {
      await runTransaction(db, async (transaction) => {
          for (const params of paramsArray) {
              const { lotId, toKioskId, quantityToMove, fromKioskId, productName, lotNumber, toKioskName, fromKioskName } = params;
              const sourceLotRef = doc(db, "lots", lotId);
              const sourceLotDoc = await transaction.get(sourceLotRef);

              if (!sourceLotDoc.exists()) throw new Error(`Lote de origem ${lotId} não encontrado.`);
              
              const sourceLot = { id: sourceLotDoc.id, ...sourceLotDoc.data() } as LotEntry;

              if (sourceLot.quantity < quantityToMove) {
                  throw new Error(`Quantidade inválida para o lote ${lotId}: mover ${quantityToMove} > disponível ${sourceLot.quantity}.`);
              }

              const newSourceQuantity = sourceLot.quantity - quantityToMove;
              const newReservedQuantity = (sourceLot.reservedQuantity || 0) - quantityToMove;

              transaction.update(sourceLotRef, { 
                  quantity: newSourceQuantity,
                  reservedQuantity: Math.max(0, newReservedQuantity), // Garante que não fique negativo
              });

              const destQuery = query(
                collection(db, "lots"),
                where("productId", "==", sourceLot.productId),
                where("lotNumber", "==", sourceLot.lotNumber),
                where("kioskId", "==", toKioskId)
              );
              const destSnap = await getDocs(destQuery);
              const destDoc = destSnap.docs.find(d => !d.data().locationId) || (destSnap.empty ? null : destSnap.docs[0]);

              let destLotId;
              if (destDoc) {
                  destLotId = destDoc.id;
                  transaction.update(destDoc.ref, { quantity: increment(quantityToMove) });
              } else {
                  const newDestLotRef = doc(collection(db, "lots"));
                  destLotId = newDestLotRef.id;
                  const newLotData: Omit<LotEntry, 'id'> = {
                      productId: sourceLot.productId,
                      productName: sourceLot.productName,
                      lotNumber: sourceLot.lotNumber,
                      expiryDate: sourceLot.expiryDate,
                      kioskId: toKioskId,
                      quantity: quantityToMove,
                      reservedQuantity: 0,
                      imageUrl: sourceLot.imageUrl,
                      locationId: null,
                      locationName: null,
                      locationCode: null,
                  };
                  transaction.set(newDestLotRef, newLotData);
              }

              const now = new Date().toISOString();
              const commonData = {
                  productId: sourceLot.productId,
                  productName: productName,
                  lotNumber: lotNumber,
                  quantityChange: quantityToMove,
                  userId: user.id,
                  username: user.username,
                  timestamp: now
              };
              
              const movementOutRef = doc(collection(db, "movementHistory"));
              transaction.set(movementOutRef, { ...commonData, lotId: sourceLot.id, type: 'TRANSFERENCIA_SAIDA', fromKioskId, fromKioskName, toKioskId, toKioskName });
              
              const movementInRef = doc(collection(db, "movementHistory"));
              transaction.set(movementInRef, { ...commonData, lotId: destLotId, type: 'TRANSFERENCIA_ENTRADA', fromKioskId, fromKioskName, toKioskId, toKioskName });
          }
      });
    } catch (error) {
      console.error("Error moving multiple lots:", error);
      throw error;
    }
  }, []);

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
        if(params.quantityToConsume > currentLot.quantity) {
            throw new Error("Quantidade a ser baixada é maior que o estoque.");
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

        const movementRef = doc(collection(db, 'movementHistory'));
        transaction.set(movementRef, movementRecord);
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

        const movementRef = doc(collection(db, 'movementHistory'));
        transaction.set(movementRef, movementRecord);
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
