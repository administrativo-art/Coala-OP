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

export const ItemAnalysisSchema = z.object({
  product: z.string().describe("Nome do produto e unidade, ex: Morango (kg)"),
  averageConsumptionBehavior: z.string().describe("Descrição clara e objetiva do comportamento do consumo médio."),
  periodVsHistoricalComparison: z.string().describe("Variação aproximada e interpretação da comparação entre período e histórico."),
  monthlySeriesTrend: z.string().describe("O que a série mensal de consumo revela (tendências, picos, etc.)."),
  volatilityAndStability: z.string().describe("Leitura analítica da volatilidade e estabilidade do consumo."),
  analyticalSynthesis: z.string().describe("Uma frase conclusiva sobre o padrão de consumo do insumo."),
});

export const ConsumptionAnalysisOutputSchema = z.object({
  detailedAnalysis: z.array(ItemAnalysisSchema).describe("Uma lista contendo a análise detalhada para cada um dos insumos fornecidos."),
});
