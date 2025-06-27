'use server';
/**
 * @fileOverview An AI agent that analyzes stock reports from PDF files.
 *
 * - analyzeStock - A function that handles the stock analysis process.
 * - AnalyzeStockInput - The input type for the analyzeStock function.
 * - AnalyzeStockOutput - The return type for the analyzeStock function.
 */

import { ai } from '@/ai/genkit';
import { z } from 'genkit';
import { type Product, type Kiosk } from '@/types';

// Zod schemas that mirror the types from src/types/index.ts for validation
const KioskSchema = z.object({
  id: z.string(),
  name: z.string(),
});

const ProductSchema = z.object({
  id: z.string(),
  baseName: z.string(),
  category: z.enum(['Volume', 'Massa', 'Comprimento']),
  packageSize: z.number(),
  unit: z.string(),
  pdfUnit: z.string().optional(),
  hasPurchaseUnit: z.boolean().optional(),
  purchaseUnitName: z.string().optional(),
  itemsPerPurchaseUnit: z.number().optional(),
  stockLevels: z.record(z.string(), z.object({ min: z.number(), max: z.number() })).optional(),
});

const AnalyzeStockInputSchema = z.object({
  reportName: z.string(),
  pdfDataUri: z.string().describe("A PDF file of a stock report, as a data URI that must include a MIME type and use Base64 encoding. Expected format: 'data:<mimetype>;base64,<encoded_data>'."),
  products: z.array(ProductSchema).describe("The list of products to be considered in the analysis, including their configuration."),
  kiosks: z.array(KioskSchema).describe("The list of all available kiosks."),
});
export type AnalyzeStockInput = z.infer<typeof AnalyzeStockInputSchema>;

const StockAnalysisResultItemSchema = z.object({
  productId: z.string(),
  productName: z.string(),
  kioskId: z.string(),
  kioskName: z.string(),
  currentStock: z.number(),
  idealStock: z.number(),
  needed: z.number(),
  purchaseSuggestion: z.string(),
});

const AnalyzeStockOutputSchema = z.object({
  reportName: z.string(),
  summary: z.string().describe("A concise summary of the analysis findings, e.g., '3 products need replenishment across 2 kiosks.'"),
  results: z.array(StockAnalysisResultItemSchema),
});
export type AnalyzeStockOutput = z.infer<typeof AnalyzeStockOutputSchema>;


export async function analyzeStock(input: AnalyzeStockInput): Promise<AnalyzeStockOutput> {
  return analyzeStockFlow(input);
}


const analyzeStockPrompt = ai.definePrompt({
  name: 'analyzeStockPrompt',
  input: { schema: AnalyzeStockInputSchema },
  output: { schema: AnalyzeStockOutputSchema },
  prompt: `
    You are an expert inventory analyst for a franchise of smoothie kiosks called "Coala Shakes".
    Your task is to analyze a stock report provided as a PDF and determine replenishment needs based on a given configuration.

    Here are the business rules:
    1.  **Match Products:** For each product listed in the PDF, find a matching product from the provided \`products\` configuration list. The primary matching key is the product name (\`baseName\`).
    2.  **Extract Stock:** Extract the current stock quantity for each matched product from the PDF. The PDF may list quantities in a different unit (e.g., 'ml') than the product's packaging unit (e.g., 'L'). Use the \`pdfUnit\` field from the product configuration to correctly interpret the PDF quantity, then convert it to the product's main \`unit\`.
    3.  **Identify Kiosk:** The PDF is for a specific kiosk. Identify which kiosk the stock report belongs to by matching names from the PDF with the provided \`kiosks\` list.
    4.  **Calculate Needs:** For each product and kiosk combination found in the PDF, calculate the replenishment need. A product needs replenishment only if its \`currentStock\` is BELOW the configured \`min\` stock level for that kiosk.
        - The \`needed\` quantity is the difference between the \`max\` stock level and the \`currentStock\`.
        - If \`currentStock\` is at or above the \`min\` level, the \`needed\` quantity is 0.
        - The \`idealStock\` is the \`max\` value from the configuration.
    5.  **Generate Purchase Suggestion:**
        - If the product's \`hasPurchaseUnit\` flag is true, calculate how many purchase units (e.g., 'Caixas') are needed. The number of purchase units should be rounded UP to the nearest whole number to ensure the \`needed\` quantity is met. The suggestion must be a string like "Comprar 3 Caixas".
        - If the product does not have a purchase unit, the suggestion should be the \`needed\` quantity and its base unit, like "Comprar 35 L".
    6.  **Filter Results:** Your final output in the \`results\` array should ONLY include products that require replenishment (where \`needed\` > 0).
    7.  **Summarize:** Create a concise \`summary\` of the findings, like "3 produtos precisam de reposição em 2 quiosques.". If nothing is needed, say so.
    8.  **Output Format:** Your final output MUST be a JSON object that strictly follows the provided output schema.

    **CONFIGURATION DATA:**
    - All available Kiosks: {{{json kiosks}}}
    - All Products to look for, with their configurations: {{{json products}}}

    **REPORT TO ANALYZE:**
    - Report Name: {{{reportName}}}
    - PDF Content: {{media url=pdfDataUri}}
  `,
});


const analyzeStockFlow = ai.defineFlow(
  {
    name: 'analyzeStockFlow',
    inputSchema: AnalyzeStockInputSchema,
    outputSchema: AnalyzeStockOutputSchema,
  },
  async (input) => {
    const { output } = await analyzeStockPrompt(input);
    return output!;
  }
);
