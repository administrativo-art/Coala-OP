
'use server';
/**
 * @fileOverview An AI flow to analyze and compare monthly consumption data.
 *
 * - compareConsumption - A function that takes two consumption periods and returns an analysis.
 * - ComparisonInput - The input type for the compareConsumption function.
 * - ComparisonOutput - The return type for the compareConsumption function.
 */

import {ai} from '@/ai/genkit';
import {z} from 'zod';

const ComparisonItemSchema = z.object({
  productName: z.string().describe('The name of the product.'),
  consumptionA: z.number().describe('The consumption value for the first period.'),
  consumptionB: z.number().describe('The consumption value for the second period.'),
  unit: z.string().describe('The base unit of the product.'),
});

const ComparisonInputSchema = z.object({
  periodA: z.string().describe("Label for the first period, e.g., 'Janeiro/2024'."),
  periodB: z.string().describe("Label for the second period, e.g., 'Fevereiro/2024'."),
  items: z.array(ComparisonItemSchema),
});
export type ComparisonInput = z.infer<typeof ComparisonInputSchema>;

const ComparisonOutputSchema = z.string().describe("A concise analysis of the consumption changes between the two periods.");
export type ComparisonOutput = z.infer<typeof ComparisonOutputSchema>;


export async function compareConsumption(input: ComparisonInput): Promise<ComparisonOutput> {
  return compareConsumptionFlow(input);
}

// A new, simpler schema for the prompt itself.
const SimplifiedPromptInputSchema = z.object({
  periodA: z.string(),
  periodB: z.string(),
  dataAsString: z.string(),
});


const prompt = ai.definePrompt({
  name: 'compareConsumptionPrompt',
  input: {schema: SimplifiedPromptInputSchema},
  output: {schema: ComparisonOutputSchema.nullable()},
  prompt: `
        Você é um analista de negócios para uma rede de quiosques de shakes. Sua tarefa é analisar a variação no consumo de insumos entre dois períodos.

        Período A: {{{periodA}}}
        Período B: {{{periodB}}}

        A seguir, uma lista de produtos e seus consumos em cada período.

{{{dataAsString}}}

        Com base nesses dados, escreva uma análise curta e objetiva em um único parágrafo (no máximo 3 ou 4 frases) destacando as mudanças mais significativas. Foque nos maiores aumentos e quedas, tanto em termos absolutos quanto percentuais. Se possível, sugira uma possível causa para as variações mais importantes (ex: sazonalidade, popularidade de um novo produto, etc.). Seja direto e evite jargões.
    `,
    config: {
        safetySettings: [
          {
            category: 'HARM_CATEGORY_DANGEROUS_CONTENT',
            threshold: 'BLOCK_NONE',
          },
        ],
    },
});


const compareConsumptionFlow = ai.defineFlow(
  {
    name: 'compareConsumptionFlow',
    inputSchema: ComparisonInputSchema,
    outputSchema: ComparisonOutputSchema,
  },
  async (input) => {
    // Manually format the items array into a single string.
    const dataAsString = input.items.map(item => 
        `- Insumo: ${item.productName}\n  - Consumo em ${input.periodA}: ${item.consumptionA} ${item.unit}\n  - Consumo em ${input.periodB}: ${item.consumptionB} ${item.unit}`
    ).join('\n\n');
    
    // Create the simplified input object for the prompt.
    const simplifiedInput = {
        periodA: input.periodA,
        periodB: input.periodB,
        dataAsString: dataAsString,
    };

    const {output} = await prompt(simplifiedInput);
    if (output === null) {
      return "A análise da IA não pôde ser gerada. Isso pode ocorrer devido a filtros de segurança ou um erro inesperado. Por favor, tente novamente.";
    }
    return output;
  }
);
