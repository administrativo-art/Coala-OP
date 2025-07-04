
'use server';
/**
 * @fileOverview An AI agent that analyzes product consumption from PDF reports.
 *
 * - analyzeConsumption - A function that handles the consumption analysis process.
 */

import { ai } from '@/ai/genkit';
import { z } from 'zod';
import { type Product } from '@/types';
import { convertValue } from '@/lib/conversion';

// Zod schema that mirrors the Product type from src/types/index.ts for validation
const ProductSchema = z.object({
  id: z.string(),
  baseName: z.string(),
  category: z.enum(['Volume', 'Massa', 'Comprimento', 'Unidade']),
  unit: z.string(),
  pdfUnit: z.string().optional(),
  stockLevels: z.record(z.string(), z.object({ min: z.number(), max: z.number() })).optional(),
});

const AnalyzeConsumptionInputSchema = z.object({
  reportName: z.string(),
  pdfDataUri: z.string().describe("A PDF file of a consumption/sales report, as a data URI that must include a MIME type and use Base64 encoding. Expected format: 'data:<mimetype>;base64,<encoded_data>'."),
  month: z.number().min(1).max(12),
  year: z.number(),
  kioskId: z.string(),
  kioskName: z.string(),
  products: z.array(ProductSchema).describe("The list of products to be considered in the analysis, including their base unit configuration."),
});
type AnalyzeConsumptionInput = z.infer<typeof AnalyzeConsumptionInputSchema>;


const ConsumptionAnalysisItemSchema = z.object({
  productId: z.string(),
  productName: z.string(),
  consumedQuantity: z.number().describe("The total quantity consumed in the product's base unit (e.g., L, kg, un)."),
});

const AnalyzeConsumptionOutputSchema = z.object({
  reportName: z.string(),
  month: z.number(),
  year: z.number(),
  kioskId: z.string(),
  kioskName: z.string(),
  results: z.array(ConsumptionAnalysisItemSchema),
});
type AnalyzeConsumptionOutput = z.infer<typeof AnalyzeConsumptionOutputSchema>;


export async function analyzeConsumption(input: AnalyzeConsumptionInput): Promise<AnalyzeConsumptionOutput> {
  return analyzeConsumptionFlow(input);
}


// NEW: Define the schema for the data extraction prompt.
const ExtractedItemSchema = z.object({
  name: z.string().describe("The name of the item as it appears in the report."),
  quantity: z.string().describe("The consumed quantity as a string, including the unit (e.g., '1.5 kg', '750g')."),
});

const DataExtractionOutputSchema = z.object({
  items: z.array(ExtractedItemSchema),
});

// NEW: Define the data extraction prompt.
const extractConsumptionDataPrompt = ai.definePrompt({
  name: 'extractConsumptionDataPrompt',
  input: { schema: z.object({ pdfDataUri: z.string() }) },
  output: { schema: DataExtractionOutputSchema },
  prompt: `
    You are an expert data extraction bot.
    Your task is to analyze the provided PDF consumption report.
    The report might list items in a format like "PRODUCT NAME (unit) quantity", sometimes with the name split across multiple lines.
    You must extract a list of all consumed items and their corresponding quantities.

    - The 'name' you return should be the product name ONLY (e.g., "FARINHA LÁCTEA", "CHOCOLATE GRANULADO"). Do NOT include the unit in parentheses like "(g)" or "(un)" in the name field.
    - The 'quantity' you return MUST be a string that includes both the number and the corresponding unit (e.g., "0 g", "1.5 kg", "12 un").

    Return the data as a single JSON object that strictly follows the provided output schema.

    PDF Content to Analyze: {{media url=pdfDataUri}}
  `,
});

const normalizeString = (str: string) => {
    if (!str) return '';
    return str
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase()
        .trim();
};

const parseQuantityString = (quantityStr: string, productConfig: Product): { value: number; unit: string } | null => {
    if (!quantityStr && quantityStr !== "0") return null;

    // Regex to capture number (integer or decimal) and an OPTIONAL unit
    const match = quantityStr.match(/^(-?\d*[\.,]?\d+)\s*(\w*)/);
    if (!match) return null;

    const valueStr = match[1].replace(',', '.');
    const value = parseFloat(valueStr);
    let unit = match[2];

    if (isNaN(value)) return null;

    // If unit was not found in the string, use the product's configured pdfUnit or base unit
    if (!unit) {
        unit = productConfig.pdfUnit || productConfig.unit;
    }

    return { value, unit };
}


const analyzeConsumptionFlow = ai.defineFlow(
  {
    name: 'analyzeConsumptionFlow',
    inputSchema: AnalyzeConsumptionInputSchema,
    outputSchema: AnalyzeConsumptionOutputSchema,
  },
  async (input) => {
    // Step 1: Extract raw data from PDF using the new prompt
    const { output: extractionResult } = await extractConsumptionDataPrompt({ pdfDataUri: input.pdfDataUri });

    if (!extractionResult || !extractionResult.items) {
      throw new Error("AI failed to extract any items from the PDF.");
    }
    
    const analysisResults: z.infer<typeof ConsumptionAnalysisItemSchema>[] = [];
    const productMap = new Map(input.products.map(p => [normalizeString(p.baseName), p]));

    // Step 2: Process extracted items in TypeScript
    for (const extractedItem of extractionResult.items) {
      // Clean the name to remove units like (un) or (g) that the AI might still include
      const cleanedName = extractedItem.name.replace(/\s*\([\w\s-]+\)\s*$/, '').trim();
      const normalizedName = normalizeString(cleanedName);
      
      const productConfig = productMap.get(normalizedName);

      if (!productConfig) {
        console.warn(`Unmatched product from report: "${extractedItem.name}" (normalized to "${normalizedName}")`);
        continue; // Skip items from the PDF that are not in our product list
      }

      const parsedQuantity = parseQuantityString(extractedItem.quantity, productConfig);
      
      if (!parsedQuantity) {
        console.warn(`Could not parse quantity for "${extractedItem.name}": "${extractedItem.quantity}"`);
        continue;
      }
      
      const { value: quantityFromPdf, unit: unitFromPdf } = parsedQuantity;
      const baseUnit = productConfig.unit;

      try {
        const consumedQuantityInBaseUnit = convertValue(quantityFromPdf, unitFromPdf, baseUnit, productConfig.category);
        
        analysisResults.push({
          productId: productConfig.id,
          productName: productConfig.baseName,
          consumedQuantity: consumedQuantityInBaseUnit,
        });

      } catch (error) {
         console.error(`Error converting units for ${productConfig.baseName}:`, error);
         continue;
      }
    }
    
    // Step 3: Construct the final output object
    const finalOutput: AnalyzeConsumptionOutput = {
      reportName: input.reportName,
      month: input.month,
      year: input.year,
      kioskId: input.kioskId,
      kioskName: input.kioskName,
      results: analysisResults,
    };
    
    return finalOutput;
  }
);
