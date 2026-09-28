# Integração documental dos mapas na main

## Escopo e bases

Preparação em `docs/map-integration`, a partir de main `70aaab65`. Origem: `docs/system-map`, base `3f64b3cc` com alterações locais. O usuário autorizou concluir a disponibilização dos mapas mantendo as correções adiadas. Esta entrega contém documentação, instruções de agentes e verificadores; não altera código do produto, regras de acesso, dados ou produção.

## Diferenças conferidas

| Área | Implementação presente na main / ajuste do guia |
| --- | --- |
| Patrimônio | QR renderiza dados sem login; cadastro/edição/histórico são operações separadas; não há grant de workspace, reserva transacional de placa, API by-code ou comando idempotente da correção local. Guia reescrito com essas fronteiras. |
| Estoque | Estorno ainda é transação cliente e tenta atualizar histórico imutável; serviço e POST de correção não estão integrados. |
| Compras | Confirmação de estoque usa batch depois de leituras separadas; sincronização da despesa de confirmação captura falha em log, sem o serviço local de pendência/retry. |
| RH | Sem enum runtime geral do destino de advance_stage, CAS/outbox/retry_audit e opção persistOnboarding da correção local. |
| Claims financeiros | Bootstrap/gatilho ainda incluem matriz financeira no token; helper de remoção segura não está presente. |
| Sinalização | Heartbeat não valida token; listener, endpoint público e heartbeat são contratos diferentes. |
| Boletos e pagamentos | Main contém boleto na despesa e apresentação de data de agendamento confirmada; referências adicionadas ao guia financeiro. |
| Férias | Main já contém descarte individual do recibo com arquivo preservado e auditoria; guia atualizado. |
| Interface RH | Ações de integração foram extraídas para recruitment-onboarding-view.tsx; shell ainda compõe a página. |
| Orçamentos | Acrescentados guia, 16 APIs e um export de job; caixa/configurações apontam para os novos contratos. |

Os sete [achados ampliados](surface-audit.md) permanecem adiados. O [registro de regras](business-rules.md) mantém decisões aprovadas e explicita divergências da implementação atual. Nenhuma correção funcional foi transportada para fazer o mapa passar.

## Cobertura e evidências

156 páginas internas; 20 externas; 352 handlers de API; 42 exports de Functions; 414 superfícies na matriz ampliada; 53 grupos; 72 guias de subfluxo. Todos os grupos permanecem parciais quanto à homologação. Conferência de referências e geração não prova segurança/atomicidade.

Verificações locais aprovadas: `npm run check` (exit 0, 1.487 testes, tipos, lint, contrato de erro, skills e agentes), cinco verificadores documentais (138 documentos, 53 grupos) e `git diff --cached --check`. Log local: `.ai-work/development-technology/map-integration/check-main.log`. Uma checagem anterior foi interrompida ao atualizar a base; somente a execução completa em `70aaab65` é usada como evidência. As verificações obrigatórias do PR permanecem como condição de integração. Revisão adicional somente leitura de Gandalf (Sol solicitado) conferiu extração RH, férias, orçamentos, employee-documents e card-statements. Os dois últimos mudaram apenas referências textuais de persona, sem exigir mudança funcional no guia.

## Uso por agentes

AGENTS.md aponta ao mapa e harness; CLAUDE.md importa AGENTS.md. A [coleta de uso real](map-usage.md) reutiliza o registro do chamado. Worktrees antigos precisam receber a atualização documental pelo fluxo Git adotado; não são alterados automaticamente. Não há hook que prove leitura/compreensão dos documentos e nenhum novo serviço pago foi instalado.

## Integração e publicação

A entrega segue PR para main conforme AGENTS.md. Integração em main não é deploy; nenhuma promoção para production faz parte deste pedido. O worktree de origem e seus dados locais permanecem preservados para retomada futura das correções.
