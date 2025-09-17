
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
Sua análise deve ser clara, objetiva e acionável. Organize sua resposta nas seguintes seções, usando os títulos em negrito e listas quando apropriado. Use uma linguagem profissional e direta, evitando jargões excessivos. Não repita informações entre seções.

**Resumo Estratégico**
Um parágrafo conciso que resume a competitividade geral. Classifique a empresa como marca premium (mais cara), de valor (mais barata) ou mista. Não inclua recomendações aqui.

**Pontos Fortes (Vantagens Competitivas)**
Liste todos os produtos em que o preço esteja mais competitivo (mais baixo) em relação aos concorrentes. Para cada mercadoria analisada, use este formato:
*   **[Nome do Produto]:** Preço de [Seu Preço], especialmente em comparação com [Concorrente Mais Caro] que cobra [Preço].

**Pontos de Atenção (Desvantagens Competitivas)**
Liste todos os produtos em que o preço esteja menos competitivo (mais alto) em relação aos concorrentes. Para cada mercadoria analisada, use este formato:
*   **[Nome do Produto]:** Seu preço de [Seu Preço] está acima de [Concorrente Mais Barato], que vende a [Preço].

**Análise dos Concorrentes**
Descreva cada concorrente em até 3 frases, destacando:
*   Categorias/produtos onde pratica preços mais agressivos (baratos).
*   Categorias/produtos onde está acima da média.

**Recomendações Estratégicas**
Forneça 2 a 3 recomendações práticas e específicas, baseadas no conjunto completo de mercadorias analisadas. Sempre cite os produtos ou categorias afetadas e, se aplicável, o percentual sugerido de ajuste ou a ação promocional.

📌 **Forma de saída esperada:**
O resultado final deve ser um relatório em texto estruturado com as seções acima, escrito em português, cobrindo todas as mercadorias do JSON de entrada, em formato didático para leitura direta pelo gestor. **Não use JSON na saída.**

**Dados para análise:**
{{#each input}}
- Produto: {{this.ksItemName}}, Seu Preço: R$ {{this.ksItemPrice}}. Concorrentes: {{#each this.competitors}}{{this.competitorName}} a R$ {{this.price}}{{#unless @last}}, {{/unless}}{{/each}}.
{{/each}}
`;


const priceComparisonFlow = ai.defineFlow(
  {
    name: 'priceComparisonFlow',
    inputSchema: PriceAnalysisInputSchema,
    outputSchema: PriceAnalysisOutputSchema,
  },
  async (input) => {
    const { text } = await ai.generate({
      prompt: analysisPrompt,
      input: input,
    });

    return { analysis: text || 'Não foi possível gerar a análise.' };
  }
);
