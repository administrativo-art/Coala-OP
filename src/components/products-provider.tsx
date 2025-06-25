"use client";

import React, { createContext, useState, useEffect, useCallback } from 'react';
import { type Product } from '@/types';
import { db } from '@/lib/firebase';
import { collection, onSnapshot, addDoc, updateDoc, deleteDoc, doc, query } from 'firebase/firestore';

export interface ProductsContextType {
  products: Product[];
  loading: boolean;
  addProduct: (product: Omit<Product, 'id'>) => Promise<void>;
  updateProduct: (updatedProduct: Product) => Promise<void>;
  deleteProduct: (productId: string) => Promise<void>;
  getProductFullName: (product: Product) => string;
}

export const ProductsContext = createContext<ProductsContextType | undefined>(undefined);

export function ProductsProvider({ children }: { children: React.ReactNode }) {
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const q = query(collection(db, "products"));
    const unsubscribe = onSnapshot(q, (querySnapshot) => {
        const productsData = querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Product));
        setProducts(productsData);
        setLoading(false);
    }, (error) => {
        console.error("Error fetching products from Firestore: ", error);
        setLoading(false);
    });

    return () => unsubscribe();
  }, []);

  const addProduct = useCallback(async (product: Omit<Product, 'id'>) => {
    try {
        await addDoc(collection(db, "products"), product);
    } catch(error) {
        console.error("Error adding product:", error);
    }
  }, []);

  const updateProduct = useCallback(async (updatedProduct: Product) => {
    const productRef = doc(db, "products", updatedProduct.id);
    const { id, ...dataToUpdate } = updatedProduct;
    try {
        await updateDoc(productRef, dataToUpdate);
    } catch(error) {
        console.error("Error updating product:", error);
    }
  }, []);

  const deleteProduct = useCallback(async (productId: string) => {
    try {
        await deleteDoc(doc(db, "products", productId));
    } catch (error) {
        console.error("Error deleting product:", error);
    }
  }, []);
  
  const getProductFullName = useCallback((product: Product) => {
    if (!product) return '';
    return `${product.baseName} (${product.packageSize}${product.unit})`;
  }, []);

  const value: ProductsContextType = {
    products,
    loading,
    addProduct,
    updateProduct,
    deleteProduct,
    getProductFullName,
  };

  return <ProductsContext.Provider value={value}>{children}</ProductsContext.Provider>;
}
