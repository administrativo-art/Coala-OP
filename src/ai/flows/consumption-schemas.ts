import { z } from 'zod';

export const ConsumptionDataItemSchema = z.object({
    name: z.string().describe('Nome do insumo base'),
    unit: z.string().describe('Unidade de medida do insumo'),
    series: z.array(z.object({
        label: z.string().describe('Mês/Ano da medição'),
        value: z.number().describe('Quantidade consumida no mês'),
    })).describe('Série histórica de consumo mensal'),
    periodAvg: z.number().describe('Média de consumo mensal no período selecionado'),
    histAvg: z.number().describe('Média de consumo mensal de todo o histórico'),
    volatility: z.string().describe('Volatilidade do consumo (Alta, Média, Baixa)'),
});

export const ConsumptionAnalysisInputSchema = z.object({
    kioskName: z.string().describe('Nome do quiosque ou "Todas as Unidades"'),
    period: z.string().describe('Período de análise, ex: "Ago/23 - Out/23"'),
    items: z.array(ConsumptionDataItemSchema),
});

export const InsightSchema = z.object({
    type: z.enum(['positive', 'negative', 'neutral', 'alert']).describe('Tipo de insight: positivo, negativo, neutro ou alerta.'),
    title: z.string().describe('Um título curto para o insight. Ex: "Consumo de Polpa de Morango em Alta"'),
    description: z.string().describe('Descrição detalhada do insight, explicando a observação e o que ela significa.'),
    productName: z.string().optional().describe('Nome do produto ao qual o insight se refere, se aplicável.'),
});

export const ConsumptionAnalysisOutputSchema = z.object({
    summary: z.string().describe('Um resumo executivo geral da análise de consumo em 2 ou 3 frases.'),
    keyInsights: z.array(InsightSchema).describe('Uma lista dos 3 a 5 insights mais importantes encontrados nos dados.'),
});