# Cobertura dos grupos de fluxo

Esta lista é derivada da [matriz página → fluxo](flow-matrix.csv) na etapa 1. Os nomes são grupos de investigação, sujeitos a divisão ou fusão quando a sequência ponta a ponta for confirmada. **Localizado** significa que as páginas proprietárias foram identificadas; não significa fluxo traçado ou regra aprovada.

A [verificação por grupo](flow-verification.md) registra referências e lacunas na base principal para cada grupo; `Traçado` não significa teste integrado aprovado.

Classificação inicial: **156/156 páginas** — 115 ativas, 8 de navegação, 22 redirecionamentos, 10 desativadas e 1 rota especial de modal. A matriz cita o arquivo de cada página e registra o destino dos redirecionamentos. Esses totais são verificados por [`check-flow-matrix.py`](../../scripts/check-flow-matrix.py).

| Grupo | Páginas associadas | Estado | Documento profundo |
| --- | ---: | --- | --- |
| `assets` | 1 | Traçado | [Cadastro e movimentação](flows/assets.md) — percurso complementado; verificação integrada pendente |
| `card-statements` | 2 | Traçado | [Prévia, importação e fechamento](flows/card-statements.md) — percurso complementado; verificação integrada pendente |
| `cash-closures` | 6 | Traçado | [Sincronização PDV e contagem](flows/cash-closures.md) — percurso complementado; verificação integrada pendente |
| `cash-deposits` | 1 | Traçado | [Lote, cobrança Inter e conciliação](flows/cash-deposits.md) — percurso complementado; verificação integrada pendente |
| `cash-flow` | 3 | Traçado | [Realizados, previsões e lançamento](flows/cash-flow.md) — percurso complementado; verificação integrada pendente |
| `catalog` | 1 | Traçado | [Fichas técnicas](flows/catalog.md) — verificação de acesso e custo pendente |
| `collaborator-dashboard` | 1 | Traçado | [Escala, metas e cartões](flows/collaborator-dashboard.md) — percurso complementado; verificação integrada pendente |
| `collaborator-schedule` | 1 | Traçado | [Escala própria e equipe](flows/collaborator-schedule.md) — privacidade/custo e teste integrado pendentes |
| `company-documents` | 2 | Traçado | [Arquivo e acesso](flows/company-documents.md) — percurso complementado; verificação integrada pendente |
| `consents` | 1 | Traçado | [Imagem e voz](flows/consents.md) — percurso complementado; verificação integrada pendente |
| `document-generation` | 4 | Traçado | [Geração, leitura e auditoria](flows/document-generation.md), [revisão/finalização](flows/document-review-finalization.md), [assinatura avulsa](flows/document-standalone-signature.md) — verificação integrada pendente |
| `document-templates` | 4 | Traçado | [Cadastro e publicação](flows/document-templates.md) — percurso complementado; verificação integrada pendente |
| `dp-overview` | 1 | Traçado | [Painel DP](flows/dp-overview.md) — percurso complementado; verificação integrada pendente |
| `dp-schedules` | 3 | Traçado | [Escalas DP](flows/dp-schedules.md) — percurso complementado; verificação integrada pendente |
| `dp-settings` | 10 | Traçado | [Configurações DP](flows/dp-configuration.md) — percurso complementado; verificação integrada pendente |
| `dre` | 1 | Traçado | [Fontes de receita, despesa e CMV](flows/dre.md) — percurso complementado; verificação integrada pendente |
| `employee-documents` | 3 | Traçado | [Resumo e visibilidade](flows/employee-documents.md) — percurso complementado; verificação integrada pendente |
| `expenses` | 6 | Traçado | [Lançamento e auditoria](flows/expenses.md) — percurso complementado; verificação integrada pendente |
| `financial-assets` | 1 | Traçado | [Mesma implementação de patrimônio](flows/assets.md) — percurso complementado; verificação integrada pendente |
| `financial-inbox` | 2 | Traçado | [Recebimento, análise, vínculo e retenção](flows/financial-inbox.md) — percurso complementado; verificação integrada pendente |
| `financial-overview` | 1 | Traçado | [Indicadores e atalhos](flows/financial-overview.md) — percurso complementado; verificação integrada pendente |
| `forms` | 6 | Traçado | [Modelos, execução e tarefas](flows/forms.md) — percurso complementado; verificação integrada pendente |
| `goals` | 5 | Traçado | [Metas](flows/goals.md) — percurso complementado; verificação integrada pendente |
| `help` | 1 | Traçado | [Central de ajuda](flows/help.md) — revisão editorial pendente |
| `hr-integration` | 1 | Traçado | [Criação não PJ](flows/onboarding-non-pj-creation.md), [criação PJ](flows/onboarding-pj-creation.md), [formulário e documentos](flows/onboarding-public-documents.md), [ASO](flows/onboarding-aso.md), [contador](flows/onboarding-accountant.md), [assinaturas](flows/onboarding-signatures.md), [treinamento](flows/onboarding-training.md), [fluxo PJ](flows/onboarding-pj-workflow.md), [controle de etapas](flows/onboarding-stage-control.md), [ativação](flows/onboarding-activation.md) — percurso complementado; verificação integrada pendente |
| `inventory-conversion` | 1 | Traçado | [Conversão por produto](flows/conversions.md) — fonte e autorização conferidas; embalagem malformada, fallback e custo pendentes |
| `measure-conversion` | 1 | Traçado | [Conversão local](flows/conversions.md) — cálculo, acesso e ausência de escrita conferidos; renderização visual não testada |
| `operations` | 1 | Traçado | [Agregação do painel](flows/operations-dashboard.md) — percurso complementado; verificação integrada pendente |
| `organization` | 1 | Traçado | [Organograma](flows/organization.md) — percurso complementado; verificação integrada pendente |
| `payment-requests` | 2 | Traçado | [Solicitações e Banco Inter](flows/payment-requests.md) — percurso complementado; verificação integrada pendente |
| `pdv-sync` | 1 | Traçado | [Callable e reprocessamento](flows/pdv-sync.md) — percurso complementado; verificação integrada pendente |
| `people-access` | 6 | Traçado | [Colaboradores e acesso](flows/people-access.md) — percurso complementado; verificação integrada pendente |
| `platform-home` | 1 | Traçado | [Página inicial](flows/platform-home.md) — percurso complementado; verificação integrada pendente |
| `pricing` | 4 | Traçado | [Preços](flows/pricing.md) — percurso complementado; verificação integrada pendente |
| `purchasing` | 15 | Traçado | [Cotação, pedido, recebimento e estoque](flows/purchasing-order-receipt.md) — percurso complementado; verificação integrada pendente |
| `receivables` | 1 | Traçado | [Período, carteira e posição Stone](flows/receivables-stone.md) — percurso complementado; verificação integrada pendente |
| `recruitment` | 3 | Traçado | [Vagas e candidatos](flows/recruitment.md) — percurso complementado; verificação integrada pendente |
| `registry` | 6 | Traçado | [Cadastros](flows/registry.md) — percurso complementado; verificação integrada pendente |
| `rh-bizneo` | 6 | Traçado | [Perfis e sincronização](flows/rh-bizneo.md) — percurso complementado; verificação integrada pendente |
| `sales-reconciliation` | 1 | Traçado | [Comparação PDV × Stone](flows/stone-sales-review.md) — percurso complementado; verificação integrada pendente |
| `settings` | 4 | Traçado | [Configurações gerais](flows/settings.md) — percurso complementado; verificação integrada pendente |
| `signage` | 1 | Traçado | [Slides, publicação e heartbeat](flows/signage.md) — percurso complementado; verificação integrada pendente |
| `stock-analysis` | 9 | Traçado | [Análises de estoque](flows/stock-analysis.md) — percurso complementado; verificação integrada pendente |
| `stock-control` | 6 | Traçado | [Lotes, baixa e transferência](flows/stock-control.md) — percurso complementado; verificação integrada pendente |
| `stock-count` | 3 | Traçado | [Sessões e ajustes de lote](flows/stock-count.md) — percurso complementado; verificação integrada pendente |
| `stock-reposition` | 2 | Traçado | [Reserva e transição](flows/stock-requests-reposition-returns.md) — percurso complementado; verificação integrada pendente |
| `stock-requests` | 1 | Traçado | [Solicitação e tarefa](flows/stock-requests-reposition-returns.md) — percurso complementado; verificação integrada pendente |
| `stock-returns` | 2 | Traçado | [Devolução e bonificação](flows/stock-requests-reposition-returns.md) — percurso complementado; verificação integrada pendente |
| `stone` | 1 | Traçado | [Antecipações e vínculos](flows/stone-sales-review.md) — percurso complementado; verificação integrada pendente |
| `tasks` | 1 | Traçado | [Criação, visão e estado](flows/tasks.md) — percurso complementado; verificação integrada pendente |
| `termination` | 4 | Traçado | [Pedido do colaborador](flows/resignation-request.md), [abertura pelo RH](flows/termination-managed-start.md), [dispensa sem justa causa](flows/termination-employer-dismissal.md), [demais motivos CLT](flows/termination-other-clt-reasons.md), [distrato PJ](flows/termination-pj-agreement.md), [revisão da carta](flows/resignation-letter-review.md), [aviso e contador](flows/termination-notice-accountant.md), [auditoria, pagamento e fechamento](flows/termination-audit-payment-closure.md), [central de processos](flows/termination-process-center.md) — percurso complementado; verificação integrada pendente |
| `uniforms` | 1 | Traçado | [Uniformes](flows/uniforms.md) — percurso complementado; verificação integrada pendente |
| `vacations` | 2 | Traçado | [Agendamento](flows/vacation-scheduling.md), [aviso](flows/vacation-notice.md), [contador](flows/vacation-accountant-dispatch.md), [recibos](flows/vacation-receipts.md), [pagamento e encerramento](flows/vacation-payment-closure.md) — verificação integrada pendente |

Total inicial: **53 grupos**. Atualize estado, documentos e contagem junto com cada etapa do [plano](system-map-execution.md).

Na integração documental da main, nenhum grupo é promovido a Verificado pelas execuções do worktree de correções. São 53 grupos traçados, 72 guias de subfluxo e validação comportamental parcial.
