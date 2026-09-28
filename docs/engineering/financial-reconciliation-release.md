# Conciliação e DRE — preparação de publicação

Escopo local: navegação, receita integral PDV, diferenças físicas separadas, classificação de sangrias e taxas explícitas. Fechamento mensal não incluído. Este documento **não autoriza** publicar, migrar dados ou executar pagamentos.

## Antes da promoção

1. Obter autorização de commit/push/PR/merge/publicação. Revisar diff, estado do worktree, SHA e verificações aplicáveis. Preservar alterações de outros chamados.
2. Manter `verify`, `check:rules`, integração e build Functions verdes. HTTP autenticado em Auth/Firestore demo, sem navegador, executa `node scripts/test-reconciliation-api-e2e.mjs`; observação CI adicional, sem remover/alterar gates existentes. Teste visual não realizado nesta tarefa.
3. Preparar índices de `firestore.financial.indexes.json` e proteção de despesas de origem em `firestore.financial.rules`. Aguardar índices prontos; conferir escopo do banco coala-financeiro e diff exato. Perfis existentes reutilizados: DRE, fechamento(view/edit/approve/reopen), despesas(view/create/edit/pay); taxas somente administrador padrão. Sem migração de permissões.
4. Coordenar App Hosting e Functions `cashClosureSummaryWritten`/`cashClosureSummaryReinforcement` da mesma versão: ambos escrevem contrato DRE v1. Evitar escritor antigo sobrescrevendo resumos novos. Não habilitar registros financeiros novos enquanto as proteções/escritores não estiverem implantados. Se a janela não puder ser coordenada, suspender operações desse fluxo durante a implantação.
5. Produto segue PR em main validada → promoção específica production. Confirmar SHA no build, rollout SUCCEEDED e resposta HTTP. Não publicar este produto por Sites ou substituir o fluxo por deploy genérico.

## Histórico e verificação operacional posterior

- Histórico sem fonte comprovada fica indisponível, não zero. Não há migração automática em GET. Com autorização separada, preflight por unidade/dia: verificar fonte, contagem existente, sangrias/classificações e despesas manuais; depois reutilizar sincronização PDV e revisão de operadores. Ver [recuperação na DRE](flows/dre.md).
- Não recriar despesa que já existe. Vínculo com avulsa paga/obrigação materializada/rateio não é suportado nesta entrega: resolver no fluxo original, sem contornar o bloqueio. Taxa manual com valor diferente pode escapar da busca de coincidência; confirmação humana não é garantia automática de deduplicação semântica.
- Conferir uma unidade/dia: venda bruta, movimentos, esperado físico, contado, falta/sobra, despesa/categoria/competência, idempotência e ausência de novo pagamento. Taxa retida aparece uma vez na DRE e não volta a reduzir recebível líquido. Comparação de vendas e prévia de taxas permanecem somente leitura.
- Observar erros por eventId, limites, conflitos, latência e leituras/retries. Nenhum polling novo. Queries de fechamento limitadas a dias/linhas/operadores; catálogos/candidatos/histórico limitados. Valores acima dos tetos exigem tratamento explícito, não truncamento.

## Reversão e encerramento

Antes de qualquer apropriação nova, reversão coordenada de app/Functions pode retornar a versão anterior validada. **Depois de registros sourceSettlement, rollback cego da DRE antiga é inseguro:** receita antiga já reduzida por sangria somada às novas despesas deduziria duas vezes. Preferir correção compatível à frente, interromper novas apropriações e preservar dados/auditoria/proteções. Não apagar despesas/reservas para liberar retry. Correções individuais usam desfazer com motivo e guard financeiro.

Não remover o worktree enquanto houver mudanças não integradas ou registros locais únicos. Revisar encerramento após publicação autorizada; preservar auditoria necessária. Plano temporário só pode ser descartado depois da parte futura do fechamento mensal migrar para registro próprio e de confirmação de conclusão.
