# Acompanhamentos obrigatórios antes de paging

## Estado

Estes itens são acompanhamento local, não GitHub Issues publicados. Não existe mute, exclusão de log ou policy para os três jobs. A revisão deve ocorrer até **03/09/2026**, no máximo sete dias após a decisão de 27/08/2026.

Em todos os casos, causa permanece **não confirmada**. Os números abaixo vêm de `AttemptFinished` com severidade `ERROR`; tentativa iniciada não foi tratada como sucesso ou falha.

## `checklistDailyGenerate`

- classe: falha operacional recorrente; triagem obrigatória antes de paging;
- evidência: 90 tentativas com erro em 30 dias, distribuídas pelos 30 dias consultados; três tentativas terminais no ciclo de 27/08/2026;
- contrato esperado: o ciclo diário das 00:05 BRT conclui após gerar ou deduplicar as execuções de checklist/formulário do dia;
- causa confirmada: nenhuma;
- hipótese: a execução falha em alguma fronteira de leitura, construção ou gravação da geração diária; os logs sanitizados e uma reprodução controlada ainda precisam isolar a etapa;
- impacto potencial: execuções operacionais do dia podem deixar de ser geradas ou ficar incompletas; impacto real por data/unidade ainda não foi confirmado;
- responsável: a designar entre Operações/Formulários e Engenharia;
- próxima revisão: até 03/09/2026;
- decisão exigida após triagem: corrigir e proteger, alertar com threshold adequado, ou mutar formalmente com dono, justificativa e expiração.

## `expireQuotations`

- classe: falha operacional recorrente; triagem obrigatória antes de paging;
- evidência: 91 tentativas com erro em 30 dias, distribuídas pelos 30 dias consultados; duas tentativas terminais no ciclo de 27/08/2026;
- contrato esperado: o ciclo diário das 00:30 BRT marca como expiradas as cotações vencidas ainda nos estados elegíveis;
- causa confirmada: nenhuma;
- hipótese: a execução falha na consulta ou atualização do conjunto elegível antes de concluir a expiração; a fronteira exata ainda não foi isolada;
- impacto potencial: cotações vencidas podem permanecer em estado acionável além da validade; não há confirmação de quantidade ou efeito de compra nesta auditoria;
- responsável: a designar entre Compras e Engenharia;
- próxima revisão: até 03/09/2026;
- decisão exigida após triagem: corrigir e proteger, alertar como `MEDIUM/HIGH` conforme impacto, ou mutar formalmente com dono, justificativa e expiração.

## `checkFieldMapConsistency`

- classe: integração/consistência recorrente; triagem obrigatória antes de paging;
- evidência: quatro tentativas com erro nas quatro execuções semanais observadas em 30 dias;
- contrato esperado: aos domingos, 04:00 BRT, comparar o `field_map` do Coala RH com as definições da API Bizneo e, havendo divergência, persistir uma tarefa administrativa idempotente;
- causa confirmada: nenhuma;
- hipótese: a falha pode ocorrer na consulta ao mapa, na integração Bizneo ou ao persistir o acompanhamento de divergência; os logs e o estado sanitizado precisam distinguir essas fronteiras;
- impacto potencial: divergências de IDs de campos podem deixar de ser detectadas e encaminhadas; nenhuma divergência real nem falha de propagação foi confirmada por este sinal isolado;
- responsável: a designar entre RH/Integrações e Engenharia;
- próxima revisão: até 03/09/2026;
- decisão exigida após triagem: corrigir e proteger, alertar com criticidade baseada em impacto, ou mutar formalmente com dono, justificativa e expiração.

## Evidência mínima para a revisão

Para cada item:

1. exportar somente logs sanitizados da execução mais recente e de uma execução anterior comparável;
2. identificar a última etapa confirmadamente concluída e a primeira etapa confirmadamente falha;
3. verificar sucesso técnico e efeito de negócio separadamente;
4. classificar causa confirmada, hipótese e lacunas de evidência;
5. nomear titular e substituto;
6. registrar decisão de correção, alerta ou mute;
7. se houver correção, exigir teste/regra permanente e validação pós-release;
8. se houver mute, exigir filtro estrito, dono, justificativa e data de expiração.

O fluxo `coala-error-triage` permanece explicit-only. Estes registros nativos do Scheduler não recebem fingerprint automaticamente; qualquer relação com `SystemErrorEvent` exige evidência de timestamp, job, release e correlação compatível, nunca suposição.
