
"use client";

import React, { createContext, useState, useEffect, useCallback } from 'react';
import { type Product } from '@/types';
import { db } from '@/lib/firebase';
import { collection, onSnapshot, addDoc, updateDoc, deleteDoc, doc, query, writeBatch } from 'firebase/firestore';

export interface StockAnalysisProductsContextType {
  products: Product[];
  loading: boolean;
  addProduct: (product: Omit<Product, 'id'>) => Promise<void>;
  updateProduct: (updatedProduct: Product) => Promise<void>;
  deleteProduct: (productId: string) => Promise<void>;
  getProductFullName: (product: Product) => string;
  updateMultipleProducts: (products: Partial<Product>[]) => Promise<void>;
}

export const StockAnalysisProductsContext = createContext<StockAnalysisProductsContextType | undefined>(undefined);

export function StockAnalysisProductsProvider({ children }: { children: React.ReactNode }) {
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const q = query(collection(db, "stockAnalysisProducts")); // New collection
    const unsubscribe = onSnapshot(q, async (querySnapshot) => {
        const productsData = querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Product));
        setProducts(productsData.sort((a,b) => a.baseName.localeCompare(b.baseName)));
        setLoading(false);
    }, (error) => {
        console.error("Error fetching stock analysis products from Firestore: ", error);
        setLoading(false);
    });

    return () => unsubscribe();
  }, []);

  const addProduct = useCallback(async (product: Omit<Product, 'id'>) => {
    try {
        await addDoc(collection(db, "stockAnalysisProducts"), product);
    } catch(error) {
        console.error("Error adding product:", error);
    }
  }, []);

  const updateProduct = useCallback(async (updatedProduct: Product) => {
    const productRef = doc(db, "stockAnalysisProducts", updatedProduct.id);
    const { id, ...dataToUpdate } = updatedProduct;
    try {
        await updateDoc(productRef, dataToUpdate);
    } catch(error) {
        console.error("Error updating product:", error);
    }
  }, []);
  
  const updateMultipleProducts = useCallback(async (productsToUpdate: Partial<Product>[]) => {
    const batch = writeBatch(db);
    productsToUpdate.forEach(product => {
      if(product.id) {
        const productRef = doc(db, "stockAnalysisProducts", product.id);
        const { id, ...dataToUpdate } = product;
        batch.update(productRef, dataToUpdate);
      }
    });
    try {
      await batch.commit();
    } catch(error) {
      console.error("Error updating multiple products:", error);
      throw error;
    }
  }, []);

  const deleteProduct = useCallback(async (productId: string) => {
    try {
        await deleteDoc(doc(db, "stockAnalysisProducts", productId));
    } catch (error) {
        console.error("Error deleting product:", error);
    }
  }, []);
  
  const getProductFullName = useCallback((product: Product) => {
    if (!product) return '';
    return `${product.baseName} (${product.packageSize}${product.unit})`;
  }, []);

  const value: StockAnalysisProductsContextType = {
    products,
    loading,
    addProduct,
    updateProduct,
    deleteProduct,
    getProductFullName,
    updateMultipleProducts
  };

  return <StockAnalysisProductsContext.Provider value={value}>{children}</StockAnalysisProductsContext.Provider>;
}
