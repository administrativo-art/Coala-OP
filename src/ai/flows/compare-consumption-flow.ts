
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

const AI_ERROR_MESSAGE = "A análise da IA não pôde ser gerada. Isso pode ocorrer devido a filtros de segurança ou um erro inesperado. Por favor, tente novamente.";

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
  prompt: `Você é um Analista de Dados Sênior com foco em varejo e gestão de estoque. Sua tarefa é realizar uma análise técnica e aprofundada dos dados de consumo de insumos para o quiosque, comparando os dois períodos.

Sua análise deve conter:

Diagnóstico Geral: Um parágrafo inicial que sintetiza a principal mudança no padrão de consumo.

Análise de Variações Críticas: Identifique os itens com as maiores variações, tanto percentuais quanto absolutas. Separe claramente os aumentos e as reduções.

Identificação de Correlações: Aponte correlações entre o consumo de diferentes insumos (ex: o aumento nas vendas de milkshake e o consumo de copos, tampas e canudos correspondentes; ou a queda de um produto e seus descartáveis associados).

Hipóteses e Implicações de Negócio: Com base nos dados, formule hipóteses para as mudanças observadas (ex: mudança de preferência do cliente, impacto de uma promoção, possível falta de estoque de um item). Descreva as implicações para a gestão de estoque e estratégia de vendas.

Período de Referência (A): {{{periodA}}}
Período de Comparação (B): {{{periodB}}}
Dados de Consumo: {{{dataAsString}}}

Recomendação Principal: Forneça uma recomendação clara e assertiva para a gerência do quiosque.`,
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
        `- ${item.productName}: ${item.consumptionA} ${item.unit} (Período A) vs ${item.consumptionB} ${item.unit} (Período B)`
    ).join('\n');
    
    // Create the simplified input object for the prompt.
    const simplifiedInput = {
        periodA: input.periodA,
        periodB: input.periodB,
        dataAsString: dataAsString,
    };

    const {output} = await prompt(simplifiedInput);
    if (output === null) {
      return AI_ERROR_MESSAGE;
    }
    return output;
  }
);
