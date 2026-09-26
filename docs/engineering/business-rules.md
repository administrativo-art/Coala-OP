# Regras aprovadas e comportamento observado

Este registro evita transformar uma implementação encontrada em política do produto. Um guia em `flows/` descreve **o que o código faz**; uma regra aqui só deve ser marcada **aprovada** com origem identificável da decisão. Em caso de conflito, registre as duas fontes e solicite decisão quando necessária para a tarefa.

| Tema | Estado | Origem verificável | Observação |
| --- | --- | --- | --- |
| Autorização final de pagamento bancário exige solicitação específica do usuário | Regra operacional vigente | [`AGENTS.md`](../../AGENTS.md), seção “Pagamentos bancários” | Não inferir autorização de uma preparação ou agendamento. |
| IA sugere recibo de férias e RH confirma o arquivo principal | Comportamento implementado; decisão de negócio específica não localizada neste levantamento | [`dp-vacation-workflow.tsx`](../../src/components/dp/dp-vacation-workflow.tsx), [`server.ts`](../../src/features/hr/vacations/server.ts) | Confirme com o responsável pelo produto antes de alterar a política de seleção. |
| Descarte individual de recibo de férias | Sem regra aprovada localizada neste levantamento | [Guia do fluxo](flows/vacation-receipts.md) | O pedido que motivou o exemplo exige decisão sobre retenção e auditoria; não deduzir a regra da ausência de botão. |
| Signatários do aviso de férias | Divergência entre interface e implementação; regra aprovada não localizada | [Tela](../../src/components/dp/dp-ferias-profile.tsx), [serviço](../../src/features/hr/vacations/server.ts) | A confirmação da tela menciona empregadora e colaboradora; o envio implementado usa apenas a colaboradora. Corrigir a comunicação conforme a política confirmada. |

## Decisões confirmadas pelo usuário em 2026-09-26

Origem: respostas expressas nesta conversa durante a continuação F01/F02/F04, registradas no chamado local do mapa.

| Tema | Regra aprovada | Alcance |
| --- | --- | --- |
| Visibilidade do patrimônio | Quem tem permissão de visualizar pode consultar bens de todas as unidades. | Não restringir consulta pelas unidades do perfil. Preservar isolamento de workspace nas APIs; escrita continua exigindo sua permissão específica. |
| Heartbeat sem token | Manter compatibilidade para TVs sem token configurado. | O endpoint aceita esse modo; ele não comprova identidade do dispositivo. Quando há token configurado, exigi-lo no heartbeat. |
| Consulta por placa de patrimônio | Exigir login e permissão. | Confirmado pelo usuário na continuação do item 7; endereço do QR preservado, dados por API com `assets.view` e histórico com `assets.viewHistory`. |
| Transição genérica do RH | Permitir saltos e retrocessos. | Destino deve ser uma etapa reconhecida; preservar guardas existentes de saída. Não impor adjacência. |

Ao acrescentar uma regra: registre **enunciado, estado, responsável ou decisão que a aprovou, data e fonte**. Não marque uma hipótese, sugestão da IA ou documento de planejamento como aprovada.

## Confronto com a main 70aaab65

Esta integração é documental. A consulta por placa ainda é pública; o heartbeat ainda não valida token; a transição genérica RH não valida enum de destino em runtime. As regras aprovadas acima continuam válidas como intenção, mas suas correções locais não foram integradas. Ver [diferenças e limites](main-map-integration.md). Não interpretar a coluna Alcance como comprovação de implementação.
