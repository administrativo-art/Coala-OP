
'use server';
/**
 * @fileOverview An AI agent that analyzes stock reports from PDF files.
 *
 * - analyzeStock - A function that handles the stock analysis process.
 */

import { ai } from '@/ai/genkit';
import { z } from 'zod';
import { type Product, type Kiosk } from '@/types';
import { convertValue } from '@/lib/conversion';

// Zod schemas that mirror the types from src/types/index.ts for validation
const KioskSchema = z.object({
  id: z.string(),
  name: z.string(),
});

const ProductSchema = z.object({
  id: z.string(),
  baseName: z.string(),
  category: z.enum(['Volume', 'Massa', 'Comprimento', 'Unidade']),
  packageSize: z.number(),
  unit: z.string(),
  pdfUnit: z.string().optional(),
  stockLevels: z.record(z.string(), z.object({ min: z.number(), max: z.number() })).optional(),
});

const AnalyzeStockInputSchema = z.object({
  reportName: z.string(),
  pdfDataUri: z.string().describe("A PDF file of a stock report, as a data URI that must include a MIME type and use Base64 encoding. Expected format: 'data:<mimetype>;base64,<encoded_data>'."),
  products: z.array(ProductSchema).describe("The list of products to be considered in the analysis, including their configuration."),
  kiosks: z.array(KioskSchema).describe("The list of all available kiosks."),
});
type AnalyzeStockInput = z.infer<typeof AnalyzeStockInputSchema>;

const StockAnalysisItemSchema = z.object({
  productId: z.string(),
  productName: z.string(),
  kioskId: z.string(),
  kioskName: z.string(),
  currentStockInBaseUnit: z.number(),
  maxStockInBaseUnit: z.number(),
  neededInBaseUnit: z.number(),
});

const AnalyzeStockOutputSchema = z.object({
  reportName: z.string(),
  summary: z.string().describe("A concise summary of the analysis findings, e.g., '3 products need replenishment across 2 kiosks.'"),
  results: z.array(StockAnalysisItemSchema),
});
type AnalyzeStockOutput = z.infer<typeof AnalyzeStockOutputSchema>;


export async function analyzeStock(input: AnalyzeStockInput): Promise<AnalyzeStockOutput> {
  return analyzeStockFlow(input);
}


const analyzeStockPrompt = ai.definePrompt({
  name: 'analyzeStockPrompt',
  input: { schema: AnalyzeStockInputSchema },
  output: { schema: AnalyzeStockOutputSchema },
  prompt: `
    You are an expert inventory analyst for a franchise of smoothie kiosks called "Coala Shakes".
    Your task is to analyze a stock report provided as a PDF and determine replenishment needs in the product's BASE UNIT (like grams or liters).

    Here are the business rules:
    1.  **Identify Kiosk:** The PDF is for a specific kiosk. Identify which kiosk the stock report belongs to by matching names from the PDF with the provided \`kiosks\` list.
    2.  **Match Products & Extract Stock:** For each product listed in the PDF, find a matching product from the provided \`products\` configuration list using the product name (\`baseName\`).
    3.  **Calculate Current Stock in Base Unit:** Extract the current stock quantity for each matched product from the PDF. The PDF may list quantities in a specific unit (e.g., 'ml') or as a count of packages. Use the \`pdfUnit\` field from the product configuration to correctly interpret the PDF quantity. Convert this quantity to the product's main base unit (e.g., convert 'ml' to 'L', 'g' to 'kg'). The final \`currentStockInBaseUnit\` MUST be in this base unit.
        - **IMPORTANT**: If a product's \`packageSize\` is exactly \`1\`, it represents a generic, non-packaged item. In this case, you MUST assume the quantity found in the PDF is already in the product's base \`unit\`. Do NOT attempt to multiply by package size.
        - If the product's \`packageSize\` is greater than \`1\`, and the PDF gives a number of packages (e.g., "10 caixas"), multiply that number by the product's \`packageSize\` to get the total in the base unit.
    4.  **Calculate Needs:** For each product and kiosk combination found in the PDF, calculate the replenishment need. A product needs replenishment **only if** its \`currentStockInBaseUnit\` is **BELOW** the configured \`min\` stock level for that kiosk.
        - If \`currentStockInBaseUnit\` is less than the configured \`min\`, then the \`neededInBaseUnit\` is the difference between the \`max\` stock level and the \`currentStockInBaseUnit\`.
        - If \`currentStockInBaseUnit\` is at or above the \`min\` level, then the \`neededInBaseUnit\` is **exactly 0**.
        - The \`maxStockInBaseUnit\` is the \`max\` value from the configuration.
    5.  **Filter Results:** CRITICAL: The final \`results\` array in your JSON output MUST ONLY contain products where \`neededInBaseUnit\` is strictly greater than 0. If a product's \`neededInBaseUnit\` is 0, it MUST be excluded from the \`results\` array.
    6.  **Summarize:** Create a concise \`summary\` based on the FINAL filtered results. For example, "3 produtos precisam de reposição em 2 quiosques.". If the final \`results\` array is empty, the summary must state that nothing needs replenishment.
    7.  **Output Format:** Your final output MUST be a JSON object that strictly follows the provided output schema.

    **CONFIGURATION DATA:**
    - All available Kiosks: {{{json kiosks}}}
    - All Products to look for, with their configurations (min/max stock levels are per-kiosk): {{{json products}}}

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
