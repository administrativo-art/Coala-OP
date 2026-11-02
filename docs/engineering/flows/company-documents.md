# Documentos da empresa: análise, arquivo e acesso

## Entrada padronizada — 02/11/2026

Classificação posterior: arquivos pendentes podem ser confirmados pelo botão Classificar documento, via `PATCH /api/documents/company/intake`, com schema, permissão, escopo atual e versão esperada. A transação aplica tipo/categoria/escopo/referência/nome e índices de versão, grava `DOCUMENT_CLASSIFIED` e preserva original/hash/caminho. Repetir a decisão é idempotente; decisão divergente após confirmação ou arquivo idêntico já arquivado produz 409. O Histórico individual agora inclui esse evento com nome aplicado. Ensaio concorrente aprovado em emuladores.

A tela envia novos arquivos por `POST /api/documents/company/intake` (secureRoute). Escopo é escolhido explicitamente entre empresa inteira e unidade por ID de `dp_units`; as opções retornadas por `GET /api/documents/company/units` são allowlisted e filtradas pelo acesso atual. O servidor revalida existência, arquivamento e autorização da unidade; sugestão de unidade da IA não estabelece identidade.

Catálogo inicial em `company-document-intake.ts`: cartão CNPJ, inscrição estadual, contrato social, alvará, certidão, contrato empresarial e três tipos de evidência técnica REP-P. Tipos com referência exigida não arquivam definitivamente sem ela. Nome usa tipo, ID de unidade/GERAL, referência e versão; a prévia apresenta vNN e avisa que a versão é alocada na confirmação. Sem tipo, preserva original, usa `pending_classification`/A classificar e aparece na fila da central. A posterior resolução desse tipo ainda precisa de ação própria; não foi feito backfill de legados.

Somente PDF/JPG/PNG até 10 MB, com cabeçalho binário coerente com MIME declarado. Caminho privado usa UUID. Transação grava ficha, evento de upload e índices privados `companyDocumentLogicalKeys` e `companyDocumentContentKeys`, com identidade lógica incluindo workspace/tipo/escopo/referência normalizada. SHA-256 idêntico na mesma identidade devolve a instância existente, inclusive se ela não for a versão atual; novo conteúdo incrementa versão sob concorrência. Arquivo temporário da tentativa duplicada é removido; falha da transação tenta remover apenas o blob recém-criado. O legado desconhecido ainda não entra na mesma identidade lógica e não é deduplicado por inferência. Os endpoints legados de lista/exclusão permanecem como antes.

Ensaio `node scripts/test-integration.mjs --document-central` aprovado para nomes com ID, unidade proibida, cabeçalho inválido, referência obrigatória, duplicata simultânea, revisão, reenvio de versão antiga e fila de classificação, usando apenas Auth/Firestore/Storage emulados. Upload de formatos fiscais adicionais e escolha de contraparte empresarial ainda não estão implementados.

Em 02/11/2026, adicionar arquivo deixou de chamar IA automaticamente. A entrada inicia em A classificar (exceto contexto explícito da pasta técnica), com preenchimento manual ou botão Sugerir com IA; falha da sugestão permite continuar manualmente. O arquivamento aguarda o término de uma análise solicitada. A atribuição pós-upload também envia a pasta/seção esperadas, compatível com a proteção concorrente da rota.

Atualização local de 02/11/2026: movimentação exige a pasta/seção esperadas pelo cliente e recusa alteração obsoleta com 409; repetir destino não duplica auditoria. O Acervo abre a trilha individual no Histórico, com eventos reais de origem/destino/ator/motivo. Teste integrado dirigido em `tests/integration/document-central.test.mjs` cobre concorrência, idempotência e caminho físico preservado. Contratos e limites da trilha constam na [Central documental](document-central.md).

**Compatibilidade:** guia trazido do levantamento `3f64b3cc` e adaptado à main `70aaab65`. Resultados históricos citados não são homologação desta versão; ver [integração documental](../main-map-integration.md).

**Estado:** rastreamento estático concluído na base `3f64b3c`, atualizado em 2026-09-26. Entradas, sequência, dados, controles e efeitos estão descritos abaixo e nos subfluxos vinculados. Verificação integrada pendente; comportamento implementado não equivale a regra aprovada.

## Entrada e percurso

A [página de documentos da empresa](../../../src/app/dashboard/documents/company/page.tsx) exige `companyDocuments.view` para listar e `companyDocuments.manage` para preparar envio. Ela chama [`GET/POST/DELETE /api/documents/company`](../../../src/app/api/documents/company/route.ts), consulta [unidades](../../../src/app/api/documents/company/units/route.ts), pede [análise assistida](../../../src/app/api/documents/company/analyze/route.ts) para sugerir metadados e acessa [visualização/download](../../../src/app/api/documents/company/access/route.ts). A análise é uma sugestão da IA; a rota de upload usa título e categoria enviados pelo usuário.

A rota de upload exige `companyDocuments.manage`, PDF/JPG/PNG até 10 MB, categoria permitida, título e arquivo. Grava primeiro o arquivo no Storage em `company-documents/{id}/versions/01`, depois o registro em `companyDocuments`, depois o evento na subcoleção `audit`. A rota DELETE apaga primeiro o arquivo do Storage, marca `deletedAt`/remove o caminho no documento e então grava auditoria. Essas etapas cruzam Storage e Firestore e não são uma transação única. [`GET`](../../../src/app/api/documents/company/route.ts) lê toda a coleção, filtra exclusões e ordena em memória.

[`POST /access`](../../../src/app/api/documents/company/access/route.ts) exige `companyDocuments.view`, baixa o conteúdo do Storage, incrementa `accessCount` e grava evento de visualização/download por `Promise.all`, depois devolve o binário. A leitura do arquivo pode ter ocorrido mesmo quando uma escrita de auditoria falha. Conferir se o usuário deve visualizar todas as unidades ou só as suas: o código citado checa permissão de formalização, mas não filtra `unit` nessa rota.

## Dados, dependências e verificação

`companyDocuments` contém título, categoria, unidade, hash, caminho do arquivo, datas e autor; `audit` registra upload, acesso e exclusão. A [análise](../../../src/lib/documents/company-document-ai.ts) é uma integração externa e deve ser revisada quanto a dados enviados e erro antes de mudá-la. `npm run check` passou para a documentação; para alteração funcional, testar permissão direta, categoria/MIME/tamanho, falha parcial Storage ↔ Firestore, retenção, unidade e contagem/auditoria de acesso. O percurso está complementado neste guia; essas verificações permanecem pendentes para o estado `Verificado`.

## Pasta de regularidade técnica do sistema REP-P (01/11/2026)

Em **Documentos da empresa → Sistemas e conformidade**, a pasta virtual **Regularidade do sistema de registro de ponto** reúne evidências da conformidade técnica do REP-P. Não se destina a comprovantes individuais, espelhos de ponto ou prova de jornada. A categoria para novos arquivos é **Sistemas e conformidade**. Os sete registros antigos dessa família ainda têm categoria legada **Trabalhista e RH** e são reconhecidos pelo título que começa com `REP-P —`; a pasta os mostra separadamente dessa categoria, sem alterar registros reais. A classificação explícita em `folderCode: time_recording_compliance` prevalece para novos arquivos. Um `folderCode: null` explícito retira o arquivo da pasta, sem mudar categoria, unidade, conteúdo, hash, retenção ou permissão. A pasta é um filtro de metadados, não um diretório do Storage.

A tela de upload permite escolher essa pasta na categoria **Sistemas e conformidade**. Quando o upload começa dentro da pasta, ela e a categoria são pré-selecionadas e o nome inicial vem do arquivo, sem chamada automática à IA; o usuário confere os dados antes de anexar. Após o upload legado, chama [`POST /api/documents/company/folder`](../../../src/app/api/documents/company/folder/route.ts) para gravar o destino; se a segunda chamada falhar, o arquivo permanece anexado e a tela avisa que é preciso atribuir a pasta pela ação **Mover para…**. A rota exige `companyDocuments.manage`, valida a categoria ou um registro REP-P legado, exige motivo e grava mudança e auditoria na mesma transação. A classificação legada cobre os sete registros REP-P encontrados em consulta de metadados de 01/11/2026; não reclassifica outros documentos por semelhança de nome. Arquivos ZIP, TXT e P7S já presentes no acervo são exibidos pela pasta, mas o formulário de upload atual continua aceitando apenas PDF/JPG/PNG. A pasta organiza evidências; não atesta conformidade legal.

## Unidade, retenção e falha parcial rastreadas

O grupo REP-P tem seções virtuais estáveis: **01 Registro e atestados**, **02 Amostras e assinaturas**, **03 Relatórios de validação**, **04 Controles técnicos** e **05 Dossiês e versões**. O servidor exige `evidenceSection` ao atribuir um arquivo à pasta e audita origem/destino. A interface infere somente os sete títulos legados inequívocos; novos uploads exigem escolha explícita da seção. Isso não altera o conteúdo do arquivo nem demonstra regularidade jurídica. A nomenclatura transversal de Financeiro, DP e empresa segue o [plano de padronização](../../planos/plano-nomenclatura-arquivo-documental.md).

Na [rota de arquivo](../../../src/app/api/documents/company/route.ts), `unit` é texto saneado e `expiresAt` é metadado opcional; não há validação de escopo da unidade nesse handler nem rotina de purga disparada pelo vencimento. A leitura/acesso é pela permissão documental, não por propriedade de unidade. DELETE realiza remoção física do caminho corrente e marcação lógica posterior; não condiciona a operação a uma política temporal de retenção. Nenhum job de retenção de `companyDocuments` foi encontrado nas rotas de jobs pesquisadas. Não presumir que expirar remove ou impede acesso.

Upload, acesso e exclusão têm efeitos sequenciais descritos acima; não há compensação conjunta de arquivo, documento e auditoria no handler. Arquivo órfão, metadado sem binário e contador/auditoria parcial são cenários de teste da etapa seguinte. O percurso está identificado; a política desejada de unidade e retenção depende de decisão explícita.

## Evidências da etapa 2

A [verificação por grupo](../flow-verification.md) aponta testes disponíveis e lacunas na main. Execuções do worktree de correções não certificam esta base; funções ou regras isoladas não certificam o percurso completo.

## Navegação documental — 01/11/2026

O menu Documentos oferece Acervo (`/dashboard/documents`), Fluxos e pendências (`/dashboard/documents/generated`) e Histórico (`/dashboard/documents/history`). Acervo oferece Empresa, Colaboradores e Financeiro somente quando a permissão da origem autoriza. O histórico agrega uploads da empresa, documentos gerados, lotes próprios do dossiê, processos admissionais e registros financeiros autorizados; diferencia evento comprovável de estado atual legado. Fluxos e pendências usa a [central documental](document-central.md). Não houve migração de dados.
