
import { z } from "zod";

// Input schema for a single product's data
const ConsumptionDataItemSchema = z.object({
  name: z.string().describe('The name of the ingredient.'),
  unit: z.string().describe('The base unit of measurement for this ingredient (e.g., g, mL, un).'),
  periodAvg: z.number().describe('The average monthly consumption during the selected period.'),
  histAvg: z.number().describe('The historical average monthly consumption across all available data.'),
  periodChangePct: z.number().describe('The percentage change of the current period\'s average compared to the historical average. Positive means increase, negative means decrease.'),
  volatility: z.string().describe('A qualitative measure of consumption stability (Alta, Média, Baixa).'),
  abcClass: z.string().nullable().describe('The ABC classification of the product (A or B), indicating its importance in consumption volume. A is most important.'),
});

// Input schema for the entire analysis
export const AnalyzeConsumptionInputSchema = z.object({
  startPeriod: z.string().describe('The start of the analysis period (e.g., "2024-05").'),
  endPeriod: z.string().describe('The end of the analysis period (e.g., "2024-07").'),
  kioskName: z.string().describe('The name of the kiosk being analyzed ("Todas as Unidades" for all).'),
  consumptionData: z.array(ConsumptionDataItemSchema).describe('An array of consumption data points for each ingredient.'),
});
export type AnalyzeConsumptionInput = z.infer<typeof AnalyzeConsumptionInputSchema>;

// Output schema for the AI's analysis
export const AnalyzeConsumptionOutputSchema = z.object({
  executiveSummary: z.string().describe('A brief, high-level summary (2-3 sentences) of the main consumption trend in the period.'),
  keyInsights: z.array(z.object({
    emoji: z.string().describe('An emoji representing the insight (e.g., 📈, 📉, ⚠️, 🤔).'),
    text: z.string().describe('A single, concise, and impactful insight discovered from the data.'),
  })).describe('A list of the 3 to 5 most important, non-obvious insights.'),
  recommendations: z.array(z.object({
    emoji: z.string().describe('An emoji representing the recommendation (e.g., 🔍, 🛒, 📋, 📊).'),
    text: z.string().describe('A single, actionable recommendation for the business manager.'),
  })).describe('A list of 2-3 actionable recommendations.'),
  topMovers: z.object({
    highestIncrease: z.array(z.string()).describe('List of the top 2-3 products with the highest percentage increase in consumption.'),
    highestDecrease: z.array(z.string()).describe('List of the top 2-3 products with the most significant percentage decrease in consumption.'),
  }).describe('The products with the most significant changes.'),
});
export type AnalyzeConsumptionOutput = z.infer<typeof AnalyzeConsumptionOutputSchema>;
