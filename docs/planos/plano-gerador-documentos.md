# Gerador de documentos

## Situação verificada e escopo — 02/11/2026

O gerador atual preenche modelos publicados, vincula pessoas/partes, produz prévia, permite aprovação e envia por ação explícita à assinatura. A biblioteca existente aceita DOCX, prepara timbre, mapeia variáveis manualmente ou com IA e controla versões/publicação. Essa IA prepara campos; não é um redator de documentos livres.

Pedido: criar submódulo Gerador de documentos; reaproveitar/melhorar a manutenção de modelos; oferecer criação do zero no timbre, manual ou com auxílio opcional de IA, ou a partir de modelo; permitir vínculo com colaborador/PJ/empresa. Acervo guarda/consulta, Gerador cria, Fluxos acompanha o trabalho. Numeração somente nas pastas principais da empresa; categorias de modelos e dossiês continuam normais.

## Referências e proposta de interação

- [PandaDoc — criação guiada](https://support.pandadoc.com/en/articles/12108203-template-workflow-builder-and-guided-document-creation-full-guide): referência para origem, destinatários, dados faltantes, revisão e envio; editor de uma instância não altera automaticamente o modelo.
- [Clicksign — modelos e variáveis](https://ajuda.clicksign.com/article/121-como-criar-um-modelo-de-documento): referência para reaproveitar o texto e preencher dados por formulário/integração.
- [Docusign — geração documental](https://developers.docusign.com/docs/esign-rest-api/esign101/concepts/documents/document-generation/): referência para estrutura formatada, dados personalizados e conteúdo condicional.

Proposta para criação: **origem (do zero/modelo) → contexto (empresa, setor e pessoas) → conteúdo → prévia → aprovação → assinatura ou arquivamento**. Timbrado é do sistema. Selecionar uma pessoa preenche apenas dados autorizados. IA é acionada explicitamente para rascunhar/revisar texto, com resultado conferido pelo usuário; campos oficiais conhecidos são preenchidos mecanicamente. Alteração de instância e publicação de modelo são ações separadas.

## Etapas e aceite

1. **Implementação local em validação:** entrada Gerador no menu, geração existente e manutenção da mesma biblioteca em `/dashboard/documents/generator/models`, com editor individual. Configurações e URLs antigas encaminham ao novo local. Categoria, versão, revisão, timbre e permissões existentes preservados. Sem catálogo duplicado.
2. **Proposta a detalhar:** editor de conteúdo livre com rascunho persistido, paginação/prévia timbrada e salvamento como documento ou como novo modelo por permissões distintas. Antes de desenvolver o gerador persistente, registrar o modelo genérico no catálogo oficial, identidade, versão, setor/nome, retenção, assinatura, arquivamento e publicação. Não derivar retenção/publicação de uma suposição sobre o texto.
3. **Proposta a detalhar:** assistência de redação por IA com prévia do contexto enviado, schema, limites de custo e política de dados; não chamar IA ao digitar, selecionar pessoa ou preencher variável conhecida. Diferenciar texto sugerido de fatos do cadastro; não inventar dados ou enviar para assinatura automaticamente.
4. Validar geração manual/modelo, dados ausentes, permissões, troca de pessoa, timbre multipágina, revisão e imutabilidade após assinatura. Testar com emuladores e transportes simulados antes de qualquer homologação externa autorizada.

A etapa 1 não implementa as etapas 2/3 e não deve apresentar botões que prometam redação livre ou IA ainda inexistentes. A pesquisa e a proposta não autorizam contratação de outros serviços; Autentique continua como integração de assinatura existente.

## Direção posterior — 03/11/2026

O DEV definiu uma futura entrada única **Criar documento**, com opções **Em branco**, **Usar modelo** e **Criar modelo**. As três devem levar a um editor visual com formatação e campos do sistema para preenchimento automático. A entrada separada **Gerador de documentos** desaparecerá após esse redesenho. O DEV pediu a proposta somente depois dos demais ajustes documentais; a implementação e a escolha técnica do editor ainda não começaram. Até lá, a navegação atual e suas permissões continuam em uso. A assistência opcional por IA permanece como requisito a detalhar.

## Editor visual — avaliação técnica de 05/11/2026

**Status:** avaliação em prova de conceito local e descartável; a decisão do DEV de 05/11/2026 está registrada na seção seguinte. No momento da avaliação nada havia sido implementado; a implementação está registrada na seção "Situação após a implementação — 05/11/2026". Os números abaixo vêm de execuções locais (Chromium headless; Gotenberg 8 em contêiner local temporário, já removido; LibreOffice 26.8.2 local; máquina de desenvolvimento Apple M1, sem rede de produção nem partida a frio de serviço gerenciado) e não substituem a homologação.

**Candidatos testados (licença e versão verificadas no npm):**

| Opção | Resultado resumido |
| --- | --- |
| Tiptap 3 (MIT) | Campo do sistema como nó inline, JSON/HTML versionáveis, texto no DOM, 3.000 parágrafos em ~0,16 s. Sem paginação nativa gratuita. |
| Tiptap + `tiptap-pagination-plus` (MIT, mantenedor único) | Paginação em tela com cabeçalho/rodapé; após calibrar (`box-sizing: border-box`, preset A4) 83% dos blocos caíram na mesma página da tela e do PDF. Não é idêntico. |
| `@hufe921/canvas-editor` 1.0.6 (MIT) | Campos por `conceptId`, paginação nativa; tela e PDF divergiram, sem texto no DOM, 3.000 parágrafos em ~2,2 s, formato próprio. Não recomendado. |
| `@eigenpal/docx-editor-react` 1.9.0 (Apache-2.0; pacote Pro de PDF é pago) | Abre/edita DOCX com layout paginado; salvar após editar manteve as chaves `{{campo}}` íntegras e o `docxtemplater` preencheu o arquivo salvo. Ciclo completo validado: editar → salvar → preencher → PDF pelo LibreOffice (3 páginas, texto editado e campos presentes). Paginação do editor × LibreOffice no mesmo DOCX: 39 de 45 blocos na mesma página (87%); o editor quebra cerca de 2 parágrafos antes por página. Projeto jovem. |

Descartados por licença ou custo (leitura de documentação; texto das licenças não revisado): SuperDoc (AGPL), CKEditor 5, TinyMCE, BlockNote XL e Tiptap Pro (recursos de paginação/PDF/DOCX pagos), ONLYOFFICE/Collabora (servidor próprio).

**Recomendação que embasou a decisão (inferência da avaliação):** Tiptap com o editor em rolagem contínua e a **prévia paginada e o PDF gerados no servidor pelo mesmo Chromium**, o que torna tela aprovada e arquivo final idênticos por construção (duas gerações do mesmo conteúdo, e a partir do JSON salvo, deram PDFs idênticos). Medição local de 40/130/500 blocos: 4/14/51 páginas em ~110–250 ms, com navegador já aberto. Plano B: eigenpal, caso o DOCX continue como formato oficial.

**Regras técnicas observadas na prova:** campo com `white-space: nowrap` (sem isso 20 de 49 nomes longos se partiram); conversor de listas do Word em `transformPastedHTML` (sem ele as listas viram parágrafos com "·"); extensões de texto para preservar cor, tamanho e família ao colar; web font embutida no PDF (mecanismo validado com fonte de teste, não com a fonte da marca); família colada de uma fonte ausente no servidor cai em fallback.

**Pendências nomeadas (nenhuma resolvida):**

1. ~~Decisão do formato oficial~~ — **resolvida em 05/11/2026** pela escolha do Tiptap: JSON/HTML é a fonte da verdade e o PDF é o artefato fiel. O que fazer com os modelos DOCX existentes (migrar, manter em paralelo ou converter) continua **pendente** e precisa de decisão própria.
2. Repetir a medição do Gotenberg no serviço real de produção (ainda não provisionado): latência, partida a frio, concorrência e custo. Em contêiner local (M1) o Gotenberg 8 deu, para HTML→PDF de 40/130/500 blocos, 4/14/51 páginas (as mesmas do Chromium local), 250–600 ms após a primeira chamada (~1,1 s na primeira), e ~150–750 ms para DOCX→PDF. A divergência eigenpal × LibreOffice já foi medida localmente (87% dos blocos na mesma página, com um documento sintético de 45 parágrafos); falta repetir com um modelo real e com a fonte de produção, pois o LibreOffice substituiu Arial por fonte equivalente.
3. Fonte da marca: obter o arquivo e licença de uso para embutir no PDF.
4. Leitor de tela real nos campos inline e no editor escolhido (só com autorização para controlar o aplicativo); a árvore ARIA foi lida, e um título partido apareceu uma vez e não reproduziu (causa não comprovada).
5. Teste com um modelo real do Coala (20+ páginas, tabelas, timbre e campos), não só com texto sintético.
6. Cadastro em `SYSTEM_DOCUMENT_TEMPLATES`, titular com identificador imutável, retenção, assinatura e publicação continuam exigidos antes de qualquer gerador persistente, qualquer que seja o editor.
7. Risco de manutenção: `tiptap-pagination-plus` tem mantenedor único e o eigenpal é jovem; fixar versão e avaliar fork antes de adotar.

**Conversão para DOCX a partir de HTML/JSON (medição local de 05/11/2026):** não fica idêntico ao PDF do Chromium. Mapeando o JSON do Tiptap para DOCX com a biblioteca `docx` (conversor de ~40 linhas, sem calibração fina) e convertendo pelo LibreOffice do Gotenberg, 93%, 74% e 26% dos blocos caíram na mesma página do PDF de referência (40, 130 e 500 blocos; 5, 14 e 53 páginas contra 4, 14 e 51), com desvio máximo de 2 páginas e acúmulo em documentos longos. Converter o HTML pelo LibreOffice foi pior (68%, 29% e 8%) e perdeu o timbre. O conteúdo e os campos preenchidos se mantêm; a paginação não. Consequência: PDF é o artefato fiel; DOCX derivado de HTML/JSON é exportação editável, não cópia idêntica. Calibrar espaçamentos pode reduzir a deriva, mas não há garantia de igualdade (pendência 8).

8. Se o DOCX derivado precisar ser idêntico ao PDF, calibrar o conversor com modelos reais ou usar o DOCX como formato oficial (eigenpal); decidir junto com a pendência 1.

## Decisão do DEV — 05/11/2026

O DEV decidiu seguir com o **editor interno, em Tiptap**: o documento é editado dentro do Coala One, em rolagem contínua, com campos do sistema como nós inline. A prévia paginada e o PDF oficial são gerados no servidor a partir do mesmo conteúdo (JSON/HTML versionado), e o DOCX, quando necessário, é uma exportação derivada, não uma cópia idêntica. A extensão `tiptap-pagination-plus` fica **fora** do escopo inicial; pode ser reavaliada se houver necessidade de ver as páginas durante a edição (83% de coincidência na medição).

**O que esta decisão não faz:** não autoriza implementação nem contratação por si só, não define a página nem o desenho da tela (consultar `docs/design/README.md` e `docs/design/decisoes/` antes de desenhar), não migra os modelos DOCX atuais e não dispensa o cadastro em `SYSTEM_DOCUMENT_TEMPLATES`, o titular com identificador imutável, a retenção, a assinatura e a publicação (pendência 6).

**Ordem sugerida de execução (a confirmar):** (1) registro do modelo genérico no catálogo oficial e política de retenção/publicação; (2) esquema versionado do conteúdo e do nó de campo do sistema, com testes; (3) editor em página própria, com campos e prévia timbrada pelo servidor; (4) serviço de PDF em produção (pendência 2) e testes com modelo real (pendência 5); (5) exportação DOCX opcional (pendência 8); (6) assistência de IA (etapa 3 deste plano).

## Situação após a implementação — 05/11/2026

Os itens (1) a (3) da ordem sugerida acima foram implementados e publicados em produção (PR #762 em `main`, PR de promoção #763; rollout do App Hosting `SUCCEEDED` no commit `13969b94`). Esta seção descreve o que foi verificado; o que não foi executado está listado abaixo e não deve ser lido como entregue.

**Entregue:**

- Editor interno em Tiptap, em páginas próprias de `/dashboard/documents/editor`: documento em branco, campos do sistema (113 variáveis), salvamento manual e automático com conflito de versão, prévia e PDF final gerados no servidor (HTML, Gotenberg Chromium, timbre `coala-letterhead-v2`) e download do PDF final.
- Coleção própria `editorDocuments`, com versões imutáveis, auditoria, concorrência otimista e idempotência; o editor não toca `generatedDocuments`. Autor, titular e signatário ficam separados; o titular só é escolhido na etapa "Preencher e finalizar".
- Modelos do editor (`editorTemplates`): valem para todas as unidades do workspace, não têm titular, têm versões imutáveis e os estados rascunho, publicado e arquivado; "Salvar como modelo" (com aviso sobre dados de pessoas) e "Usar modelo". Publicar e arquivar exigem `documents.review`; nenhuma permissão nova foi criada. Os modelos do editor ficam fora do catálogo: só a entrada genérica `system-editor-document` ("Documento livre (editor)") consta em `SYSTEM_DOCUMENT_TEMPLATES`.
- Listagem "Documentos do editor" (só os próprios com `documents.generate`; todos com `documents.review`).
- Busca por pessoa nas subcoleções do editor por collection group, com filtro do caminho do pai.

**Verificações executadas:** `npm run typecheck`, suíte unitária completa, `npm run check:security-contracts`, verificadores de fontes pessoais e de documentação, `quality` e CodeQL no PR. Os testes E2E do editor rodaram na observação do CI e não falharam; o job foi cancelado pelo limite de 1 hora e as falhas dele foram de specs de RH não relacionados.

**Não executado ou não provado:** busca por subcoleções e paginação contra emulador ou banco real (testadas só com fakes); verificação visual das telas e leitor de tela; Gotenberg de produção com o módulo Chromium; medição de latência e custo do PDF em produção (pendência 2).

**Pendências que continuam abertas:**

1. Verificar o Chromium do Gotenberg de produção e medir latência, partida a frio, concorrência e custo (pendência 2).
2. Validação jurídica da retenção: o documento final usa a política provisória `fiscal_generation_date_pending`.
3. Decidir o que fazer com os modelos DOCX atuais (pendência 1) e a exportação DOCX derivada (pendência 8).
4. Documentos do editor ainda não aparecem no Acervo; a lista não tem busca por texto nem indica se o documento tem campos do sistema.
5. Rate limit apenas por instância; margens e fonte do timbre provisórias (pendências 3 e 5).
6. Fechar a lacuna `legacy_gap` restante (`audit-targets` e `contentVersions.documentId`, esta só um vínculo de documento) e validar a consulta por collection group no emulador.
7. Assistência de IA (etapa 3 deste plano) continua não iniciada.

**Operação:** os índices de `editorDocuments` e `editorTemplates` e as exceções de campo `COLLECTION_GROUP` foram implantados no banco `coala` em 05/11/2026, logo após o rollout.

Registro do chamado: `.ai-work-archive/development-technology/editor-documentos-20261105/record.md` (arquivo local, fora do repositório).
