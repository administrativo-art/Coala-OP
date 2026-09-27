# Acompanhamento do mapa técnico

2026-09-26, entrega local de sangrias: classificação/vínculo transacionais, quitação na origem protegida e gate de finalização descritos em [fechamento de caixa](flows/cash-closures.md). Testes focados sem navegador; UI, revisão integrada e publicação ainda não concluídas. Não altera o estado de homologação global abaixo.

## Entrega documental para a main

| Etapa | Estado |
| --- | --- |
| 1. Mapa curto | Preparado para consulta por linha relevante. |
| 2. Inventários | Atualizados com o cronograma de projetos: 156 páginas internas, 20 externas, 353 APIs e 42 exports de Functions. |
| 3. Guias detalhados | 53/53 grupos traçados integralmente no levantamento estático; 0/53 verificados nesta base. Há 72 guias de subfluxo. |
| 4. Manutenção | AGENTS.md, harness e verificadores exigem atualizar caminhos e guias com as alterações. |
| 5. Auditoria | Referências e limites por grupo em flow-verification.md; sem transferir resultados do worktree de correções. |
| 6. Correções locais anteriores | Preservadas somente no worktree de origem; não incluídas na integração documental. |
| 7. Homologação | TV física adiada; provedores e cenários por grupo pendentes. |
| 8. Achados ampliados | A08-01 a A08-07 registrados e adiados pelo usuário. |
| 9. Tokens | Piloto histórico concluído sem economia geral; acompanhamento futuro durante tarefas reais. |
| 10. Compatibilização com main | Documentação adaptada; resultado final de integração e verificações em [relatório](main-map-integration.md). |

## Como usar e manter

Conciliação/DRE (2026-09-26): navegação, fonte integral, sangrias e taxas explícitas integradas localmente. Guias DRE, caixa diário, caixa financeiro, despesas e Stone atualizados. Testes HTTP autenticados sem navegador e integrações de classificação/taxas aprovados em emuladores; não houve dados reais. Grupos continuam Traçados pelas lacunas de UI/provedores/fluxos adjacentes. [Preparação de publicação](financial-reconciliation-release.md) separa código validado de recuperação autorizada de histórico; fechamento mensal adiado.

Atualização local de 2026-09-26: navegação financeira reúne conciliação e fechamento diário, com destino canônico de extratos e preservação de uploads, permissões e links antigos. Faturas possuem uma entrada canônica; nenhum fechamento mensal foi acrescentado. [Despesas](flows/expenses.md) e [faturas](flows/card-statements.md) atualizados no mesmo trabalho. Estado dos fluxos continua Traçado; testes de navegação não homologam os motores financeiros completos.

Começar pela linha pertinente do [mapa](system-map.md), seguir [harness](investigation-harness.md) e conferir fontes atuais. Usar inventário quando faltar caminho. Registrar o [uso real](map-usage.md) no chamado, sem contadores inventados.

Mudança de página, rota ou export exige regenerar inventário e revisar matriz. Mudança de comportamento, schema, permissão, integração ou consumidor exige atualizar o guia no mesmo trabalho, mesmo se nenhum caminho mudou. Incluir novas dependências e preservar a distinção entre [regra aprovada](business-rules.md) e comportamento implementado. Ver [verificação](verification.md) para os comandos.

Os verificadores asseguram estrutura, não compreensão do agente ou cobertura comportamental. Grupos são Localizado quando há entrada, Traçado quando a sequência e dependências têm fontes e Verificado somente com evidência suficiente no código/versão em questão. Não promover grupos pela quantidade de testes da suíte geral.

Em 26/09/2026, a correção de [pagamentos concluídos](flows/payment-requests.md) acrescentou evidência unitária de apresentação e conferência do recebedor, além de integração em emulador da atualização com auditoria, concorrência e idempotência. O grupo permanece Traçado: essa validação é restrita à revalidação após pagamento e não certifica envio, webhook ou todas as fronteiras externas.

No mesmo dia, [orçamentos de projetos](flows/financial-budgets.md) e [fluxo de caixa](flows/cash-flow.md) receberam cronograma por competência/período, substituição da expectativa por despesa e encerramento auditado de etapas. Incluída a API stages na matriz/inventário. Unitários, integração em emulador e build deste subfluxo concluídos localmente; não houve navegador local nem escrita financeira real. Grupos permanecem Traçados; testes isolados não certificam integralmente os fluxos vizinhos.

Atualização de 2026-09-27: entrada dedicada orçamento × despesas reaproveita o resumo por competência; novo catálogo histórico de centros possui escopo e limite no servidor. Pagamentos encontrados em previsões deixam de duplicar a saída futura e o indicador de atraso. Contratos e testes apontados nos guias financeiros; sem homologação visual em navegador.

CMV/DRE (2026-09-27): custo atual central por composição e congelamento manual exclusivo de CMV por unidade/competência, com reabertura auditada. Não fecha todo o financeiro. API, tela, exportação e agente usam o mesmo contrato; plano Stone/conciliação §7.5.1 define reaproveitamento obrigatório no futuro fechamento geral. Sem migração ou alteração de dados reais.
