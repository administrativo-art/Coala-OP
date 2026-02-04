'use server';

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
            prompt: `Você é um analista de dados especialista em otimização de estoque para uma rede de quiosques de shakes.
            Sua tarefa é analisar os dados de consumo de insumos fornecidos e gerar um resumo e insights valiosos.

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

            Seu resumo deve destacar as tendências gerais.
            Seus insights devem ser acionáveis e focar em:
            1.  Maiores aumentos ou quedas de consumo comparando a média do período com a histórica.
            2.  Produtos com alta volatilidade, que são difíceis de prever.
            3.  Oportunidades de otimização (ex: produto com consumo em queda pode ter compra reduzida).
            4.  Alertas de risco (ex: produto com consumo disparando pode levar a ruptura de estoque).

            Seja claro, objetivo e use os nomes dos produtos nos seus insights. Gere pelo menos 3 insights chave.`,
        },
    );

    const { output } = await consumptionAnalysisPrompt(input);
    return output!;
}
