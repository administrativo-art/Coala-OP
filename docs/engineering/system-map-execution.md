# Acompanhamento do mapa técnico

2026-10-01, a integração Pix de Vendas ganhou solicitador diário idempotente: a API Stone é chamada uma vez por data ausente, a entrega assíncrona permanece no webhook e os arquivos ficam persistidos no banco financeiro para reaproveitamento. O contrato passou a versionar snapshots, expor pedido/erro e preservar Pix do PDV como não comparado quando o arquivo tem cobertura parcial. Transporte, datas, repetição e regressão foram cobertos localmente; scheduler, webhook e provedor reais continuam sem homologação, portanto Vendas permanece Traçado.
2026-10-01, piloto local da Natasha para escalas: coletor CLI de escala por escopo, rotas/CLIs ainda não implantadas para equipe candidata, férias e definições de turno, adaptadores locais de demanda e posições, validadores, pré-voo e calculador de alternativas. As rotas usam permissões existentes, escopo de unidade, projeções mínimas e limites; testes são sintéticos. Classificação, quantidade, função e exceções das posições exigem decisões explícitas, e intervalo intrajornada ainda bloqueia a preparação. A disponibilidade não inclui folgas nem indisponibilidades externas. Não houve leitura de escala, pessoas, férias ou definições reais, geração com dados reais, edição no Coala ou integração com o editor. O grupo `dp-schedules` permanece Traçado; o piloto não homologa o fluxo operacional.

2026-09-30, Vendas e Recebimentos passaram a ser grupos documentais independentes, acompanhando as rotas e entradas próprias já existentes. Os atalhos cruzados dos cabeçalhos foram removidos para que Vendas permaneça restrita ao comparador PDV × Stone e Recebimentos concentre carteira, taxas, antecipações e confirmação bancária. O catálogo inicial limitado de vínculos agora é carregado na entrada das duas páginas, sem disparar consulta à Stone; seleção dependente e atualização continuam explícitas. O levantamento passa a contabilizar 54 grupos; ambos permanecem Traçados.

2026-09-29, implementação local do workspace editorial do Instagram: calendário e grade usam a fila limitada existente, reagendamento e troca de datas são transacionais e a biblioteca grava mídia privada com autorização no servidor. Contratos, regras e testes locais foram ampliados; não houve navegador, publicação na Meta, escrita em produção nem homologação visual. A mudança não promove os grupos internos para Verificado.

2026-09-27, correção local da preparação de cobrança recebida: a API e a interface passam a exigir CNPJ válido do favorecido, o snapshot de código de barras preserva essa identidade e repetições só reutilizam pedidos integralmente iguais. A CLI autenticada ganhou preparação com preflight da mensagem, mantendo preparação, autorização e envio separados. Testes unitários e E2E em emuladores cobrem identidade, permissão, idempotência e divergência; nenhuma ordem bancária real foi executada nessa validação. Os grupos permanecem Traçados.

2026-09-27, ajuste local de compras no cartão: a sincronização de compras passa a gravar o contrato canônico do cartão e a competência de cada parcela; a listagem projeta parcelas em suas faturas sem duplicar o valor integral. A decisão de negócio e a correção operacional de setembro (VT duplicado e série Odontoprev no último dia do mês) foram registradas nos guias financeiros. Testes focados cobrem cálculo de ciclo e agrupamento; integração completa, interface e publicação continuam pendentes. Os grupos permanecem Traçados.

2026-09-26, entrega local de sangrias: classificação/vínculo transacionais, quitação na origem protegida e gate de finalização descritos em [fechamento de caixa](flows/cash-closures.md). Testes focados sem navegador; UI, revisão integrada e publicação ainda não concluídas. Não altera o estado de homologação global abaixo.

## Entrega documental para a main

| Etapa | Estado |
| --- | --- |
| 1. Mapa curto | Preparado para consulta por linha relevante. |
| 2. Inventários | Atualizados com o cronograma de projetos: 156 páginas internas, 20 externas, 353 APIs e 42 exports de Functions. |
| 3. Guias detalhados | 54/54 grupos traçados integralmente no levantamento estático; 0/54 verificados nesta base. Há 73 guias de subfluxo. |
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

Atualização local de 2026-09-27: extratos e faturas compartilham o navegador de competência e o padrão de retorno. O extrato não incorpora mais o workspace de cartão; cada card de conta abre a página dedicada, que mantém alternância entre todos os cartões da conta. Estados visíveis do extrato foram reduzidos a Pendente, Conciliada e Ignorada, sem mudar os estados persistidos. [Guia visual](ui-design-system.md), [Despesas](flows/expenses.md) e [faturas](flows/card-statements.md) registram o contrato. Testes dirigidos de navegação e progresso foram executados; fluxo financeiro integrado e validação visual em navegador permanecem pendentes, então os grupos continuam Traçados.

Atualização local de 2026-09-27: o padrão visual do Extrato foi estendido às superfícies do Financeiro, com largura centralizada, retorno canônico e navegação lateral coerente. Em Despesas, auditoria tornou-se filtro contextual, o período é explícito e a faixa única de KPIs fecha `Total do período = Pago + A pagar`; a rota dedicada antiga apenas redireciona. Contratos de UI, navegação e documentação foram executados sem navegador; o grupo continua Traçado porque a homologação integrada dos motores financeiros permanece pendente.

Atualização local de 2026-09-30: o KPI e o filtro de despesas vencidas passaram a compartilhar a obrigação exibida. Para cartão, o cálculo ocorre por parcela/fatura: a conciliação de uma fatura paga não transforma o saldo futuro da compra parcelada em atraso. A competência do cartão também passou a fechar e vencer no ciclo seguinte; no Inter 5/12, setembro fecha em 05/10 e vence em 12/10. Os contratos possuem testes unitários; a homologação integrada do Financeiro permanece pendente e o grupo continua Traçado.

Começar pela linha pertinente do [mapa](system-map.md), seguir [harness](investigation-harness.md) e conferir fontes atuais. Usar inventário quando faltar caminho. Registrar o [uso real](map-usage.md) no chamado, sem contadores inventados.

Mudança de página, rota ou export exige regenerar inventário e revisar matriz. Mudança de comportamento, schema, permissão, integração ou consumidor exige atualizar o guia no mesmo trabalho, mesmo se nenhum caminho mudou. Incluir novas dependências e preservar a distinção entre [regra aprovada](business-rules.md) e comportamento implementado. Ver [verificação](verification.md) para os comandos.

Os verificadores asseguram estrutura, não compreensão do agente ou cobertura comportamental. Grupos são Localizado quando há entrada, Traçado quando a sequência e dependências têm fontes e Verificado somente com evidência suficiente no código/versão em questão. Não promover grupos pela quantidade de testes da suíte geral.

Em 26/09/2026, a correção de [pagamentos concluídos](flows/payment-requests.md) acrescentou evidência unitária de apresentação e conferência do recebedor, além de integração em emulador da atualização com auditoria, concorrência e idempotência. O grupo permanece Traçado: essa validação é restrita à revalidação após pagamento e não certifica envio, webhook ou todas as fronteiras externas.

No mesmo dia, [orçamentos de projetos](flows/financial-budgets.md) e [fluxo de caixa](flows/cash-flow.md) receberam cronograma por competência/período, substituição da expectativa por despesa e encerramento auditado de etapas. Incluída a API stages na matriz/inventário. Unitários, integração em emulador e build deste subfluxo concluídos localmente; não houve navegador local nem escrita financeira real. Grupos permanecem Traçados; testes isolados não certificam integralmente os fluxos vizinhos.

Atualização de 2026-09-27: entrada dedicada orçamento × despesas reaproveita o resumo por competência; novo catálogo histórico de centros possui escopo e limite no servidor. Pagamentos encontrados em previsões deixam de duplicar a saída futura e o indicador de atraso. Contratos e testes apontados nos guias financeiros; sem homologação visual em navegador.

CMV/DRE (2026-09-27): custo atual central por composição e congelamento manual exclusivo de CMV por unidade/competência, com reabertura auditada. Não fecha todo o financeiro. API, tela, exportação e agente usam o mesmo contrato; plano Stone/conciliação §7.5.1 define reaproveitamento obrigatório no futuro fechamento geral. Sem migração ou alteração de dados reais.
