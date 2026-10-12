# Auditoria ampliada de superfícies — etapa 8

Levantamento original em `3f64b3c` com alterações locais, adaptado à main `70aaab65`. Objetivo: confrontar entradas que não aparecem necessariamente em páginas do dashboard com os guias existentes, identificar percursos transversais e lacunas. A conclusão desta auditoria é de mapeamento e diagnóstico; não certifica segurança nem comportamento de cada endpoint.

## Cobertura e método

- **352 handlers App Router, 20 páginas externas e 42 exports de Functions**: cada entrada tem classificação explícita em [surface-flow-matrix.csv](surface-flow-matrix.csv), fonte e guia no [inventário gerado](surface-inventory.md). Contagem por arquivo de handler, não por método HTTP nem subação de catch-all.
- Functions são resolvidas pelos exports e reexports de `functions/src/index.ts`, sem importar/executar os módulos. Símbolos auxiliares não exportados pelo entrypoint não são contados como funções implantáveis.
- A matriz não atribui automaticamente autorização pelo nome de uma pasta. Ela aponta o guia para investigação; os contratos aprofundados de webhooks/jobs e entradas compartilhadas estão em [runtime-surfaces](runtime-surfaces.md) e [access-and-privacy](access-and-privacy.md).
- Permanecem **53 grupos do dashboard / 73 guias em flows**, com **0 grupos verificados / 53 parciais**. Os complementos transversais cobrem autenticação/privacidade/auditoria/reparos e processamento sem tela, sem inventar páginas para aumentar essa contagem.
- Catch-alls de [compras](../../src/app/api/purchasing/%5B...path%5D/route.ts) e [cadastros](../../src/app/api/registry/%5B...path%5D/route.ts) concentram várias ações. Uma linha de inventário não substitui a leitura de cada ramo; mapas gerados a partir de páginas não alcançam todos eles.

## Achados adicionais e trabalho de correção

| ID | Evidência estática | Impacto e próximo teste |
| --- | --- | --- |
| A08-01 | [Reparo de recibos](../../src/app/api/admin/fix-receipts/route.ts): busca sem limite global, consulta/criação separadas e ID aleatório | Reproduzir duas chamadas concorrentes e falha após atualizar total; definir execução limitada, idempotente e por workspace. Não executado nesta integração documental. |
| A08-02 | [Upload operacional](../../src/app/api/uploads/operations/route.ts), ramo `purchase-receipt`: o diagnóstico encontrou permissão/existência sem comparação explícita do workspace | Corrigido em 2026-10-08 com contrato, workspace e escopo da unidade antes da gravação. Falha posterior no Storage/associação e compensação continuam pendentes de teste integrado. |
| A08-03 | [Privacidade](access-and-privacy.md): o diagnóstico encontrou `settings.view` no gate compartilhado e atualização/auditoria separadas | Corrigido em 2026-10-08: leitura e gestão separadas, schemas estritos e escrita+auditoria transacionais; emulador confirma leitor 403 em POST/PATCH e gestor autorizado. Máquina de estados completa permanece pendente. |
| A08-04 | [Jobs de análises](runtime-surfaces.md): GET recomputa/anonimiza | Avaliar migração coordenada para POST e callers configurados; ausência de scheduler no entrypoint não prova ausência em produção. |
| A08-05 | [Stone Pix](../../src/app/api/webhooks/stone/conciliation/route.ts): exclusão e inclusão em batches, processamento em `after` | Testar mesma publicação simultânea, interrupção entre batches e reentrega; considerar troca de versão publicada após conclusão. Nenhuma falha remota reproduzida aqui. |
| A08-06 | [Auditoria enviada pelo cliente](../../src/app/api/audit/log/route.ts): o diagnóstico encontrou ação/módulo declarados sem marcador estrutural e erro bruto | Corrigido em 2026-10-08 com schema, contrato, erro sanitizado, `trust_source=client-declared` e namespace `client`; eventos autoritativos de privacidade são marcados separadamente. |
| A08-07 | [Inter cobrança](../../src/app/api/financial/cash-deposits/inter/webhook/route.ts): URL configurada com segredo em query; receptor persiste corpo bruto | Revisar acesso/retencão dos eventos e saneamento dos logs na infraestrutura. A resposta saneada do endpoint não comprova que proxies ocultem a query. |

Esses achados são diagnósticos para uma rodada de correção, não foram corrigidos silenciosamente durante o levantamento. Não houve chamadas operacionais, pagamentos, leitura de segredos nem alteração em produção. Testes da etapa 7 continuam com seu escopo original.

## Manutenção e limites do verificador

Verificações atuais constam no [relatório de integração](main-map-integration.md). Resultados da etapa 8 no worktree anterior são históricos e não certificam o código desta base.

`python3 scripts/generate-surface-inventory.py --check` exige igualdade entre fontes descobertas e classificação: criação/remoção de handler, página externa ou export exige revisão da matriz. Guia ausente, linha repetida e símbolo de função não resolvido fazem o comando falhar. A geração não cria classificações por conta própria. Formas novas de export não suportadas devem ser tratadas explicitamente, não ignoradas.

Alterar comportamento sem mudar caminho continua exigindo atualização manual de contrato, consumidores e guia pelo AGENTS.md. Scripts avulsos, configuração remota de Cloud Scheduler, extensões Firebase, funções fora do entrypoint configurado e cada subação dinâmica não são certificados por este inventário. Consulte [acompanhamento](system-map-execution.md) para verificações executadas e próximas etapas.
