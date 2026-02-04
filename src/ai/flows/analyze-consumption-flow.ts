
import { ai, DEFAULT_MODEL } from '../genkit';
import {
    ConsumptionAnalysisInputSchema,
    ConsumptionAnalysisOutputSchema,
    type ConsumptionDataItemSchema
} from './consumption-schemas';
import { z } from 'zod';

export async function analyzeConsumption(
    input: z.infer<typeof ConsumptionAnalysisInputSchema>
): Promise<z.infer<typeof ConsumptionAnalysisOutputSchema>> {
    const consumptionAnalysisPrompt = ai.definePrompt(
        {
            name: 'consumptionAnalysisPrompt',
            model: DEFAULT_MODEL,
            input: { schema: ConsumptionAnalysisInputSchema },
            output: { schema: ConsumptionAnalysisOutputSchema },
            prompt: `Você é um analista de dados especialista em análise de consumo para uma rede de quiosques de shakes.

Sua tarefa é analisar minuciosamente o comportamento de consumo médio de cada insumo, item por item, com base nos dados fornecidos e retornar a análise como um objeto JSON.

Analise os seguintes dados:
- Quiosque: {{kioskName}}
- Período: {{period}}
- Itens:
{{#each items}}
- Produto: {{name}} (Unidade: {{unit}})
  - Média no Período: {{periodAvg}}
  - Média Histórica: {{histAvg}}
  - Volatilidade: {{volatility}}
  - Consumo Mensal:
  {{#each series}}
  - {{label}}: {{value}}
  {{/each}}
{{/each}}

Regras:
- NÃO gere resumo geral do quiosque.
- NÃO faça recomendações de compra, reposição, transferência ou estoque mínimo.
- Limite a análise exclusivamente ao comportamento de consumo médio e sua variação ao longo do tempo.

Para cada insumo, analise:
1) Comparação da média do período com a média histórica, indicando direção (alta, queda ou estabilidade) e intensidade aproximada.
2) Leitura da série mensal de consumo, destacando tendências, picos, quedas ou mudanças de padrão.
3) Avaliação da volatilidade como indicador de estabilidade ou instabilidade do consumo.
4) Interpretação do comportamento do consumo médio (ex.: crescimento consistente, retração gradual, oscilação sem tendência clara).

Formato de saída (obrigatório):
Sua resposta DEVE ser um objeto JSON. Para cada item analisado, crie um objeto JSON com os seguintes campos, e agrupe todos os objetos em um array sob a chave "detailedAnalysis":
- "product": O nome do produto e sua unidade. Ex: "Morango (kg)".
- "averageConsumptionBehavior": Descrição clara e objetiva do comportamento do consumo médio.
- "periodVsHistoricalComparison": Variação aproximada e interpretação da comparação entre período e histórico.
- "monthlySeriesTrend": O que a série mensal de consumo revela (tendências, picos, etc.).
- "volatilityAndStability": Leitura analítica da volatilidade e estabilidade do consumo.
- "analyticalSynthesis": Uma frase conclusiva sobre o padrão de consumo do insumo.

Use sempre os nomes dos produtos.
Evite linguagem prescritiva ou operacional.
O foco é diagnóstico analítico, não decisão de reposição.`,
        },
    );

    const { output } = await consumptionAnalysisPrompt(input);
    return output!;
}
