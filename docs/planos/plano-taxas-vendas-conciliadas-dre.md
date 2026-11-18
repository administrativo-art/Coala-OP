# Taxas de vendas conciliadas na DRE

**Data:** 17 de novembro de 2026. **Estado:** plano local, sem implementação, lançamentos ou publicação autorizados nesta etapa. Base local preservada: `7eed4f9e` → `bc0f99e1` → `b3c4a1f9`. Execução de produção depende de revisão específica do plano e autorização futura; não está implícita em “Qual o plano?”.

## Objetivo e decisões

Confirmar o bruto da venda no PDV e na adquirente, reconhecer a taxa na competência da venda e manter o recebível previsto separado do dinheiro efetivamente recebido. Não esperar D+30 para definir a taxa quando ela já estiver apurada na captura/agenda. O vencimento segue a agenda e as parcelas da venda, não uma regra fixa de fim de mês.

Proposta de classificação a validar: MDR/cartão e tarifa PIX da venda em **custos variáveis**, reduzindo a contribuição; antecipação e juros em **despesas financeiras**. Hoje “Taxas de cartão” está mapeada em financeiro: o plano não muda esse cadastro nem reclassifica outubro. A receita continua bruta do PDV, com taxa separada. Dinheiro segue o fechamento, excluindo fundo/troco/suprimentos/sangrias da venda; faltas e sobras permanecem separadas no resultado operacional.

## Situação verificada e reaproveitamento

- A conciliação PDV × Stone já possui identificadores, conflitos, candidatos e revisão; o bruto deve ser separado por unidade, data e meio. Igualdade de totais não comprova transações individuais.
- A agenda/carteira já contém captura confirmada, parcelas, bruto, líquido previsto e vencimento antes do pagamento. A apresentação distingue taxa explícita, diferença de alta precisão e valor derivado sujeito a arredondamento.
- O registrador `acquirer_fee` atual exige evento de pagamento e grava despesa paga. Falta adaptá-lo para reconhecimento antes da liquidação e exigir conciliação da venda como pré-condição. Não reutilizar o estado “pago” para uma taxa apenas apurada.
- Claims por componente, fingerprints, revisões e proteções contra duplicidade já existem e serão reutilizados.
- A fonte PIX estruturada existente é **Stone**, com estabelecimento, E2E/evento e valores/taxa explícitos. PIX de outro banco/provedor precisa fonte própria comprovada; não presumir cobertura. A taxa de referência mais comum dos arquivos não equivale a um contrato tarifário aprovado.

Fontes técnicas: [conciliação de vendas](../engineering/flows/stone-sales-review.md), [recebíveis](../engineering/flows/receivables-stone.md), [evidências de taxa](../../src/features/financial/acquirer-fees/evidence.ts), [registrador](../../src/features/financial/acquirer-fees/repository.server.ts), [carteira](../../src/features/financial/receivables/portfolio-projection.ts), [taxa e parcelas não pagas](../../src/features/financial/receipts-reconciliation/stone-account.ts), [PIX](../../src/features/financial/sales-reconciliation/pix-source.ts).

## Fases de implementação futura

1. **Comprovar fontes e cobertura.** Piloto proposto: outubro de 2026, três unidades, sujeito à confirmação quando a implementação for autorizada. Conferir vínculos PDV/adquirente/banco, período e arquivos disponíveis; separar cartão, PIX e dinheiro. Produzir diagnóstico sem escrita, com ausências e custos estimados de consulta.
2. **Conciliar a venda confirmada.** Reutilizar snapshots e matching por IDs explícitos: transactionId/NSU, autorização/terminal e, no PIX, endToEnd/eventId. TID/txid somente quando a fonte os trouxer. Unidade, canal, valor, data e status devem ser compatíveis; fontes revisadas invalidam o aceite anterior. Conflitos, cancelamentos, grupos ambíguos e cobertura parcial ficam pendentes, sem “bater” artificialmente por total.
3. **Apurar taxa e recebível antes do crédito.** Usar a taxa informada pela adquirente ou bruto/líquido previstos com precisão e descontos segregados. Sem fonte exata, aplicar apenas contrato aprovado e versionado por vigência, bandeira, modalidade, parcelas e arredondamento, identificando provisão estimada. Sem fonte/contrato: desconhecido, não zero. Preservar evidências, versão e origem da taxa.
4. **Integrar à DRE com idempotência.** Após conciliação válida e decisão de classificação, reconhecer uma vez por workspace/adquirente/transação/parcela/tipo. Criar ou vincular o registro existente, sem nova receita e sem boleto/pagamento separado para taxa retida. Estados distintos: pendente, estimada, apurada, a receber e liquidada; não marcar despesa paga antes do evento real. Reutilizar permissões, escopo, claims, fingerprints e auditoria atuais; não criar infraestrutura paralela.
5. **Conferir liquidação e revisões.** Baixar o recebível quando o crédito efetivo ocorrer. Conciliar data/valor, separar antecipação e outros descontos comprovados e ajustar somente a diferença da taxa anteriormente reconhecida. Cancelamento/estorno mantém vínculo à origem; período fechado passa por revisão/reabertura autorizada, sem sobrescrita silenciosa nem segunda despesa integral.
6. **Validar e liberar gradualmente.** Testes sintéticos e de integração, relatório de dry-run do piloto, revisão independente de segurança/cálculo e aprovação dos efeitos antes de qualquer escrita. Implementação, commit, publicação e execução de dados seguirão somente as autorizações futuras aplicáveis. Primeiro uma unidade/período controlado; ampliar após conciliação e invariantes comprovadas, com procedimento de reversão.

## Interface e limites

Mostrar claramente venda confirmada, taxa apurada/estimada/desconhecida, líquido previsto, vencimento e recebido efetivo. Abrir pendências e referências de origem sem apresentar estimativa como taxa real. Automação futura só atravessa o portão validado; revisar uma taxa não ignora permissões nem transforma dado ausente em zero.

Consultas sob demanda, por unidade/data/canal e IDs vinculados; sem novas coleções recorrentes ou varredura financeira global como requisito do plano. Reutilizar os limites existentes: até 500 componentes/consulta, 100 por grupo e até 31 datas de origem; PIX até 500 eventos por arquivo íntegro. Não processar o máximo por padrão. Antes do piloto, estimar dias/arquivos/parcelas e leituras reais da janela, cachear evidências íntegras e interromper com pendência se faltar cobertura ou exceder limites. Nenhuma consulta adicional foi executada para escrever este plano.

## Critérios de aceite

- Venda de **R$100**, taxa apurada de **R$3** e crédito previsto de **R$97 em D+30**: na venda, receita100, taxa3 e recebível97; na liquidação, recebido97 sem repetir receita ou taxa.
- Taxa zero explicitamente confirmada é zero conhecido; taxa desconhecida fica pendente. Estimativa contratual é identificada e ajustada por delta quando houver apuração.
- Parcelas, liquidações agrupadas e créditos parciais conservam componentes e competência; não conciliar o bruto de todos os meios com um depósito líquido ou um único canal.
- Repetir, reimportar ou reprocessar fonte não duplica despesa; revisão de evidência altera versão e invalida decisão incompatível.
- Cancelamento, estorno, antecipação, alteração de vínculo e período fechado têm casos testados; nenhuma diferença residual vira taxa inventada.
- Dinheiro permanece no fechamento; faltas/sobras não alteram receita bruta. Totais da DRE distinguem custos variáveis de despesas financeiras segundo a regra validada.

## Pendências para decisão

Validar a classificação gerencial proposta; confirmar piloto e cobertura efetiva das fontes, inclusive PIX fora da Stone; definir contratos tarifários aprovados quando necessários. Após isso, autorizar implementação local. Produção/publicação continuam fora do escopo atual.


## Execução local autorizada —17/11/2026

Usuário autorizou implementar mantendo **commit local sem publicação**. Implementação em branch `feat/acquirer-fees-sale-recognition-20261117`, base local `7eed4f9e` (preserva correções e relatórios DRE anteriores). Fontes sintéticas/emulador; nenhuma consulta/cadastro/escrita de produção. Ações explícitas passam pelo portão conciliado e pelos mesmos claims; nenhuma automação em segundo plano foi ativada. Contratos sem fonte ficam vazios/pendentes; configuração administrativa explícita, sem recategorização histórica. A liquidação comprovada é da adquirente, não um atestado de crédito no extrato Inter.

Limite assumido: não há certificado mensal integral de taxas; a DRE comunica cobertura não certificada e estimativas/incompletude sem esconder receita/CMV conhecidos. O bloqueio de competências configurado pertence à apuração de taxas; não cria fechamento contábil global. Piloto/outubro, publicação e qualquer efeito real continuam dependendo de autorização futura específica. [Contrato implementado e custo](../engineering/flows/stone-sales-review.md#taxas-por-venda-conciliada--implementação-local-17112026). Revisão independente exigida antes do commit local.


### Revisão independente e correções —17/11/2026

Primeira revisão reprovou sete cenários apesar dos checks iniciais passarem: igualdade de valor entre origens distintas, antecipação corrigida para zero, competência financeira fechada, retomada após estorno, compatibilidade/versão legada, referências/ambiguidade de mapping e apresentação da taxa vigente. Os cenários receberam correções e regressões dirigidas;16/16 integrações no emulador e23/23 unitários/regressão passaram. A rota real foi exercitada com ator sintético do Auth Emulator para histórico/cancelamento legado, recusa de create e autenticação. A configuração usa formulário de negócio, sem editor JSON. O código permanece congelado para nova revisão; nenhum commit/publicação nem dado real alterado. Typecheck global continua limitado aos25 diagnósticos base de documentos; não é apresentado como aprovado.

Releitura independente aprovou os achados2–7 e detectou residual de contagem da busca manual (26 origens vinculadas ainda atingiam o antigo teto). A correção usa helper único paginado nos três caminhos, com limite operacional explícito250+1 e diagnóstico próprio quando a cobertura não é comprovada. Legado sem campo de origem continua pesquisável.23/23 integrações dirigidas passaram após a correção; segue aguardando aprovação final antes do commit local.

## Ampliação de autorização para rollout —17/11/2026

Usuário autorizou “pode continuar até o rollout” para a cadeia local DRE (integridade/rateios, exportações, filtro de colaboradores e taxas conciliadas). A execução segue PRmain/quality, promoção seletiva para production e AppHosting, com validação de SHA/build/rollout/tráfego/HTTP. Nenhuma conta/contrato/taxa real, reconhecimento de despesa ou reclassificação histórica será criado pelo rollout. O preflight de fontes pessoais e índice técnico foi revisado separadamente; a lacuna de titular em arquivos PIX que admitem CPF permanece explícita e indisponível, sem equivalência por documento. Configuração financeira/piloto real continuam fora desta publicação de código.
