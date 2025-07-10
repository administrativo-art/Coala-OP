
"use client";

import React, { createContext, useState, useEffect, useCallback, useMemo } from 'react';
import { type Product, type ProductDefinition, unitCategories, type UnitCategory } from '@/types';
import { db } from '@/lib/firebase';
import { collection, onSnapshot, addDoc, updateDoc, deleteDoc, doc, query, writeBatch, where, getDocs } from 'firebase/firestore';

export interface ProductsContextType {
  products: Product[];
  loading: boolean;
  addProduct: (product: Omit<Product, 'id'>) => Promise<void>;
  updateProduct: (updatedProduct: Product) => Promise<void>;
  deleteProduct: (productId: string) => Promise<void>;
  deleteMultipleProducts: (productIds: string[]) => Promise<void>;
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
        const productsData = querySnapshot.docs.map(doc => {
            const data = doc.data();
            const originalCategory = data.category as string | undefined;
            let category: UnitCategory = 'Unidade'; // Default value

            if (originalCategory) {
                const formatted = originalCategory.charAt(0).toUpperCase() + originalCategory.slice(1).toLowerCase();
                if (unitCategories.includes(formatted as UnitCategory)) {
                    category = formatted as UnitCategory;
                }
            }
            
            return {
                id: doc.id,
                ...data,
                category,
            } as Product
        });
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
        throw error;
    }
  }, []);

  const deleteMultipleProducts = useCallback(async (productIds: string[]) => {
    const batch = writeBatch(db);
    productIds.forEach(productId => {
        const productRef = doc(db, "products", productId);
        batch.delete(productRef);
    });
    try {
        await batch.commit();
    } catch(error) {
        console.error("Error deleting multiple products:", error);
        throw error;
    }
  }, []);
  
  const getProductFullName = useCallback((product: Product) => {
    if (!product) return '';
    const brandPart = product.brand ? ` - ${product.brand}` : '';
    return `${product.baseName}${brandPart}`;
  }, []);

  const value: ProductsContextType = useMemo(() => ({
    products,
    loading,
    addProduct,
    updateProduct,
    deleteProduct,
    deleteMultipleProducts,
    getProductFullName,
    updateMultipleProducts,
    findOrCreateProduct,
  }), [products, loading, addProduct, updateProduct, deleteProduct, deleteMultipleProducts, getProductFullName, updateMultipleProducts, findOrCreateProduct]);

  return <ProductsContext.Provider value={value}>{children}</ProductsContext.Provider>;
}
