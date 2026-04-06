import { ai, DEFAULT_MODEL } from '../genkit';
import {
    GoalsAnalysisInputSchema,
    GoalsAnalysisOutputSchema,
} from './goals-schemas';
import { z } from 'zod';

const goalsAnalysisPrompt = ai.definePrompt(
    {
        name: 'goalsAnalysisPrompt',
        model: DEFAULT_MODEL,
        input: { schema: GoalsAnalysisInputSchema },
        output: { schema: GoalsAnalysisOutputSchema },
        prompt: `Você é o Diretor de Operações e Analista de Dados de uma rede de quiosques de shakes.
Sua missão é realizar uma análise diagnóstica profunda sobre o estado das metas de um quiosque específico e fornecer recomendações acionáveis.

DADOS RECEBIDOS:
- Quiosque: {{kioskName}}
- Período: {{periodMonth}}
- Tipo de Meta: {{goalType}} (Faturamento, Ticket Médio, etc.)
- Alvo Base: {{targetValue}} | Alvo UP: {{upValue}}
- Realizado Atual: {{currentValue}}
- Intervalo: {{startDate}} até {{endDate}} (Referência Hoje: {{today}})

---
INVESTIGAÇÃO ANALÍTICA (8 PILARES):

1. PROGRESSO E PROJEÇÃO (PACE):
   - Calcule o Gap absoluto e percentual para a meta base e meta UP.
   - Analise o Pace Diário Necessário para bater cada meta nos dias restantes.
   - Faça o Run Rate (Projeção de fechamento) baseando-se no 'dailyProgress'.

2. PERFORMANCE INDIVIDUAL (COLABORADORES):
   - Avalie o desvio da fração esperada (fraction). Se um colaborador tem fraction 0.5 e está entregando menos que 50% do total, aponte isso.
   - Ranking qualitativo de consistência: quem está tracionando e quem precisa de suporte.

3. OPERACIONAL (TURNOS):
   - Identifique gargalos entre turnos (T1 vs T2) com base nos dados.
   - Aponte se há padrões de queda de faturamento em horários específicos (se houver dados de hora).

4. MIX E PRODUTO:
   - Se a meta for de Produto Específico ou Linha, analise a penetração em relação ao faturamento total.

5. TICKET MÉDIO (SE DISPONÍVEL):
   - Correlacione o ticket médio com o faturamento. O ticket está subindo ou caindo ao longo do mês?

6. BENCHMARKING E CONSISTÊNCIA:
   - Diagnóstico de estabilidade (vendas diárias constantes) vs. volatilidade (picos e vales). Um quiosque volátil é de maior risco.

7. TENDÊNCIAS E SAZONALIDADE:
   - Identifique se o time está acelerando (efeito sprint) ou perdendo fôlego na reta final.

8. INSIGHTS INTELIGENTES:
   - Quem está em risco de não bater a meta?
   - Quando bateremos a Super Meta (UP) se o ritmo atual continuar?

---
REGRAS:
- Seja DIRETO, ANALÍTICO e EXECUTIVO. Use números para fundamentar.
- Evite elogios genéricos; foque em diagnóstico e diagnósticos de risco.
- O campo 'recommendations' deve conter ações concretas para o gestor implementar AMANHÃ.
- A probabilidade (probabilityOfSuccess) deve ser um cálculo frio baseado no pace necessário vs. pace atual.

RESPOSTA (JSON OBRIGATÓRIO):
Retorne o objeto seguindo fielmente o esquema de saída.`,
    },
);

export async function analyzeGoals(
    input: z.infer<typeof GoalsAnalysisInputSchema>
): Promise<z.infer<typeof GoalsAnalysisOutputSchema>> {
    const { output } = await goalsAnalysisPrompt(input);
    return output!;
}
