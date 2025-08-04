
'use server';
/**
 * @fileOverview A flow to fetch product information from the Open Food Facts API using a barcode.
 * 
 * - fetchProductInfo - A function that fetches product data.
 * - ProductInfoInput - The input type for the fetchProductInfo function.
 * - ProductInfoOutput - The return type for the fetchProductInfo function.
 */

import { ai } from '@/ai/genkit';
import { z } from 'zod';

const ProductInfoInputSchema = z.string();
export type ProductInfoInput = z.infer<typeof ProductInfoInputSchema>;

const ProductInfoOutputSchema = z.object({
  found: z.boolean(),
  name: z.string().optional(),
  brand: z.string().optional(),
  packageSize: z.number().optional(),
  unit: z.string().optional(),
  imageUrl: z.string().optional(),
});
export type ProductInfoOutput = z.infer<typeof ProductInfoOutputSchema>;

export async function fetchProductInfo(barcode: ProductInfoInput): Promise<ProductInfoOutput> {
  return fetchProductInfoFlow(barcode);
}

const fetchProductInfoFlow = ai.defineFlow(
  {
    name: 'fetchProductInfoFlow',
    inputSchema: ProductInfoInputSchema,
    outputSchema: ProductInfoOutputSchema,
  },
  async (barcode) => {
    const url = `https://world.openfoodfacts.org/api/v2/product/${barcode}.json`;

    try {
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`API request failed with status ${response.status}`);
      }
      const data = await response.json();

      if (data.status === 0 || !data.product) {
        return { found: false };
      }

      const product = data.product;
      let packageSize: number | undefined;
      let unit: string | undefined;

      // Attempt to parse quantity like "500 g"
      if (product.quantity) {
        const quantityStr = String(product.quantity);
        const match = quantityStr.match(/([\d.,]+)\s*(\w+)/);
        if (match) {
          packageSize = parseFloat(match[1].replace(',', '.'));
          const rawUnit = match[2].toLowerCase();
          
          if (['g', 'gram', 'grams'].includes(rawUnit)) unit = 'g';
          else if (['kg', 'kilogram', 'kilograms'].includes(rawUnit)) unit = 'kg';
          else if (['ml', 'milliliter', 'milliliters'].includes(rawUnit)) unit = 'mL';
          else if (['l', 'liter', 'liters'].includes(rawUnit)) unit = 'L';
          else if (['un', 'unit', 'units'].includes(rawUnit)) unit = 'un';
        }
      }

      return {
        found: true,
        name: product.product_name || product.generic_name || undefined,
        brand: product.brands || undefined,
        packageSize: packageSize,
        unit: unit,
        imageUrl: product.image_url || undefined,
      };

    } catch (error) {
      console.error('Error fetching product info from Open Food Facts:', error);
      // Return found: false on any error to ensure graceful failure
      return { found: false };
    }
  }
);
