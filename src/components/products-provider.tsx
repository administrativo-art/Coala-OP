

"use client";

import React, { createContext, useState, useEffect, useCallback, useMemo } from 'react';
import { type Product, type ProductDefinition, unitCategories, type UnitCategory } from '@/types';
import { useAuth } from '@/hooks/use-auth';
import { db } from '@/lib/firebase';
import { collection, onSnapshot, addDoc, updateDoc, deleteDoc, doc, query, writeBatch, where, getDocs } from 'firebase/firestore';

export interface ProductsContextType {
  products: Product[];
  loading: boolean;
  addProduct: (product: Omit<Product, 'id'>) => Promise<void>;
  updateProduct: (updatedProduct: Product) => Promise<void>;
  deleteProduct: (productId: string) => Promise<void>;
  deleteMultipleProducts: (productIds: string[]) => Promise<void>;
  getProductFullName: (product: Product | null | undefined) => string;
  updateMultipleProducts: (products: Partial<Product>[]) => Promise<void>;
  findOrCreateProduct: (productDef: ProductDefinition) => Promise<Product | null>;
}

export const ProductsContext = createContext<ProductsContextType | undefined>(undefined);

const cleanUndefinedFields = (data: Record<string, any>) => {
    const cleanedData = { ...data };
    Object.keys(cleanedData).forEach(key => {
        if (cleanedData[key] === undefined) {
            delete cleanedData[key];
        }
    });
    return cleanedData;
};

export function ProductsProvider({ children }: { children: React.ReactNode }) {
  const [products, setProducts] = useState<Product[]>([]);
  const { firebaseUser } = useAuth();
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
    if (!firebaseUser) throw new Error('Usuário não autenticado.');
    const q = query(
        collection(db, "products"),
        where("baseName", "==", productDef.baseName),
        where("packageSize", "==", productDef.packageSize || 1),
        where("unit", "==", productDef.unit)
    );

    try {
        const querySnapshot = await getDocs(q);
        if (!querySnapshot.empty) {
            const existingDoc = querySnapshot.docs[0];
            return { id: existingDoc.id, ...existingDoc.data() } as Product;
        } else {
            const token = await firebaseUser.getIdToken();
            const response = await fetch('/api/registry/products', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${token}`,
                },
                body: JSON.stringify(productDef),
            });
            if (!response.ok) throw new Error('Falha ao criar produto.');
            const { id } = await response.json();
            return { id, ...productDef } as Product;
        }
    } catch (error) {
        console.error("Error finding or creating product:", error);
        return null;
    }
  }, [firebaseUser]);

  const addProduct = useCallback(async (product: Omit<Product, 'id'>) => {
    if (!firebaseUser) throw new Error('Usuário não autenticado.');
    const token = await firebaseUser.getIdToken();
    const response = await fetch('/api/registry/products', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(product),
    });
    if (!response.ok) throw new Error('Falha ao adicionar produto.');
  }, [firebaseUser]);

  const updateProduct = useCallback(async (updatedProduct: Product) => {
    if (!firebaseUser) throw new Error('Usuário não autenticado.');
    const { id, ...dataToUpdate } = updatedProduct;
    const token = await firebaseUser.getIdToken();
    const response = await fetch(`/api/registry/products/${id}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(dataToUpdate),
    });
    if (!response.ok) throw new Error('Falha ao atualizar produto.');
  }, [firebaseUser]);

  const updateMultipleProducts = useCallback(async (productsToUpdate: Partial<Product>[]) => {
    if (!firebaseUser) throw new Error('Usuário não autenticado.');
    const token = await firebaseUser.getIdToken();
    // Simplified: loop for now, or could add a batch endpoint to the API
    await Promise.all(productsToUpdate.map(async (product) => {
      const { id, ...data } = product;
      if (!id) return;
      return fetch(`/api/registry/products/${id}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(data),
      });
    }));
  }, [firebaseUser]);

  const deleteProduct = useCallback(async (productId: string) => {
    if (!firebaseUser) throw new Error('Usuário não autenticado.');
    const token = await firebaseUser.getIdToken();
    const response = await fetch(`/api/registry/products/${productId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!response.ok) throw new Error('Falha ao deletar produto.');
  }, [firebaseUser]);

  const deleteMultipleProducts = useCallback(async (productIds: string[]) => {
    if (!firebaseUser) throw new Error('Usuário não autenticado.');
    const token = await firebaseUser.getIdToken();
    await Promise.all(productIds.map(id => 
      fetch(`/api/registry/products/${id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      })
    ));
  }, [firebaseUser]);
  
  const getProductFullName = useCallback((product: Product | null | undefined) => {
    if (!product) return '';
    const brandPart = product.brand ? ` - ${product.brand}` : '';
    const base = `${product.baseName}${brandPart}`;
    const packagePart = product.packageSize && product.unit ? ` (${product.packageSize}${product.unit})` : '';
    return `${base}${packagePart}`;
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
