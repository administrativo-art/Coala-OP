
'use server';
/**
 * @fileOverview An AI flow for analyzing price comparison data.
 *
 * - analyzePrices - A function that generates strategic insights from price data.
 * - PriceAnalysisInput - The input type for the analyzePrices function.
 * - PriceAnalysisOutput - The return type for the analyzePrices function.
 */

import { ai } from '@/ai/genkit';
import { z } from 'zod';

const PriceAnalysisInputSchema = z.array(
  z.object({
    ksItemName: z.string().describe('O nome da sua mercadoria (KS).'),
    ksItemPrice: z.number().describe('O seu preço de venda para esta mercadoria.'),
    competitors: z.array(
      z.object({
        competitorName: z.string().describe('O nome do concorrente.'),
        price: z.number().describe('O preço do concorrente para a mercadoria equivalente.'),
      })
    ),
  })
);
export type PriceAnalysisInput = z.infer<typeof PriceAnalysisInputSchema>;

const PriceAnalysisOutputSchema = z.object({
  analysis: z.string().describe('Uma análise estratégica detalhada dos dados de preços, incluindo pontos fortes, fracos e recomendações.'),
});
export type PriceAnalysisOutput = z.infer<typeof PriceAnalysisOutputSchema>;

export async function analyzePrices(input: PriceAnalysisInput): Promise<PriceAnalysisOutput> {
  return priceComparisonFlow(input);
}

const analysisPrompt = `
Você é um especialista em estratégia de preços para o setor de varejo de alimentos, especificamente quiosques de shopping. Sua tarefa é analisar os dados de preços comparativos fornecidos e gerar um relatório estratégico para o gestor.

O formato de entrada é uma lista de mercadorias, cada uma com o seu preço ("ksItemPrice") e uma lista de preços dos concorrentes.

Sua análise deve ser clara, objetiva e acionável. Organize sua resposta nas seguintes seções:

1.  **Resumo Estratégico:** Um parágrafo conciso que resume a sua competitividade geral. Destaque se você está posicionado como uma marca premium (mais cara), de valor (mais barata) ou mista.

2.  **Pontos Fortes (Vantagens Competitivas):** Liste de 3 a 5 produtos onde seu preço é significativamente mais competitivo (mais baixo) que a média dos concorrentes. Para cada item, mencione o produto e qual concorrente tem o preço mais alto. Use este formato:
    *   **[Nome do Produto]:** Preço competitivo de [Seu Preço], especialmente em comparação com [Nome do Concorrente] que cobra [Preço do Concorrente].

3.  **Pontos de Atenção (Desvantagens Competitivas):** Liste de 3 a 5 produtos onde seu preço está significativamente menos competitivo (mais alto). Identifique o concorrente mais agressivo (mais barato) para cada item. Use este formato:
    *   **[Nome do Produto]:** Seu preço de [Seu Preço] está acima de [Nome do Concorrente], que vende a [Preço do Concorrente].

4.  **Análise dos Concorrentes:** Forneça um breve perfil de cada concorrente com base nos dados. Por exemplo: "[Nome do Concorrente] parece focar em preços agressivos para [categoria de produto], mas tem preços mais altos em [outra categoria]."

5.  **Recomendações Estratégicas:** Com base em sua análise, forneça de 2 a 3 recomendações claras e acionáveis. As recomendações devem ser específicas. Por exemplo:
    *   "Considere criar um combo promocional com [Seu Produto Competitivo] para atrair clientes."
    *   "Avalie reduzir a margem de lucro de [Seu Produto Caro] em 5% para se alinhar com [Concorrente Mais Barato] e evitar perder vendas."
    *   "Mantenha os preços de [Seu Outro Produto Competitivo], pois você tem uma clara vantagem de custo."

Use uma linguagem profissional e direta. Evite jargões excessivos. O objetivo é fornecer ao gestor insights que ele possa usar para tomar decisões imediatas.

Dados para análise:
{{{json input}}}
`;


const priceComparisonFlow = ai.defineFlow(
  {
    name: 'priceComparisonFlow',
    inputSchema: PriceAnalysisInputSchema,
    outputSchema: PriceAnalysisOutputSchema,
  },
  async (input) => {
    const { output } = await ai.generate({
      prompt: analysisPrompt,
      input: { input: input },
      output: {
        format: 'json',
        schema: z.object({ analysis: z.string() })
      },
    });

    return { analysis: output?.analysis || 'Não foi possível gerar a análise.' };
  }
);
