# Acompanhamento do mapa técnico

## Entrega documental para a main

| Etapa | Estado |
| --- | --- |
| 1. Mapa curto | Preparado para consulta por linha relevante. |
| 2. Inventários | Regenerados na main: 156 páginas internas, 20 externas, 352 APIs e 42 exports de Functions. |
| 3. Guias detalhados | 53/53 grupos traçados integralmente no levantamento estático; 0/53 verificados nesta base. Há 72 guias de subfluxo. |
| 4. Manutenção | AGENTS.md, harness e verificadores exigem atualizar caminhos e guias com as alterações. |
| 5. Auditoria | Referências e limites por grupo em flow-verification.md; sem transferir resultados do worktree de correções. |
| 6. Correções locais anteriores | Preservadas somente no worktree de origem; não incluídas na integração documental. |
| 7. Homologação | TV física adiada; provedores e cenários por grupo pendentes. |
| 8. Achados ampliados | A08-01 a A08-07 registrados e adiados pelo usuário. |
| 9. Tokens | Piloto histórico concluído sem economia geral; acompanhamento futuro durante tarefas reais. |
| 10. Compatibilização com main | Documentação adaptada; resultado final de integração e verificações em [relatório](main-map-integration.md). |

## Como usar e manter

Começar pela linha pertinente do [mapa](system-map.md), seguir [harness](investigation-harness.md) e conferir fontes atuais. Usar inventário quando faltar caminho. Registrar o [uso real](map-usage.md) no chamado, sem contadores inventados.

Mudança de página, rota ou export exige regenerar inventário e revisar matriz. Mudança de comportamento, schema, permissão, integração ou consumidor exige atualizar o guia no mesmo trabalho, mesmo se nenhum caminho mudou. Incluir novas dependências e preservar a distinção entre [regra aprovada](business-rules.md) e comportamento implementado. Ver [verificação](verification.md) para os comandos.

Os verificadores asseguram estrutura, não compreensão do agente ou cobertura comportamental. Grupos são Localizado quando há entrada, Traçado quando a sequência e dependências têm fontes e Verificado somente com evidência suficiente no código/versão em questão. Não promover grupos pela quantidade de testes da suíte geral.

Em 26/09/2026, a correção de [pagamentos concluídos](flows/payment-requests.md) acrescentou evidência unitária de apresentação e conferência do recebedor, além de integração em emulador da atualização com auditoria, concorrência e idempotência. O grupo permanece Traçado: essa validação é restrita à revalidação após pagamento e não certifica envio, webhook ou todas as fronteiras externas.
