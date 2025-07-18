'use server';
/**
 * @fileOverview An AI flow for analyzing product pricing and cost sensitivity.
 *
 * - analyzePricing - A function that handles price suggestions and cost analysis.
 * - PricingAnalysisInput - The input type for the analyzePricing function.
 * - PricingAnalysisOutput - The return type for the analyzePricing function.
 */

import {ai} from '@/ai/genkit';
import {z} from 'genkit';

const PricingAnalysisInputSchema = z.object({
  action: z.enum(['suggestPrice', 'analyzeSensitivity']),
  cmv: z.number().describe('The total cost of goods sold for the product.'),
  items: z
    .array(
      z.object({
        name: z.string(),
        cost: z.number(),
      })
    )
    .describe('A list of the ingredients and their individual costs.'),
  desiredProfitMargin: z
    .number()
    .optional()
    .describe('The desired profit margin in percentage (e.g., 45 for 45%).'),
  question: z
    .string()
    .optional()
    .describe('A question about cost sensitivity.'),
});
export type PricingAnalysisInput = z.infer<typeof PricingAnalysisInputSchema>;

const PricingAnalysisOutputSchema = z.object({
  suggestedPrice: z.number().optional().describe('The suggested selling price.'),
  analysis: z
    .string()
    .optional()
    .describe('The text-based analysis of cost sensitivity.'),
});
export type PricingAnalysisOutput = z.infer<
  typeof PricingAnalysisOutputSchema
>;

export async function analyzePricing(
  input: PricingAnalysisInput
): Promise<PricingAnalysisOutput> {
  return pricingAnalysisFlow(input);
}

const suggestPricePrompt = `
You are a pricing specialist for a food business.
Your task is to calculate the suggested selling price based on the Cost of Goods Sold (CMV) and a desired profit margin.

The formula is: Selling Price = CMV / (1 - (Desired Profit Margin / 100))

Round the final price to the nearest 5 or 10 cents to make it a more psychologically appealing retail price (e.g., 10.43 becomes 10.45, 10.98 becomes 11.00).

- CMV: {{{cmv}}}
- Desired Profit Margin: {{{desiredProfitMargin}}}%

Calculate the suggested price. Only output the final numeric value for 'suggestedPrice'.
`;

const analyzeSensitivityPrompt = `
You are an expert cost analyst for a food retail business.
Your task is to analyze the provided list of ingredients and their costs to answer a specific question about cost sensitivity.

Here is the list of ingredients and their costs for the product:
{{#each items}}
- {{this.name}}: R$ {{this.cost}}
{{/each}}

Total CMV: R$ {{{cmv}}}

The user's question is: "{{{question}}}"

Provide a concise, data-driven answer to the user's question. Focus on the direct impact on costs.
If the question is generic, like "what is the most expensive item?", identify the item that contributes most to the CMV.
If the question involves a price change, calculate the new CMV and the monetary and percentage impact.
Keep your analysis to 2-3 sentences.
`;

const pricingAnalysisFlow = ai.defineFlow(
  {
    name: 'pricingAnalysisFlow',
    inputSchema: PricingAnalysisInputSchema,
    outputSchema: PricingAnalysisOutputSchema,
  },
  async (input) => {
    if (input.action === 'suggestPrice') {
      const {output} = await ai.generate({
        prompt: suggestPricePrompt,
        context: [
          {
            data: {
              cmv: input.cmv,
              desiredProfitMargin: input.desiredProfitMargin,
            },
          },
        ],
        output: {
          format: 'json',
          schema: z.object({suggestedPrice: z.number()}),
        },
      });
      return {suggestedPrice: output?.suggestedPrice};
    }

    if (input.action === 'analyzeSensitivity') {
      if (!input.question) {
        throw new Error('A question is required for sensitivity analysis.');
      }
      const {output} = await ai.generate({
        prompt: analyzeSensitivityPrompt,
        context: [
          {
            data: {
              cmv: input.cmv,
              items: input.items,
              question: input.question,
            },
          },
        ],
      });
      return {analysis: output?.text()};
    }

    throw new Error('Invalid action provided to pricingAnalysisFlow.');
  }
);
