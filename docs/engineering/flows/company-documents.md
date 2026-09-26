# Documentos da empresa: análise, arquivo e acesso

**Compatibilidade:** guia trazido do levantamento `3f64b3cc` e adaptado à main `70aaab65`. Resultados históricos citados não são homologação desta versão; ver [integração documental](../main-map-integration.md).

**Estado:** rastreamento estático concluído na base `3f64b3c`, atualizado em 2026-09-26. Entradas, sequência, dados, controles e efeitos estão descritos abaixo e nos subfluxos vinculados. Verificação integrada pendente; comportamento implementado não equivale a regra aprovada.

## Entrada e percurso

A [página de documentos da empresa](../../../src/app/dashboard/documents/company/page.tsx) exige `companyDocuments.view` para listar e `companyDocuments.manage` para preparar envio. Ela chama [`GET/POST/DELETE /api/documents/company`](../../../src/app/api/documents/company/route.ts), consulta [unidades](../../../src/app/api/documents/company/units/route.ts), pede [análise assistida](../../../src/app/api/documents/company/analyze/route.ts) para sugerir metadados e acessa [visualização/download](../../../src/app/api/documents/company/access/route.ts). A análise é uma sugestão da IA; a rota de upload usa título e categoria enviados pelo usuário.

A rota de upload exige `companyDocuments.manage`, PDF/JPG/PNG até 10 MB, categoria permitida, título e arquivo. Grava primeiro o arquivo no Storage em `company-documents/{id}/versions/01`, depois o registro em `companyDocuments`, depois o evento na subcoleção `audit`. A rota DELETE apaga primeiro o arquivo do Storage, marca `deletedAt`/remove o caminho no documento e então grava auditoria. Essas etapas cruzam Storage e Firestore e não são uma transação única. [`GET`](../../../src/app/api/documents/company/route.ts) lê toda a coleção, filtra exclusões e ordena em memória.

[`POST /access`](../../../src/app/api/documents/company/access/route.ts) exige `companyDocuments.view`, baixa o conteúdo do Storage, incrementa `accessCount` e grava evento de visualização/download por `Promise.all`, depois devolve o binário. A leitura do arquivo pode ter ocorrido mesmo quando uma escrita de auditoria falha. Conferir se o usuário deve visualizar todas as unidades ou só as suas: o código citado checa permissão de formalização, mas não filtra `unit` nessa rota.

## Dados, dependências e verificação

`companyDocuments` contém título, categoria, unidade, hash, caminho do arquivo, datas e autor; `audit` registra upload, acesso e exclusão. A [análise](../../../src/lib/documents/company-document-ai.ts) é uma integração externa e deve ser revisada quanto a dados enviados e erro antes de mudá-la. `npm run check` passou para a documentação; para alteração funcional, testar permissão direta, categoria/MIME/tamanho, falha parcial Storage ↔ Firestore, retenção, unidade e contagem/auditoria de acesso. O percurso está complementado neste guia; essas verificações permanecem pendentes para o estado `Verificado`.

## Unidade, retenção e falha parcial rastreadas

Na [rota de arquivo](../../../src/app/api/documents/company/route.ts), `unit` é texto saneado e `expiresAt` é metadado opcional; não há validação de escopo da unidade nesse handler nem rotina de purga disparada pelo vencimento. A leitura/acesso é pela permissão documental, não por propriedade de unidade. DELETE realiza remoção física do caminho corrente e marcação lógica posterior; não condiciona a operação a uma política temporal de retenção. Nenhum job de retenção de `companyDocuments` foi encontrado nas rotas de jobs pesquisadas. Não presumir que expirar remove ou impede acesso.

Upload, acesso e exclusão têm efeitos sequenciais descritos acima; não há compensação conjunta de arquivo, documento e auditoria no handler. Arquivo órfão, metadado sem binário e contador/auditoria parcial são cenários de teste da etapa seguinte. O percurso está identificado; a política desejada de unidade e retenção depende de decisão explícita.

## Evidências da etapa 2

A [verificação por grupo](../flow-verification.md) aponta testes disponíveis e lacunas na main. Execuções do worktree de correções não certificam esta base; funções ou regras isoladas não certificam o percurso completo.
