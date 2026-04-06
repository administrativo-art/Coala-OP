import { z } from 'zod';

export const GoalsAnalysisInputSchema = z.object({
  kioskName: z.string(),
  periodMonth: z.string(),
  goalType: z.string(),
  targetValue: z.number(),
  upValue: z.number(),
  currentValue: z.number(),
  startDate: z.string(), // ISO String
  endDate: z.string(),   // ISO String
  today: z.string(),     // ISO String (reference for pace calculation)
  dailyProgress: z.record(z.string(), z.number()).optional(),
  employees: z.array(z.object({
    name: z.string(),
    targetValue: z.number(),
    currentValue: z.number(),
    fraction: z.number(),
    dailyProgress: z.record(z.string(), z.number()).optional(),
  })).optional(),
});

export const GoalsAnalysisOutputSchema = z.object({
  summary: z.string().describe("Sumário executivo do estado atual das metas."),
  paceAnalysis: z.object({
    currentPace: z.number().describe("Média diária atual."),
    requiredPace: z.number().describe("Média diária necessária para bater a meta base."),
    requiredUpPace: z.number().describe("Média diária necessária para bater a super meta (UP)."),
    projectedEndValue: z.number().describe("Valor projetado para o fim do mês no ritmo atual."),
    diagnosis: z.string().describe("Leitura analítica do ritmo e projeção."),
  }),
  teamInsights: z.array(z.object({
    category: z.enum(['Performance', 'Consistency', 'Gap']),
    title: z.string(),
    description: z.string(),
    impact: z.enum(['High', 'Medium', 'Low']),
  })).describe("Insights específicos sobre os colaboradores e turnos."),
  operationalInsights: z.string().describe("Análise de picos, turnos e comportamento operacional."),
  recommendations: z.array(z.string()).describe("Lista de ações recomendadas para o gestor."),
  probabilityOfSuccess: z.number().min(0).max(100).describe("Probabilidade percentual de atingir a meta base."),
});
