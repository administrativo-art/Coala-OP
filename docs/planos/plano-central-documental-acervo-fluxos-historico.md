# Plano — Documentos: Acervo, Fluxos e pendências e Histórico

## Estado atual e fila da sessão — 03/11/2026

- A interface da central, incluindo a classificação concluída e os ajustes de navegação, foi publicada pelos PRs 719/720 em `production` no commit `c48ed30d`; build/rollout `2026-11-03-002`, com 100% do tráfego confirmado. Essa informação vem da entrega anterior, não de deploy ou conferência de produção deste checkout documental. As notas cronológicas abaixo continuam evidência histórica de 02/11, inclusive afirmações de pendência que já foram superadas.
- A limpeza de duplicações assinadas foi encerrada em frente separada: 35 objetos, 41.033.526 bytes, 16 links e um comprovante de endereço interno. Ver [plano de armazenamento](plano-armazenamento-documental-unico.md). Não houve nova exclusão nesta sessão.
- Investigação de um telefone associado a um patrimônio específico: nenhum termo foi encontrado **nas fontes conferidas**. A conclusão não prova inexistência absoluta; não colocar nome, número ou identificador real do caso em documentação pública. Investigação encerrada com esse limite; reabrir somente diante de nova evidência, sem inventar vínculo.
- O pedido de **Excluir/Arquivar nas pastas** deve ser conferido por origem e permissão. Pastas estruturais do Acervo são projeções; a ação deve preservar o vínculo da pessoa e a trilha de origem, sem apagar cadastro. A cobertura exata por pasta/arquivo ainda não foi inventariada nesta entrega documental.
- Permanecem em frentes próprias: renovação de termo patrimonial sem nova posse (não implementada), registro INPI adiado por decisão do DEV, exceção legada RH `secureRoute` até 16/11 e lacunas de identidade global do [mapa de pessoa](../engineering/document-person-traceability.md). Nenhuma dessas frentes é declarada concluída.
- O [catálogo de trilhas](../engineering/document-trails.md) documenta fontes e lacunas. A futura remodelação do editor está somente no [plano do Gerador](plano-gerador-documentos.md); preservar a navegação atual até essa etapa.

Decisão posterior de 02/11/2026: pastas internas dos colaboradores ficam em Empresa → 12 - Colaboradores, sem numeração individual e sem mudar a publicação no portal. Implementação e E2E locais concluídos para essa árvore. Arquivamento de novos kits admissionais será único por solicitação; classificação dos sete registros legados depende de pré-voo exato, auditoria e preservação de acesso/bytes. As notas anteriores registram a evolução, não substituem esta decisão.

Decisão de 02/11/2026 após uso da interface: raiz do Acervo com Empresa e Colaboradores; Financeiro/Modelos dentro de Empresa, categoria Jurídico e numeração apenas nas pastas principais da empresa. Dossiês combinam árvore persistida, IDs vinculados e documentos gerados/admissionais autorizados. Gerador ganha entrada própria e hospeda a manutenção de modelos existente. Criação livre timbrada/IA e referências de produto estão separadas no [plano do Gerador](plano-gerador-documentos.md).

## 1. Objetivo e contrato de entrega

Data: 01/11/2026. Atualização: 02/11/2026. Status: implementação local concluída para as fontes e formatos suportados, verificações finais aprovadas; homologação externa delimitada abaixo; sem publicação ou migração real.

### Estado de fechamento — 02/11/2026

Correção após retorno visual do programador: a raiz anterior tinha aparência de explorador, mas encaminhava às telas antigas. Substituída por `ArchiveExplorer` compartilhado nas quatro áreas Empresa/Colaboradores/Financeiro/Modelos, com pastas reais de navegação, caminho clicável, busca, ordenação padrão por título, lista/grade, menu e prévia no ambiente. Modelos reutiliza a biblioteca oficial. Padrão de A–Z/Z–A incorporado ao design global para novas listas e ajustes futuros. E2E em Chromium/demo passou nas quatro áreas, com PDF renderizado e navegação entre páginas; validação desta correção substitui a dispensa visual anterior apenas para o recorte exercitado.

Publicação autorizada pelo programador em 02/11/2026 (“vamos commir e rollout”): seguir PR main → promoção production → App Hosting. Revisão obrigatória Doc Brown realizada e correções reavaliadas: título externo do pacote de fechamento separado do PDF, snapshot da empresa distinto de evento auditado e workspace explícito divergente recusado. Sem declaração de conformidade geral REP-P; INPI adiado e validação visual dispensada conforme decisões anteriores.

Complemento implementado após “pode implementar”: aba Assinaturas passou a incluir pacotes admissionais e contratos PJ presentes em `hrSignatureRequests`, reutilizando a integração existente. Leitura paginada por ID, autorização de assinatura/processo/unidade e resumo de eventos comprovados; ação abre a trilha original. Corrigida também a suposição de provedor Autentique em registros gerados sem identificação persistida. Nenhuma nova API externa ou envio foi criado. Nove testes dirigidos, integração Auth/Firestore/Storage, typecheck, lint, contratos e verificadores documentais aprovados nesta continuação; detalhes no chamado.

Esclarecimento sobre Autentique: a integração já existe no sistema, com criação/consulta de documentos, fluxo de assinatura, arquivamento e webhook; `apphosting.yaml` referencia o segredo da API. Esta etapa reutiliza essa integração. Não há pendência de implementar API nem de solicitar nova credencial ao programador. A ressalva abaixo descreve somente o teste externo desta alteração não executado nesta sessão; ausência de variáveis no processo local não comprova ausência de configuração no ambiente publicado.

Implementados menu, Acervo com acessos por origem, quatro filas com paginação, histórico separado, movimentação técnica auditada/concorrente, classificação posterior da empresa, nomes/versionamento/dedupe para tipos conhecidos da empresa, downloads canônicos do DP e prévia/confirmação financeira por fornecedor cadastrado. Ensaios autenticados executados em Auth/Firestore/Storage emulados; unidades, workspace, permissões, concorrência, integridade e nomes foram exercitados. As entradas cronológicas abaixo preservam a evolução e seus limites na ocasião; este quadro e a tabela por etapa representam o estado atual.

Decisão posterior do programador em 02/11/2026: dispensada, nesta entrega, a validação da interface no navegador, celular e por teclado. Esse teste não foi executado nem declarado aprovado; sua dispensa prevalece sobre os critérios de verificação visual abaixo e sobre as notas históricas que o listam como pendente. Os requisitos de comportamento da interface continuam válidos.

Continuação de 02/11/2026: concluídas a visão autorizada de lotes da equipe, as filas de férias/desligamento, a confirmação documental de contraparte legada por ID, a navegação compartilhada do Acervo e a trilha individual real de uploads/Financeiro. Financeiro ganhou explorador com pastas por contraparte confirmada, seleção, detalhes e download. A classificação manual da contraparte exige também `registration.view`, não altera o fornecedor da despesa e registra `scopeSource`. Formatos fora do catálogo permanecem com original preservado e revisão explícita; não se promete classificação universal.

Ressalva externa: homologação real do Autentique depende de ambiente de teste com credenciais e destinatários de ensaio. O ambiente local não possui token/segredo configurados; as referências de segredos de implantação não foram alteradas. Cliente real foi exercitado com transporte simulado, PDF sintético, sandbox obrigatório e webhook HMAC válido/inválido/repetido, sem enviar e-mails externos. Eventos históricos ausentes no legado aparecem como “Não registrado”; não serão inventados. INPI permanece adiado. Não houve commit, push, publicação ou backfill real.

### Avanço registrado em 01/11/2026

Conclusão adicional da Etapa 5 em 02/11/2026: classificação posterior da empresa sem reupload e trilha de nome aplicado; nomenclatura financeira para anexos com despesa vinculada e `supplierId` confirmado, com prévia/fingerprint/confirmação/versionamento e nome no download. Ensaio Auth/Firestore/Storage aprovado. A etapa ainda não abrange todas as origens/formatos nem resolve automaticamente contrapartes legadas sem ID; validação visual permanece pendente.

Entrada padronizada da empresa em 02/11/2026: seleção de unidade por ID e catálogo de tipo/referência, prévia estrutural, validação binária, versões concorrentes e dedupe por hash/identidade lógica. Fila A classificar inclui empresa sem tipo. Ensaio Auth/Firestore/Storage aprovado. Etapa 5 continua parcial: Financeiro, contraparte empresarial e editor de classificação pendente ainda não concluídos; nenhum legado foi renomeado.

Nomenclatura em 02/11/2026: programador aprovou IDs existentes como códigos de escopo de unidades/contrapartes. Download administrativo do DP unificado ao nome canônico com extensão; ensaio Auth/Firestore/Storage aprovado para bytes, nome, auditoria e revogação. Upload da empresa passou a ter IA opcional e corrigiu envio do estado de pasta esperado na atribuição pós-upload. Integração completa Empresa/Financeiro com entidade por ID permanece em andamento.

Movimentação e trilha em 02/11/2026: Acervo e Histórico abrem eventos reais de movimentação da empresa por documento, com paginação e acesso atual. Confirmação exige pasta/seção de origem esperadas; conflito é recusado com 409. Ensaio concorrente confirmou um único evento para duas confirmações iguais, recusa de origem obsoleta e preservação do caminho físico.

Ensaio ampliado em 02/11/2026 aprovado: admissão sem arquivo, acesso separado à empresa, paginação Financeiro/isolamento de workspace, ausências por unidade sem dados clínicos e consulta exata de gerados antigos/descartados. A API de gerados foi migrada para contrato seguro; a gestão detalhada busca o ID histórico fora da lista inicial de 300. Validação visual permanece pendente por ausência de navegador conectado.

Homologação adicional em 02/11/2026: ensaio autenticado das APIs aprovado nos emuladores Auth/Firestore (`node scripts/test-integration.mjs --document-central`). O JDK foi localizado no Homebrew; a ausência anterior era somente no caminho padrão. Corrigida incompatibilidade de garantia customizada nos enforcers. Cobertos acessos 401/403, paginação de gerados e uploads/histórico, proposta versus aplicado, revogação por unidade e isolamento Financeiro/DP. Interface, Storage e assinatura externa seguem pendentes de homologação.

Continuação em 02/11/2026: filas e histórico ganharam continuação por origem; Financeiro conserva cursor por etapa; uploads percorrem lote+item por ID, com autorização atual e custo limitado por chamada. União de páginas não descarta itens por corte global. Telas descartam respostas obsoletas durante troca de aba. Testes puros de cursor/guarda acrescentados. Homologação com Firestore e navegador autenticado ainda pendente: Java e navegador conectado indisponíveis no ambiente.

| Etapa | Estado | Evidência e limite |
| --- | --- | --- |
| 0 — contratos | Concluída | Fontes, permissões e limites registrados neste plano, no guia `document-central.md` e no chamado local. |
| 1 — tipos/adaptadores | Concluída | `src/features/documents/central`; testes de identidade, requisitos, assinatura, Financeiro e ausência. |
| 2 — DP/fluxos | Implementada | Quatro abas, admissões, gerados, assinaturas, lotes da equipe por pessoa/unidade/tipo, férias e desligamentos inclusive antes do arquivo. Ações continuam nas fontes autoritativas. |
| 3 — Financeiro/ausências | Implementada | Resumos autorizados e links para a origem; arquivos e decisões continuam nos serviços próprios. Paginação por etapa e proteção de dados clínicos. |
| 4 — Acervo | Implementada por origem | Raiz e navegação compartilhada Empresa/Colaboradores/Financeiro; explorador financeiro com arquivos e detalhes. Sem cópia de binários ou arrastar entre escopos. |
| 5 — nomenclatura | Implementada para o catálogo suportado | DP canônico; empresa com unidade, referência, versões/dedupe e classificação posterior; Financeiro com prévia/confirmação e escolha autorizada de contraparte legada por ID. Formatos não suportados preservam original. |
| 6 — histórico | Implementada sobre evidências existentes | Eventos reais individuais de empresa, uploads e Financeiro; estados atuais diferenciados; processos concluídos/cancelados consultáveis. Ausência de evento legado é explícita. |
| 7 — revisão | Verificações locais aprovadas | 70 testes unitários, integração Auth/Firestore/Storage com handlers reais, typecheck e lint dirigido aprovados. Contratos: 212 contratadas, 324 legadas congeladas, oito exceções, zero violações. Inventários/matrizes/links e diff válidos. Validação visual dispensada; assinatura externa real depende do ambiente de homologação. |

Verificação final em 02/11/2026: `npm run typecheck`; ESLint dirigido às superfícies documentais; 70 testes unitários da central, nomenclatura, pastas, política/distribuição e Autentique; `node scripts/test-integration.mjs --document-central`; `npm run check:security-contracts`; três inventários em modo `--check`, matriz de fluxos, links de engenharia e `git diff --check`. Todos aprovados. Uma rodada integrada teve ECONNRESET no Storage emulado; repetição completa e rodada posterior com cenários de dispensa/conclusão passaram. Emuladores encerrados pelo runner. Dependências restauradas com `npm ci --ignore-scripts`, sem alterar manifest/lock; Google Maps deixou de bloquear o typecheck. Build de publicação e CI não foram executados nesta entrega local.

As limitações acima são intencionais e aparecem na interface/documentação. Não houve criação de eventos retroativos, cópia de arquivos entre bancos, ampliação de permissão ou migração de registros.

Revisão/correção de 01/11/2026: revalidação atual por pessoa/unidade/tipo nos uploads e histórico; paginação dos gerados com cursor e consulta explícita de páginas antigas; gestão detalhada preservando assinados/cancelados; snapshots de uploads distinguindo proposta e arquivamento comprovado; consulta histórica admissional usando índice existente por criação. Paginação combinada das demais fontes e homologação autenticada continuam pendentes.

Entregar o módulo Documentos com três entradas: **Acervo**, **Fluxos e pendências** e **Histórico**. Empresa e colaboradores passam a ser divisões internas do Acervo. A central acompanha documentos recebidos, gerados e esperados, dos fluxos de DP e Financeiro, inclusive admissão, contratos CLT/PJ, remuneração, jornada, ausências e regularidade técnica REP-P.

O usuário autorizou implementação local. Commit, push, migração em banco real e publicação dependem de autorização própria conforme AGENTS.md. A implementação foi retomada após a etapa original de planejamento; o registro preserva as etapas efetivamente executadas e não equivale a conclusão integral do plano.

## 2. Situação inicial verificada e trabalho local a preservar

O checkout contém alterações locais anteriores, ainda sem publicação. Conferir `git status` e diff antes de qualquer edição; preservar trabalho existente e alterações de terceiros. Não usar reset/checkout para limpar o workspace.

| Parte | Implementado localmente | Limite real |
| --- | --- | --- |
| Menu | `src/components/sidebar.tsx`: Acervo, Fluxos e pendências e Histórico | Não significa integração de todos os módulos |
| Acervo | `src/app/dashboard/documents/page.tsx`: entradas Empresa e Colaboradores com permissões existentes | Ainda é uma página de entradas, não um explorador unificado |
| Fluxos e pendências | `src/app/dashboard/documents/generated/page.tsx` monta `generated/workspace.tsx` | Consulta somente documentos gerados |
| Histórico | `src/app/dashboard/documents/history/page.tsx` reutiliza workspace com `history` | Lista documentos gerados; não é histórico unificado de eventos |
| REP-P | Categoria Sistemas e conformidade, pasta Regularidade do sistema de registro de ponto, cinco seções, atribuição explícita com motivo/auditoria | Inferência visual de legados; nenhuma migração real; upload comum segue PDF/JPG/PNG |
| Nomenclatura | Plano separado e catálogo existente do DP | Nova regra transversal ainda não integrada aos uploads |

Arquivos locais relevantes: `src/lib/documents/company-document-folders.ts`, `src/app/api/documents/company/folder/route.ts`, `tests/unit/company-document-folders.test.ts`, `src/app/dashboard/documents/company/page.tsx`, `src/components/header.tsx`, guias e inventários alterados. A rota de pasta tem `secureRoute` e reutiliza `companyDocuments.manage`.

A filtragem provisória no workspace retira cancelados/substituídos e assinaturas concluídas da fila. Rever na fase 2: assinatura concluída não prova conclusão de todas as obrigações do processo. O Histórico atual continua sendo visão de registros, e não prova de existência de eventos antigos.

Verificações anteriores: lint sem erros (avisos preexistentes), inventários/mapas e links válidos. Typecheck bloqueado por dependência/tipos Google Maps em `src/features/dp/rep-p/unit-location-map.tsx`; registrar separadamente e conferir que não surgiram novos erros. Não declarar build/testes completos aprovados por isso.

## 3. Decisões de produto aprovadas

1. Menu principal Documentos → Acervo / Fluxos e pendências / Histórico.
2. Acervo apresenta empresa e colaboradores conforme autorização. Um documento referenciado em várias visões mantém uma única identidade e um único arquivo de origem.
3. Navegação parecida com explorador de arquivos: árvore, breadcrumbs, busca, lista, seleção, prévia, download. Movimentação por **Mover para…**, com destino permitido, motivo, confirmação e auditoria. Sem arrastar entre pastas.
4. Fluxos e pendências usa abas **A classificar**, **Em preparação**, **Fluxos** e **Assinaturas**. Histórico fica na entrada própria.
5. A classificar é fila de trabalho, não destino definitivo. Não inferir titular, competência, contraparte ou acesso para eliminar uma pendência.
6. Fluxos existem antes dos arquivos. Exemplo: ficha de registro aguardando contador deve aparecer mesmo sem upload.
7. Arquivamento, revisão, participação em processo e assinatura são dimensões distintas. O mesmo contrato aparece no processo admissional e na assinatura sem cópia e sem perder vínculos.
8. Concluir assinatura não conclui automaticamente admissão, classificação, conferência ou publicação. Finalizar um fluxo exige seus requisitos próprios.
9. Mover, mudar acesso e publicar ao colaborador são ações distintas, com autorizações próprias.
10. Histórico registra origem, original, análise por regra/OCR/IA, proposta, decisão humana, nome aplicado, destino, acesso, versões e assinatura. Não inventar eventos históricos ausentes.
11. Regras determinísticas primeiro; IA opcional quando faltarem informações. A central não dispara OCR/IA simplesmente ao listar ou abrir metadados.
12. Documentos de ponto de pessoas pertencem ao dossiê/fluxo operacional. A pasta REP-P guarda evidências técnicas do sistema; não encaminhar espelhos e justificativas de ausência para ela.

## 4. Fontes e pontos de integração

Consultar `docs/engineering/system-map.md`, `investigation-harness.md`, `modules/documents-privacy.md`, `modules/people-hr-dp.md`, `modules/finance.md`, `unit-contexts.md` e os guias específicos antes de alterar cada origem. Confirmar contratos no código; nomes abaixo são pontos de partida, não autorização para ignorar serviços existentes.

| Origem | Entradas e serviços | Dados/comportamento confirmado | Conferir antes da integração |
| --- | --- | --- | --- |
| Empresa | `src/app/api/documents/company/{route.ts,access/route.ts,folder/route.ts}` | `companyDocuments`, nome original/padronizado, hash, auditoria por documento | Escopo por unidade, paginação, retenção; GET atual lista coleção inteira e precisa correção se tocado |
| Dossiê DP | `src/app/api/hr/employee-documents/{route.ts,confirm/route.ts,access/route.ts,publication/route.ts,visibility/route.ts}` | `employeeDocuments` no banco RH, política por tipo, versão/dedupe e publicação | Autorização por pessoa/unidade, acesso próprio e download |
| Uploads DP pendentes | `src/app/api/hr/employee-documents/{batches/route.ts,item/route.ts,analyze-upload/route.ts,reanalyze/route.ts}` | `documentUploadBatches`, `documentUploadItems`; lotes retomáveis ANALYZING/AWAITING_REVIEW/PARTIALLY_FILED | Expiração, descarte, falha, acesso manage; listagem atual por pessoa não serve como agregação global |
| Admissão CLT/PJ | `src/app/api/hr/onboarding/route.ts`, `[id]/route.ts`, `[id]/accountant-workflow/route.ts`, `[id]/pj-workflow/route.ts`, `[id]/signature-documents/route.ts` | `onboardingProcesses` no RH, documentos esperados, estágios, paginação/cursor e redaction existentes | Aplicabilidade por vínculo; itens dispensados/opcionais; retorno do contador; permissão no detalhe |
| Geração/revisão | `src/app/api/documents/generated/route.ts`, `[id]/route.ts`, `[id]/audit/route.ts`; `src/features/hr/documents/*` | `generatedDocuments`, audit/resolvedValues; GET limitado a 300 sem paginação completa | Revisão, finalização, descarte, dedupe, DOCX/PDF e política sensível |
| Assinatura | `src/features/hr/documents/signature-workflow.server.ts`, `src/lib/hr/employee-document-signature.ts`; rotas/webhook existentes | Trilha já exibida no workspace | Listar estados/provedores reais, IDs, callbacks, falhas e evidências disponíveis; não inventar provedor interno |
| Financeiro | `src/app/api/financial/inbox/route.ts`, `src/features/financial/inbox/{repository.server.ts,workflow.server.ts,ingest.server.ts,mobile-upload.server.ts,linked-document-resolver.server.ts}` | API paginada, workspace e permissões específicas; anexos podem chegar antes de classificação/vínculo | Identidade canônica da obrigação/documento, revisão, arquivos, restrições financeiras, comprovação de pagamento |
| Ausências | `src/features/dp/absences/requests/{files.server.ts,attachment-access.server.ts,access.server.ts,workflow.server.ts}` e guia `flows/dp-absences.md` | Solicitações/anexos e auditoria próprios no RH | Saúde, acesso restrito, anexos temporários, retenção/expurgo e proibição de expor detalhes clínicos |

Auditoria existente não equivale a eventos completos de nomenclatura, entrega de e-mail ou acesso. Campo ausente aparece como “Não registrado”. “Enviado”, “Entregue”, “Visualizado” e “Assinado” só são exibidos com evidência do respectivo evento.

## 5. Arquitetura alvo

### 5.1 Identidade e contratos

Criar contratos puros em `src/features/documents/central/types.ts` e adaptadores por origem em `src/features/documents/central/adapters/`. Estes são caminhos propostos.

- `DocumentRef`: `{ source, sourceId }`; nunca assumir que UUID igual em dois bancos é o mesmo documento. Derivar chave visual estável com namespace.
- `WorkflowRef`: origem, processo e etapa; manter relação vários-documentos/um-processo e documento/vários-contextos quando suportado.
- `DocumentRequirement`: identidade estável do requisito, processo, tipo esperado, obrigatório/aplicável/dispensado, motivo de dispensa, responsável/prazo quando conhecidos, referências recebidas e estado. Pode existir sem arquivo.
- `DocumentWorkItem`: identidade estável, origem, tipo de pendência, referência opcional de documento, processo/requisito, campos faltantes, próxima ação permitida, responsável e datas disponíveis. Item é derivado da fonte; evitar segunda máquina de estados concorrente.
- `DocumentSummary`: nomes, tipo, titular/contraparte por código permitido, contexto, versão, origem, datas e capacidades de ação autorizadas.
- `DocumentEvent`: eventId, documentRef/requirementRef, processRef, tipo, ator, timestamp, origem, método de análise, mudanças allowlisted, correlação e referências de evidência. Nunca incluir tokens, paths privados, CPF completo, diagnóstico, prompt bruto ou saída integral de OCR.
- Dimensões independentes: classificação; preparação/revisão; assinatura; arquivamento; publicação. Usar estados explícitos de cada fonte, com mapeamento testado; não tratar todo `final` como assinado nem todo `signed` como fluxo concluído.

### 5.2 Consultas, agregação e índices

Implementar APIs da central com `secureRoute`, schema, autorização e limites. Proposta: `/api/documents/work-items`, `/api/documents/history` e detalhe por referência validada. Não criar esses nomes sem atualizar inventários/matrizes.

Preferir inicialmente consultas limitadas por origem no servidor com cursores por origem e resultado parcial explícito. Não buscar todos os usuários para consultar seus lotes. Não usar fan-out de auditoria por cada documento exibido na lista. Escolher origem na consulta histórica quando necessário para garantir paginação correta antes de fornecer união global.

Se a união global exigir projeção, implementar projeção mínima reconstruível, com origem/evento estável e consumidores idempotentes. Projeção é índice; fonte e autorização continuam nos módulos originais. Antes de adotar, documentar campos, índices, writers, exclusão/expurgo, revogação, atualização de permissões, custo e recuperação. Não armazenar snapshots sensíveis no índice. Não criar listeners/gatilhos ou jobs sem justificar a necessidade e registrar superfícies de runtime.

Cursores opacos e validados: origem, filtros, escopo e desempate estável por data+ID. Limite padrão 25, máximo 100 por chamada, limite de fan-out documentado. Definir semântica de ordenação entre origens; consulta parcial retorna aviso e retry, não lista vazia “sem pendências”. Total exato somente se suportado por consultas de contagem/projeção com custo conhecido; caso contrário exibir itens carregados e “há mais”.

Nenhum polling periódico de coleções. Atualização manual e invalidação após mutação são suficientes inicialmente. GET sem escrita/seed. Documentar leituras por abertura, paginação e gravações por evento; estimativa mensal deve declarar premissas, não números inventados. Índices novos vão para o arquivo do banco correto.

### 5.3 Escritas e auditoria

Ações da central chamam o serviço autoritativo da origem com autorização completa. UI não escreve diretamente no Firestore. Transições, metadados e evento devem ser atômicos no mesmo banco quando possível. Para Storage/provedor/bancos distintos, usar estado recuperável/idempotência e reconciliação explícita; não prometer transação distribuída.

Evento de análise diferencia regra, OCR e IA; registrar versão da regra/modelo quando disponível e apenas resumo permitido. Sugestão não é decisão aplicada. Registrar confirmação e correção humanas com antes/depois. `originalName` e hash de origem preservados. Mudança visual não regrava bytes assinados.

## 6. Permissões e privacidade — gate obrigatório

- `documents.view` não concede acesso ao Financeiro, saúde, todas as pessoas ou auditoria sensível.
- Cada adaptador consulta somente escopos autorizados pelo servidor: workspace, unidade, pessoa, política documental e ação. Usar helpers existentes; não copiar sua lógica para o cliente.
- Financeiro exige os controles já usados na inbox; DP exige autorização e política por pessoa/tipo; detalhes da auditoria de geração mantêm `sensitiveData.view`.
- Usuário com acesso exclusivo ao Financeiro precisa conseguir chegar à parcela documental autorizada sem receber acesso ao DP. Rever visibilidade do menu e landing, sem liberar novas permissões por padrão. Acesso próprio de colaborador permanece limitado ao que foi publicado para ele.
- Contagens, nomes, badges, buscas, erros e cursores também não podem revelar registros proibidos. Não contar globalmente e filtrar apenas os itens retornados.
- Antes de abrir arquivo ou executar ação, revalidar autorização na origem mesmo que a referência conste da lista da central.
- Mover não publica; publicar não muda pasta; pasta não concede acesso. Destinos inválidos ou outra pessoa/unidade são rejeitados pelo servidor.
- Histórico mantém acesso atual, retenção e expurgo da fonte. Não usar índice histórico para recuperar conteúdo que deveria ter sido eliminado.

## 7. Etapas de execução e critérios de aceite

### Etapa 0 — Recuperar contexto e contratos

Ler AGENTS.md, este plano e o [plano de nomenclatura](plano-nomenclatura-arquivo-documental.md). Abrir registro de execução ou continuar `.ai-work/development-technology/document-explorer-analysis-20261101/record.md`. Conferir diff local; anotar branch/SHA e verificações reaproveitáveis. Traçar interface → API → serviço → banco/Storage → consumidores de cada origem. Registrar matriz de campos/estados/permissões reais e lacunas antes de construir adaptador.

Aceite: cada origem tem fonte autoritativa, banco, autorização, paginação, estados e ações documentados. Não inferir estado por texto do nome nem associar pessoa por nome livre.

### Etapa 1 — Contratos e adaptadores puros

Implementar tipos, mapeamento de estados, classificação de pendências, identidade e regras de conclusão. Diferenciar pendência documental de cobrança financeira: boleto não pago, sozinho, não vira documento faltante. Mapear arquivo recebido sem classificação, dado obrigatório ausente, revisão, falha de geração, requisito não recebido e assinatura com problema.

Aceite: testes de contrato cobrem documento sem processo, processo sem arquivo, vários arquivos por requisito, dispensa/opcional, assinatura concluída com outro requisito aberto e IDs iguais de origens distintas.

### Etapa 2 — Fluxos e pendências do DP

Substituir a fila única por abas com URL/filtro persistente e suporte voltar/avançar. Manter links legados `/documents/generated` e acessos do gerador funcionando. Extrair workspace para componente de domínio se necessário, sem importar arquivos `page.tsx` como biblioteca.

- A classificar: lotes/itens pendentes reais, campos faltantes, análise disponível e ação Retomar revisão.
- Em preparação: gerados aguardando revisão/finalização, erros e retornos documentais que exigem trabalho.
- Fluxos: processos admissionais CLT/PJ com checklist aplicável, documentos esperados/recebidos, responsável e próxima etapa. Abrir processo/detalhe sem duplicar fluxo de negócio.
- Assinaturas: trilhas existentes, provedor real, partes e status com evidência; pendências de envio, recusa, expiração e falha com próxima ação autorizada.

Cada aba tem loading, vazio real, erro, acesso negado, paginação e aviso de dados parciais. Não esconder assinatura com falha como se estivesse concluída. Contagem respeita escopo e filtros.

Aceite: abrir admissão sem arquivo mostra requisitos não recebidos; upload move a situação do requisito correspondente; revisão e assinatura preservam identidade e vínculo; cancelados/substituídos continuam consultáveis pelo histórico. Não considerar fase concluída só porque os rótulos de abas foram adicionados.

### Etapa 3 — Financeiro e ausências

Adicionar adaptadores autorizados para anexos com classificação/vínculo pendentes e documentos financeiros confirmados. Manter classificação financeira nos serviços existentes; central não aprova pagamento nem executa operações bancárias. Ausências mostram apenas pendência e metadados mínimos permitidos, com abertura pelo serviço restrito de anexos. Temporário não vira arquivo definitivo automaticamente.

Aceite: permissão financeira isolada não permite DP e vice-versa; recibo, nota e comprovante bancário continuam tipos distintos; anexo de saúde não expõe diagnóstico no nome, busca, contagem ou histórico.

### Etapa 4 — Acervo e movimentação

Evoluir entradas Empresa/Colaboradores para navegação com árvore/breadcrumbs, lista e painel de prévia, usando PageContainer. Incluir referências financeiras conforme capacidades e contratos conferidos, sem clonar documentos para `companyDocuments`. Uma mesma referência pode aparecer em mais de uma vista.

Mover para… mostra origem, destinos permitidos, padrão sugerido, aviso de exceção, motivo e confirmação. Executa só quando a origem oferece movimentação suportada. Não simular movimento entre bancos/categorias por simples troca de string. Tratar colisão, documento removido durante ação e permissão revogada. Preservar navegação da pasta REP-P e cinco seções locais.

Aceite: teclado/toque funcionam, clique direito tem alternativa visível, movimento auditado e idempotente, nenhuma ampliação de acesso/publicação, nenhum drag entre pastas.

### Etapa 5 — Nomenclatura e entradas

Executar o plano de nomenclatura em conjunto, reutilizando catálogo DP existente (`src/lib/hr/employee-document-catalog.ts` e `employee-document-distribution.ts`). Não impor silenciosamente uma nova ordem de tokens ao legado. Definir códigos estáveis das contrapartes, referências, chave lógica e política por tipo antes de aplicar.

Servidor calcula nome/pasta, valida campos, formato real, tamanho e contexto; UI mostra prévia. Ausência de informação cria revisão. Preservar nome original, storagePath técnico, hash, assinatura, vínculo e publicação. Downloads usam nome canônico completo com extensão correta quando permitido; verificar hoje `storedName` sem extensão e consumidores que priorizam original. Preservar nomes fiscais AFD/AEJ e pares `.p7s`; upload adicional precisa validação própria.

Dedupe por conteúdo e escopo autorizado; não revelar que um arquivo existe em outra pessoa/unidade. Versão concorrente precisa proteção transacional/idempotência; novo mês/evento não deve substituir o anterior. Não chamar IA automaticamente por listar ou arquivar dados já confirmados.

Aceite: prévia e persistência coincidem, downloads padronizados, referências obrigatórias impedem arquivamento definitivo incompleto, duplicata exata não duplica, concorrência não produz versões conflitantes. Legados permanecem consultáveis; correção em massa somente com dry-run revisável e autorização de migração.

### Etapa 6 — Histórico unificado

Construir tela própria de eventos; deixar de tratar a lista do workspace como histórico completo. Filtros por origem, período, processo, documento, ator e evento, conforme campos realmente consultáveis. Linha do tempo individual acessível pelo Acervo e pelos Fluxos.

Cobrir upload, análise, proposta, confirmação/correção, arquivamento, movimento, revisão/finalização, assinatura, versão, acesso/publicação quando registrados e expurgo conforme política. Detalhe mostra antes/depois permitido e evidência. Legado sem evento traz metadados atuais com rótulo explícito de legado; uma reconstrução é evento de importação, nunca uma falsa ação atribuída ao usuário.

Aceite: demonstrar nome original → proposta → decisão → destino → visibilidade para um novo upload; mudança manual aparece com responsável/motivo; falha de análise não parece sucesso; dados financeiros/saúde não vazam. API paginada e sem fan-out ilimitado.

### Etapa 7 — Revisão e entrega local

Atualizar guias, matrizes, inventários, plano de nomenclatura e registro com etapas efetivamente concluídas. Conferir perfis existentes e necessidade de migração sem executá-la. Se houver impacto em ponto/documentos de jornada, revisão Doc Brown obrigatória antes de commit conforme AGENTS.md; usar somente especialistas necessários e regras do projeto.

Aceite: evidências dos cenários abaixo, lista de limitações reais, diff revisado, nenhuma funcionalidade simulada, nenhum status “completo” para fontes ausentes. Não publicar por inferência da autorização de implementação.

## 8. Matriz mínima de verificação

| Cenário | Resultado obrigatório |
| --- | --- |
| Admissão nova sem uploads | Requisitos aplicáveis visíveis, sem criar arquivo fictício |
| Documento opcional/dispensado | Não bloqueia indevidamente; dispensa mantém motivo |
| Arquivo sem tipo, titular ou competência | Fila A classificar; nome/destino definitivo aguardam confirmação |
| Regra suficiente | Nome/destino sem chamada OCR/IA |
| Análise sugere destino errado | Correção humana e proposta original registradas separadamente |
| Contrato em assinatura | Mesmo documentRef e processo; eventos mantidos |
| Assinatura finalizada com outro requisito pendente | Processo permanece pendente |
| E-mail sem confirmação de entrega | Mostrar enviado; entrega fica não confirmada |
| Pagamento comprovado sem recibo exigido | Pendência documental segue regra específica do fluxo |
| Download DP comum | Nome canônico válido e original preservado |
| Arquivo fiscal e assinatura destacada | Bytes, nome original e associação preservados |
| Duas confirmações simultâneas | Idempotência e versão consistente |
| Falha Storage/banco/provedor | Estado recuperável e retry sem duplicar documento ou envio |
| Perfil DP restrito a unidade/pessoa | Lista, detalhe, contagem, cursor e ação respeitam o escopo |
| Perfil financeiro apenas | Acesso financeiro autorizado; sem dados DP/saúde |
| Perfil próprio do colaborador | Apenas documentos publicados para o titular |
| Alteração de acesso ou expurgo | Histórico/índice não recuperam metadados proibidos |
| Outra aba muda/apaga documento | Detalhe atualiza com erro recuperável; não aplica mutação obsoleta |
| Paginação com data igual e nova entrada | Desempate por ID, sem sumir/duplicar itens silenciosamente |
| Origem indisponível | Resultado parcial informado; não afirmar ausência de pendências |
| Legado sem trilha | Exibir “Não registrado”; não fabricar evento |

Usar testes puros para adaptadores/estados e testes dirigidos de API/emulador para escopos, concorrência, paginação e falhas. A verificação visual em desktop/largura móvel e navegação por teclado foi dispensada pelo programador nesta entrega em 02/11/2026. Não considerar screenshot ou lint prova de segurança/integração.

## 9. Verificações e documentação obrigatórias

Seguir `docs/engineering/verification.md` e comandos dirigidos ao código alterado. Rodar lint dirigido, testes pertinentes, typecheck e `git diff --check`; separar falha ambiental já conhecida de regressões novas. Rotas novas ou alteradas exigem `secureRoute` em cada método ou exceção temporária delimitada e justificada, sem regenerar baseline legado para esconder dívida. Executar `npm run check:security-contracts`.

Ao alterar superfícies: revisar `flow-matrix.csv`, `surface-flow-matrix.csv`, `flow-coverage.md`, guias, `access-and-privacy.md`, e runtime quando houver job/gatilho. Regenerar e verificar `generate-route-inventory.py`, `generate-flow-entrypoints.py`, `generate-surface-inventory.py`; executar `check-flow-matrix.py` e `check-engineering-docs.py`. Não deixar chamadas perdidas ao extrair workspace.

Não criar novos geradores sem registro obrigatório em SYSTEM_DOCUMENT_TEMPLATES e harness de documentos. Alterar acompanhamento não autoriza alterar bytes de documentos já gerados/assinados, retenção legal, regras de ponto ou lógica financeira.

## 10. Instruções para o modelo implementador e revisão posterior

Trabalhar sequencialmente pelas etapas; após cada uma registrar arquivos, testes/comandos e resultado, contratos novos, leituras/escritas, limitações e próxima etapa. Se contexto acabar, retomar pelo registro e diff; não recomeçar nem apagar o trabalho. Usar o código atual como evidência; links deste plano não substituem inspeção de permissão.

Para a revisão posterior, entregar:

1. Resumo por etapa: concluída, parcial ou não iniciada, com evidência e motivo.
2. Relação de APIs/adaptadores/fontes integradas e permissões exigidas; campos expostos e sanitização.
3. Cenários da seção 8 com teste/arquivo/resultado e lacunas de homologação.
4. Fluxo demonstrável de admissão sem arquivos até assinatura, e upload financeiro até classificação/arquivo/histórico.
5. Decisões de arquitetura, novos índices/projeções/jobs e custo esperado com premissas.
6. Lista de migrações/dados reais pendentes, sem executá-las; instruções de dry-run e rollback quando aplicável.
7. Falhas preexistentes separadas de novas; sem declarar checks aprovados quando não executados.
8. SHA base, estado final do checkout e lista de arquivos alterados. Não fazer commit/push/publicação sem autorização já existente e confirmada no registro.

A revisão deve conferir especialmente isolamento de permissões entre origens, pendências sem arquivo, assinatura versus conclusão do fluxo, dedupe/versão concorrente, evento sugerido versus aplicado, paginação e tratamento de falhas entre sistemas. Esta lista é o roteiro de aceite; uma navegação com nomes novos não satisfaz a entrega completa.
