'use server';
/**
 * @fileOverview An AI agent that analyzes product consumption from PDF reports.
 *
 * - analyzeConsumption - A function that handles the consumption analysis process.
 */

import { ai } from '@/ai/genkit';
import { z } from 'zod';
import { type Product } from '@/types';

// Zod schema that mirrors the Product type from src/types/index.ts for validation
const ProductSchema = z.object({
  id: z.string(),
  baseName: z.string(),
  category: z.enum(['Volume', 'Massa', 'Comprimento', 'Unidade']),
  packageSize: z.number(),
  unit: z.string(),
  pdfUnit: z.string().optional(),
  hasPurchaseUnit: z.boolean().optional(),
  purchaseUnitName: z.string().optional(),
  itemsPerPurchaseUnit: z.number().optional(),
  stockLevels: z.record(z.string(), z.object({ min: z.number(), max: z.number() })).optional(),
});

const AnalyzeConsumptionInputSchema = z.object({
  reportName: z.string(),
  pdfDataUri: z.string().describe("A PDF file of a consumption/sales report, as a data URI that must include a MIME type and use Base64 encoding. Expected format: 'data:<mimetype>;base64,<encoded_data>'."),
  month: z.number().min(1).max(12),
  year: z.number(),
  products: z.array(ProductSchema).describe("The list of products to be considered in the analysis, including their packaging configuration."),
});
type AnalyzeConsumptionInput = z.infer<typeof AnalyzeConsumptionInputSchema>;


const ConsumptionAnalysisItemSchema = z.object({
  productId: z.string(),
  productName: z.string(),
  consumedQuantity: z.number().describe("The total quantity consumed in the product's base unit (e.g., L, kg, un)."),
  consumedPackages: z.number().describe("The number of individual packages consumed."),
});

const AnalyzeConsumptionOutputSchema = z.object({
  reportName: z.string(),
  month: z.number(),
  year: z.number(),
  results: z.array(ConsumptionAnalysisItemSchema),
});
type AnalyzeConsumptionOutput = z.infer<typeof AnalyzeConsumptionOutputSchema>;


export async function analyzeConsumption(input: AnalyzeConsumptionInput): Promise<AnalyzeConsumptionOutput> {
  return analyzeConsumptionFlow(input);
}


const analyzeConsumptionPrompt = ai.definePrompt({
  name: 'analyzeConsumptionPrompt',
  input: { schema: AnalyzeConsumptionInputSchema },
  output: { schema: AnalyzeConsumptionOutputSchema },
  prompt: `
    You are an expert inventory analyst for a franchise of smoothie kiosks called "Coala Shakes".
    Your task is to analyze a consumption or sales report for a specific month and year and determine how much of each product was used.

    Here are the business rules:
    1.  **Match Products:** For each product mentioned in the PDF report, find its corresponding entry in the provided \`products\` configuration list. The primary matching key is the product name (\`baseName\`).
    2.  **Extract Consumption:** Extract the total quantity consumed for each matched product from the PDF. The quantity in the PDF might be in a different unit (e.g., 'ml') than the product's main packaging unit (e.g., 'L'). Use the \`pdfUnit\` and \`unit\` fields from the product configuration to perform any necessary conversions.
    3.  **Calculate Total Consumed Quantity:** The final \`consumedQuantity\` for each product must be in its base unit as defined in its configuration (e.g., L, kg, un).
    4.  **Calculate Consumed Packages:** Based on the total \`consumedQuantity\`, calculate the \`consumedPackages\`. This is the number of individual packages sold or used. To calculate this, divide the total \`consumedQuantity\` by the product's \`packageSize\`. Round the result to the nearest whole number.
    5.  **Output Format:** Your final output MUST be a JSON object that strictly follows the provided output schema. Include the original report name, month, and year in your response. The \`results\` array should contain an entry for every product found in the report.

    **CONFIGURATION DATA:**
    - All Products to look for, with their packaging configurations: {{{json products}}}

    **REPORT TO ANALYZE:**
    - Report Name: {{{reportName}}}
    - Month: {{{month}}}
    - Year: {{{year}}}
    - PDF Content: {{media url=pdfDataUri}}
  `,
});


const analyzeConsumptionFlow = ai.defineFlow(
  {
    name: 'analyzeConsumptionFlow',
    inputSchema: AnalyzeConsumptionInputSchema,
    outputSchema: AnalyzeConsumptionOutputSchema,
  },
  async (input) => {
    const { output } = await analyzeConsumptionPrompt(input);
    return output!;
  }
);
