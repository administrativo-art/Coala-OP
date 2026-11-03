# Central documental: Acervo, fluxos e histórico

02/11/2026 — Acervo e processo compartilham o mesmo objeto assinado: uma pasta visual ou um novo vínculo não cria uma cópia do PDF. Remover sua entrada do Acervo não apaga o original assinado ainda usado pela trilha; o registro removido continua inacessível pelas APIs do Acervo. Cópias históricas e uploads da coleta dependem da análise separada em [armazenamento documental único](../../planos/plano-armazenamento-documental-unico.md).

02/11/2026 — decisão posterior: a raiz tem Empresa; a pasta interna de pessoas passa a **12 - Colaboradores**, preservando a numeração das outras pastas. Pastas individuais continuam sem números. O agrupamento visual não amplia permissões: cada origem revalida seus próprios acessos. As notas anteriores de raiz Empresa/Colaboradores ficam substituídas. Um kit assinado com múltiplas referências legadas pode aparecer uma vez sem apagar registros ou arquivos.

02/11/2026 — revisão da árvore: Acervo tem Empresa/Colaboradores. Financeiro e Modelos ficam dentro de Empresa; rótulos principais numerados são apenas apresentação. Jurídico inclui processos e pareceres. DocumentNavigation mantém acesso de volta ao Acervo também em Fluxos e Histórico. Gerador reúne a geração existente e a manutenção de modelos; URLs legadas redirecionam. O [plano do Gerador](../../planos/plano-gerador-documentos.md) separa essa entrega da proposta de editor livre e assistência de redação por IA. Os parágrafos da primeira correção abaixo registram a organização anterior por quatro áreas, substituída por esta árvore.

**Fechamento local em 02/11/2026:** implementação revisável, sem publicação ou migração real. Testes puros e ensaio autenticado em Auth/Firestore/Storage emulados aprovados. Por decisão posterior do programador, validação no navegador, celular e por teclado dispensada nesta entrega (não executada/não certificada). Assinatura externa permanece pendente. Nenhum teste foi executado contra dados de produção. As notas datadas abaixo registram a evolução.

**Homologação de API em 02/11/2026:** `node scripts/test-integration.mjs --document-central` aprovado com Auth/Firestore/Storage locais, projeto `demo-coala-repository` e dados sintéticos. O ensaio importa handlers reais e cobre sessão/permissões, paginação, revogação, isolamento Financeiro/DP/workspace, classificação, movimentação concorrente, dedupe/versões, prévia e confirmação financeira, auditoria e bytes/nome do download. Encontrou e corrigiu a garantia customizada ausente que impedia inicializar as duas APIs centrais. Não cobre provedor externo de assinatura, todos os fluxos legados ou interface no navegador. Os emuladores foram encerrados pelo runner.

## Entradas e responsabilidade

Correção de interface em 02/11/2026: `ArchiveExplorer` fornece o mesmo ambiente em Empresa, Colaboradores, Financeiro e Modelos. A raiz mostra pastas reais de navegação; duplo clique, Enter ou toque abre o conteúdo sem trocar para a listagem administrativa antiga. Barra de busca, caminho clicável com voltar/subir, grade/lista, seleção, menu contextual e prévia compartilham comportamento. `sortByTitle` aplica A–Z como padrão, com Z–A pelo cabeçalho/seletor. O padrão também está no guia de listas e no guia vivo de design.

Empresa conserva upload, classificação, mover com motivo/auditoria e exclusão com InlineConfirm nas mesmas APIs. Pastas e seções REP-P permanecem virtuais. Colaboradores filtra as pessoas pelo acesso atual de unidade e consulta documentos somente ao abrir o titular; pastas usam a função canônica e a API original continua autorizando cada arquivo/tipo. Financeiro mantém paginação da inbox: pastas, busca e ordenação abrangem o conteúdo carregado, com continuação explícita. `/dashboard/documents/models` consulta `/api/documents/templates` sob templates.view e reutiliza o catálogo oficial/personalizado; gestão e geração encaminham às ações existentes. Nenhuma coleção ou backend novo.

`ArchivePreview` renderiza PDF com o PDF.js já usado no projeto, somente após a origem entregar um blob autorizado; não faz OCR/IA nem grava os arquivos. A prévia anterior é descartada ao mudar de item e object URLs são revogados no fechamento/troca. Downloads mantêm o nome canônico da origem. O E2E `tests/e2e/documents/archive.spec.ts` usa emuladores e respostas sintéticas para verificar navegação, busca, ordenação, caminho, contexto, prévia e modelos; não certifica dados/provedor reais.

O menu **Documentos** possui três entradas:

- [`/dashboard/documents`](../../../src/app/dashboard/documents/page.tsx): raiz do Acervo, com pastas Empresa, Colaboradores, Financeiro e Modelos conforme as permissões de cada origem.
- [`/dashboard/documents/generated`](../../../src/app/dashboard/documents/generated/page.tsx): Fluxos e pendências, com abas A classificar, Em preparação, Fluxos e Assinaturas.
- [`/dashboard/documents/history`](../../../src/app/dashboard/documents/history/page.tsx): histórico agregado de eventos disponíveis e estados atuais legados.

A central é uma projeção de leitura. Admissão, geração, assinatura, férias, desligamento, Financeiro, ausências e dossiê continuam autoritativos. As ações abrem a tela da origem; a central não cria uma segunda máquina de estados. A gestão detalhada de documentos gerados permanece em [`/dashboard/documents/generated/manage`](../../../src/app/dashboard/documents/generated/manage/page.tsx). As pastas do Acervo compartilham navegação; [`/dashboard/documents/financial`](../../../src/app/dashboard/documents/financial/page.tsx) mostra arquivos identificados/arquivados por contraparte, detalhes, visualização/download e links para revisão/histórico. Agrupamento abrange apenas páginas carregadas.

## Contratos e fontes

Assinaturas admissionais (02/11/2026): `tab=signatures&source=onboarding` lê `hrSignatureRequests` já gravados pela integração Autentique, incluindo pacotes CLT e contratos PJ. Exige `signatures.view`, exclui perfil próprio, revalida processo/workspace e unidade atual (ou pessoa vinculada). Páginas por ID de até `limit + 1` pedidos, com até uma consulta por processo distinto da página; nenhuma chamada ao provedor ou escrita em GET. Concluídos/assinados saem da fila; falhas, recusas e posicionamento pendente ficam consultáveis. Resumo expõe somente quantidades de entregas/visualizações/assinaturas com datas persistidas em participantes. Sem evidência, informa não registrado. Não retorna e-mails, IPs, links de assinatura, IDs do provedor ou conteúdo do pacote. Ação abre a trilha existente na admissão. Documentos avulsos continuam na origem `generated`, sem inferir Autentique para registros sem provedor.

Em 02/11/2026, a fila A classificar passou a incluir documentos da empresa com estado `pending_classification` ou categoria A classificar, sob `companyDocuments.view`, com paginação independente. Novos uploads sem tipo confirmado permanecem nessa fila e preservam o original. O editor Classificar documento no Acervo confirma posteriormente os metadados, com controle concorrente e evento de nome aplicado.

[`GET /api/documents/work-items`](../../../src/app/api/documents/work-items/route.ts) usa `secureRoute`, schema estrito, sessão ativa e interseção das permissões de origem. A rota consulta somente fontes autorizadas:

| Fonte | Visão | Controle de acesso e limite |
| --- | --- | --- |
| `generatedDocuments` | Preparação e assinaturas | `documents.view` ou `signatures.view`; até o limite solicitado, máximo 50 |
| `onboardingProcesses` | A classificar e fluxos | formalização `view`; processos ativos limitados |
| `documentUploadBatches`/`documentUploadItems` | A classificar | `documents.view`; equipe para admin, editor DP ou formalização view, sem ownProfileOnly; demais perfis veem seus lotes. Revalida pessoa/unidade/tipo; uma página de itens de um lote por chamada |
| Inbox financeira | A classificar e preparação | `financial.view + financial.inbox.view`; reusa o repositório paginado por workspace e consulta separadamente as etapas necessárias |
| Ausências | Fluxos | `dp.requests.view/review`; reusa o serviço que aplica workspace, unidade, atribuição e paginação |
| Empresa | A classificar | `companyDocuments.view`; página limitada, com continuação mesmo quando o filtro não encontra pendências na página corrente |
| `dp_vacations` | Fluxos e histórico terminal | `dp.vacation.viewAll`, pessoa/unidade atual; consulta por ID limitada, sem reconciliação em GET |
| `terminationProcesses` | Fluxos e histórico terminal | Mesmas permissões de visão geral do fluxo de desligamento, pessoa/unidade atual; sem motivo privado ou valores |

Cada origem pode falhar isoladamente. A resposta marca resultado parcial e a interface não transforma falha em “sem pendências”. Não há polling; a tela carrega ao abrir, ao trocar de aba e por ação explícita de atualizar.

Revisão de 01/11/2026: uploads próprios também revalidam o acesso atual à pessoa/unidade e a política documental antes de expor metadados. A criação do lote não concede acesso permanente. A verificação reutiliza os helpers do dossiê e pode consultar o cadastro dos titulares presentes na página. Gerados oferecem `cursor` e `pageInfo.nextCursor` para percorrer páginas antigas com ação explícita na interface. A gestão detalhada inclui documentos concluídos/cancelados para preservar a seleção recebida do histórico ou das assinaturas. O histórico de uploads é snapshot: nome/destino só aparecem como aplicados quando há estado `filed` e `filedDocumentId`; os demais permanecem propostas. O recorte admissional usa `status + createdAt`, compatível com o índice RH já declarado.

[`GET /api/documents/history`](../../../src/app/api/documents/history/route.ts) aplica a mesma interseção de permissões. Eventos comprováveis são `event`; estados legados são `current_snapshot`. Uploads seguem a autorização própria/equipe descrita acima. `source=employee_upload|financial&documentId=<id>` consulta eventos reais do item/mensagem; para upload arquivado, inclui também auditoria do documento final se ainda autorizado. Cada ramo tem cursor independente, custo limitado e allowlist de campos. Histórico não cria eventos retroativos nem expõe conteúdo bruto de análise.

## Identidade, estados e privacidade

Revisão pré-publicação: a lista da empresa identifica registros como `current_snapshot`; eventos de movimento/classificação aparecem somente na trilha auditada. Histórico, fila e movimentação recusam workspace explícito divergente. Registros legados sem workspace continuam sob a política global de documentos da empresa, sem migração ou afirmação de isolamento retroativo.

Em 02/11/2026, a trilha individual da empresa também passou a listar `DOCUMENT_CLASSIFIED`, com original/nome aplicado e ator. Classificação confirmada retira o documento da fila A classificar. O snapshot financeiro agora mostra nome/destino de `attachments[].documentNaming` quando confirmado pelo fluxo de nomenclatura da origem; não converte a prévia em evento aplicado.

Em 02/11/2026, o Histórico ganhou trilha individual de movimentações da empresa: `source=company&documentId=<id>`, com paginação sobre a subcoleção `audit` e exposição apenas dos eventos `DOCUMENT_FOLDER_CHANGED`. A entrada existe no Acervo da empresa e no detalhe histórico. Mostra origem, destino, ator e motivo registrados; nomes anteriores não persistidos permanecem não registrados. Documento excluído deixa de ter trilha acessível. Mover para exige `expected.folderCode/evidenceSection`; divergência produz 409, enquanto repetir o mesmo destino é idempotente. Evento e pasta são gravados na mesma transação.

Os contratos em [`features/documents/central`](../../../src/features/documents/central) usam `{source, sourceId}`; IDs iguais em bancos distintos não colidem. Classificação, preparação, assinatura, arquivamento e publicação são dimensões independentes. Um documento assinado pode permanecer ligado a um fluxo com outros requisitos abertos.

Os adaptadores retornam allowlists de metadados. Não propagam caminhos de Storage, CPF completo, diagnóstico, texto integral de OCR, prompt ou resposta bruta de IA. Ausências mostram tipo, titular autorizado, quantidade de anexos e situação; o arquivo continua na rota restrita. Financeiro entrega somente o resumo necessário para abrir a caixa autorizada. Contagens e listas são formadas apenas depois da autorização da própria origem.

Mover, publicar e mudar visibilidade continuam ações distintas. A pasta REP-P e sua auditoria estão no [fluxo de documentos da empresa](company-documents.md). O nome canônico do dossiê passa a ser usado no download publicado, com extensão derivada do arquivo original; `originalName`, bytes e caminho técnico permanecem preservados.

## Custo e limites

Uma abertura consulta apenas a aba atual. A preparação financeira faz três consultas limitadas (vínculo, preparo e banco), com continuação independente para cada etapa. O histórico oferece recortes por origem.

As consultas são paginadas por origem. Lotes consultam até dois metadados de lote e `limit + 1` itens de um único lote; a posição é lote+item por ID. Cada pessoa distinta tem autorização atual consultada uma vez por requisição, além das configurações documentais. Financeiro mantém cursores por etapa; ausências reutilizam seu serviço. Férias/desligamento consultam `limit + 1` processos e autorizam titulares da página com cache por requisição. Admitem-se páginas vazias após filtragem com continuação explícita. Não há corte global que omita páginas de outras origens. Histórico global cobre até sete origens de 50 registros; trilha individual usa até dois ramos limitados. Carregar mais consulta somente a origem/etapa escolhida. Sem polling, listener, escrita em GET ou varredura de diretório/backfill.

## Verificação e lacunas

Ampliação de 02/11/2026: o ensaio também cobre requisito admissional antes do arquivo, permissão separada para documentos da empresa, Financeiro com paginação e exclusão de outro workspace, ausência filtrada por unidade sem razão clínica/caminho privado na resposta, e consulta direta de gerado antigo/descartado com sanitização de contato e valores sensíveis. A gestão detalhada busca o ID solicitado quando ele não está entre os 300 registros iniciais; indisponibilidade explícita não troca silenciosamente o documento pelo primeiro registro. `GET /api/documents/generated` foi migrado para `secureRoute`, com `documentId` validado e autorização existente de documentos. O ensaio não equivale a homologação de cliques/teclado no navegador.

Os testes em `tests/unit/document-central-adapters.test.ts` cobrem identidade por origem, requisito sem arquivo, revisão, assinatura concluída com outro requisito aberto, distinção financeira e privacidade de ausência. Os testes do catálogo do dossiê cobrem nome canônico e extensão. Contratos de segurança passam sem violação.

Limites: páginas por origem não garantem cronologia global entre bancos; eventos ausentes no legado permanecem não registrados. Nomenclatura do catálogo suportado da empresa/Financeiro foi integrada conforme o [plano de nomenclatura](../../planos/plano-nomenclatura-arquivo-documental.md); outros formatos preservam original e revisão. Nenhuma migração ou backfill real. Integração com emuladores cobre também lotes da equipe, processos sem arquivo, contraparte legada e trilha individual. Cliente Autentique real foi exercitado com transporte simulado e webhook HMAC válido/inválido/repetido; homologação no provedor real requer ambiente e destinatários de teste, ausentes nesta sessão. Validação visual dispensada pelo programador.
