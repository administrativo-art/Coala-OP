
"use client";

import React, { createContext, useState, useEffect, useCallback } from 'react';
import { type Product, type ProductDefinition } from '@/types';
import { db } from '@/lib/firebase';
import { collection, onSnapshot, addDoc, updateDoc, deleteDoc, doc, query, writeBatch, where, getDocs } from 'firebase/firestore';

export interface ProductsContextType {
  products: Product[];
  loading: boolean;
  addProduct: (product: Omit<Product, 'id'>) => Promise<void>;
  updateProduct: (updatedProduct: Product) => Promise<void>;
  deleteProduct: (productId: string) => Promise<void>;
  getProductFullName: (product: Product) => string;
  updateMultipleProducts: (products: Partial<Product>[]) => Promise<void>;
  findOrCreateProduct: (productDef: ProductDefinition) => Promise<Product | null>;
}

export const ProductsContext = createContext<ProductsContextType | undefined>(undefined);

export function ProductsProvider({ children }: { children: React.ReactNode }) {
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const q = query(collection(db, "products"));
    const unsubscribe = onSnapshot(q, async (querySnapshot) => {
        if (querySnapshot.empty && !localStorage.getItem('products_seeded')) {
          console.log("No products found. Seeding default products...");
          
          const batch = writeBatch(db);

          const defaultProducts: Omit<Product, 'id'>[] = [
            { baseName: 'Leite Integral', category: 'Volume', packageSize: 1, unit: 'L', urgentThreshold: 7, alertThreshold: 15 },
            { baseName: 'Chocolate em Pó', category: 'Massa', packageSize: 400, unit: 'g', urgentThreshold: 30, alertThreshold: 60 },
            { baseName: 'Açúcar Refinado', category: 'Massa', packageSize: 1, unit: 'kg', urgentThreshold: 60, alertThreshold: 90 },
            { baseName: 'Polpa de Morango', category: 'Volume', packageSize: 500, unit: 'mL', urgentThreshold: 5, alertThreshold: 10 },
            { baseName: 'Ovomaltine', category: 'Massa', packageSize: 250, unit: 'g' },
            { baseName: 'Ovomaltine', category: 'Massa', packageSize: 500, unit: 'g' },
            { baseName: 'Ovomaltine', category: 'Massa', packageSize: 750, unit: 'g' },
            { baseName: 'Queijo Minas', category: 'Massa', packageSize: 1, unit: 'kg' },
          ];

          defaultProducts.forEach(product => {
            const docRef = doc(collection(db, "products"));
            batch.set(docRef, product);
          });
          
          try {
            await batch.commit();
            localStorage.setItem('products_seeded', 'true');
          } catch(seedError) {
            console.error("Error seeding products:", seedError);
          }
          return;
        }

        const productsData = querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Product));
        setProducts(productsData.sort((a,b) => a.baseName.localeCompare(b.baseName)));
        setLoading(false);
    }, (error) => {
        console.error("Error fetching products from Firestore: ", error);
        setLoading(false);
    });

    return () => unsubscribe();
  }, []);

  const findOrCreateProduct = useCallback(async (productDef: ProductDefinition): Promise<Product | null> => {
    const q = query(
        collection(db, "products"),
        where("baseName", "==", productDef.baseName),
        where("packageSize", "==", productDef.packageSize),
        where("unit", "==", productDef.unit)
    );

    try {
        const querySnapshot = await getDocs(q);
        if (!querySnapshot.empty) {
            const existingDoc = querySnapshot.docs[0];
            return { id: existingDoc.id, ...existingDoc.data() } as Product;
        } else {
            const docRef = await addDoc(collection(db, "products"), productDef);
            return { id: docRef.id, ...productDef } as Product;
        }
    } catch (error) {
        console.error("Error finding or creating product:", error);
        return null;
    }
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
  
  const updateMultipleProducts = useCallback(async (productsToUpdate: Partial<Product>[]) => {
    const batch = writeBatch(db);
    productsToUpdate.forEach(product => {
      if(product.id) {
        const productRef = doc(db, "products", product.id);
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
    updateMultipleProducts,
    findOrCreateProduct,
  };

  return <ProductsContext.Provider value={value}>{children}</ProductsContext.Provider>;
}
