'use server';
/**
 * @fileOverview Consumption analysis AI agent.
 */

import { ai, DEFAULT_MODEL } from '@/ai/genkit';
import { 
    AnalyzeConsumptionInputSchema, 
    AnalyzeConsumptionOutputSchema,
} from './consumption-schemas';
import type { 
    AnalyzeConsumptionInput, 
    AnalyzeConsumptionOutput 
} from './consumption-schemas';


const prompt = ai.definePrompt({
  name: 'analyzeConsumptionPrompt',
  model: DEFAULT_MODEL,
  input: { schema: AnalyzeConsumptionInputSchema },
  output: { schema: AnalyzeConsumptionOutputSchema },
  prompt: `
    You are a senior business intelligence analyst for a chain of shake kiosks.
    Your task is to analyze the provided JSON data, which contains the average monthly consumption of various ingredients for a selected period compared to their historical average.

    The data is for the period from {{startPeriod}} to {{endPeriod}} for the kiosk: "{{kioskName}}".

    Data format for each ingredient:
    - 'name': The ingredient's name.
    - 'periodAvg': The average consumption in the selected period.
    - 'histAvg': The historical average consumption.
    - 'periodChangePct': The percentage change between the period and historical average. A large positive value indicates a significant increase in consumption. A large negative value indicates a significant decrease.
    - 'volatility': How stable the consumption is over time. 'Alta' means very unpredictable.
    - 'abcClass': 'A' means it's a top-volume item.

    Your analysis should be concise, insightful, and actionable for a manager. Avoid simply restating the data.
    Focus on trends, anomalies, and business implications.

    Here is the data:
    \`\`\`json
    {{{json consumptionData}}}
    \`\`\`

    Provide your analysis in the specified JSON output format.
    - The executive summary must be a short, high-level overview.
    - Key insights should highlight the most critical findings (e.g., "Cascão consumption is down 30%, which could signal an issue with cone sales.").
    - Recommendations should be practical next steps (e.g., "Investigate the cause for the drop in Leite Ninho sales.").
    - For top movers, list only the names of the top 2 or 3 products for both increases and decreases.
  `,
});

const analyzeConsumptionFlow = ai.defineFlow(
  {
    name: 'analyzeConsumptionFlow',
    inputSchema: AnalyzeConsumptionInputSchema,
    outputSchema: AnalyzeConsumptionOutputSchema,
  },
  async (input) => {
    const { output } = await prompt(input);
    if (!output) {
      throw new Error('AI analysis failed to produce an output.');
    }
    return output;
  }
);

export async function analyzeConsumption(input: AnalyzeConsumptionInput): Promise<AnalyzeConsumptionOutput> {
  return analyzeConsumptionFlow(input);
}
