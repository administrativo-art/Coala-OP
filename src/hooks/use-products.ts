"use client";

import { useState, useEffect, useCallback } from 'react';
import { type Product } from '@/types';

const STORAGE_KEY = 'smart-converter-products';

export function useProducts() {
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    try {
      const items = window.localStorage.getItem(STORAGE_KEY);
      if (items) {
        setProducts(JSON.parse(items));
      }
    } catch (error) {
      console.error('Failed to load products from localStorage', error);
    } finally {
        setLoading(false);
    }
  }, []);

  const saveProducts = useCallback((newProducts: Product[]) => {
    try {
      setProducts(newProducts);
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(newProducts));
    } catch (error) {
      console.error('Failed to save products to localStorage', error);
    }
  }, []);

  const addProduct = useCallback((product: Omit<Product, 'id'>) => {
    const newProduct = { ...product, id: new Date().toISOString() };
    saveProducts([...products, newProduct]);
  }, [products, saveProducts]);

  const updateProduct = useCallback((updatedProduct: Product) => {
    const newProducts = products.map(p => p.id === updatedProduct.id ? updatedProduct : p);
    saveProducts(newProducts);
  }, [products, saveProducts]);

  const deleteProduct = useCallback((productId: string) => {
    const newProducts = products.filter(p => p.id !== productId);
    saveProducts(newProducts);
  }, [products, saveProducts]);
  
  const getProductFullName = useCallback((product: Product) => {
    if (!product) return '';
    return `${product.baseName} (${product.packageSize}${product.unit})`;
  }, []);


  return { products, loading, addProduct, updateProduct, deleteProduct, getProductFullName };
}
