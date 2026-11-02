# Plano — Pastas e nomenclatura do arquivo documental

## Avanço e decisão — 02/11/2026

Decisão posterior: títulos de novos envios ao Autentique seguem `Coala Shakes - Setor | Tipo - Nome`, com RH, FN (Financeiro) e OP (Operações). Função comum aplicada ao kit, individuais admissionais, avulsos, PJ, férias e desligamentos. Recibo padrão: `Coala Shakes - FN | Recibo - João Meloriano`. Patrimônio/uniformes OP; aviso de férias RH e recibo FN. Filename troca `|` por hífen e conserva extensão compatível com o conteúdo. Pedidos já enviados/assinados mantêm o nome; protocolo continua nos metadados/PDF. Esse título de apresentação é separado da chave canônica de arquivamento/versionamento descrita abaixo.

Estado atual (substitui pendências das entradas históricas abaixo): classificação posterior da empresa e nomenclatura financeira implementadas. Financeiro aceita contraparte ativa por ID quando falta supplierId legado, mediante registration.view e confirmação explícita; essa decisão fica no documento e não altera a despesa. Catálogos suportados têm prévia, confirmação, versão, dedupe e nome canônico no download. Tipos/formatos fora do catálogo preservam original e revisão, sem inferência de identidade por nome. Nenhum lote real foi renomeado retroativamente.

- Classificação posterior da empresa implementada sem reupload, com versão esperada e evento de nome aplicado. No Financeiro, anexo vinculado a despesa com fornecedor cadastrado por `supplierId` recebe editor com tipo/referência, prévia e confirmação; servidor usa ID existente, aloca versão e protege a prévia contra mudança de vínculo/conteúdo. Download usa o nome confirmado. Fornecedores sem ID, formatos não suportados e contraparte empresarial livre continuam exigindo resolução na origem; nenhum dado foi inferido de texto livre.

- Entrada da empresa integrada com seleção por ID de unidade, catálogo de tipos, referência, prévia estrutural de nome e versão alocada no servidor. Duplicatas e versões conhecidas controladas transacionalmente; sem tipo, original preservado e fila de classificação. Ensaio completo em emuladores aprovado. Ainda pendem contraparte empresarial, resolução de uploads já pendentes e integração de nomenclatura ao Financeiro; nomes antigos não foram alterados.

- Aprovado pelo programador: usar os IDs imutáveis existentes das unidades e fornecedores/contrapartes como códigos de escopo nos nomes; nomes legíveis permanecem na interface. Não criar códigos curtos paralelos nem derivar identidade de texto livre. Os uploads Empresa/Financeiro ainda precisam resolver a entidade confirmada pelo ID antes de aplicar o padrão transversal.
- Download administrativo do dossiê passou a usar o mesmo helper canônico do download publicado, com extensão e filename UTF-8; original e bytes preservados. Acesso migrado a secureRoute, schema estrito e política/unidade revalidadas. Ensaio com Auth/Firestore/Storage emulados aprovado para nome, bytes, auditoria e acesso revogado.
- Upload da empresa deixou de disparar IA ao adicionar arquivo. Categoria inicial é A classificar fora da pasta REP-P; o usuário pode preencher os dados ou acionar Sugerir com IA. Sem mudança no classificador financeiro/DP nesta etapa.

## Situação verificada em 01/11/2026

- **Documentos da empresa:** `companyDocuments` usa `CATEGORIA_TITULO_DATA-DO-UPLOAD.ext`. O nome pode colidir entre unidades. A pasta de evidências do REP-P foi implementada localmente com cinco seções, mas não publicada.
- **Dossiê do colaborador:** `employeeDocuments` já calcula `displayName`, `storedName`, pasta, processo e versão pelo catálogo de tipos. O download do DP ainda usa `originalName`; a pasta própria também prioriza o nome original. Não tratar o cálculo como aplicação uniforme do nome.
- **Financeiro:** a caixa de entrada preserva o nome seguro do anexo recebido por e-mail; o upload móvel usa prefixo da função do arquivo (`receipt`/`paymentProof`) e o nome original. A classificação financeira é metadado posterior, com parser determinístico antes de OCR/IA.
- **Ausências:** anexos usam caminho técnico por solicitação e classificação sensível; não há título documental universal para o binário. O contexto da solicitação identifica o documento.
- **Arquivos fiscais AFD/AEJ e `.p7s`:** preservar os bytes e nomes técnicos originais e o vínculo da assinatura destacada. Nome de apresentação no índice pode ser padronizado, sem renomear o par fiscal. A orientação oficial do MTE exige que o `.p7s` leve o nome do arquivo AFD/AEJ acrescido de `.p7s` ([P&R da Portaria 671](https://www.gov.br/trabalho-e-emprego/pt-br/assuntos/inspecao-do-trabalho/fiscalizacao-do-trabalho/Perguntas%20e%20Respostas%20REP), perguntas 29 e 30).

## Decisões de desenho — 01/11/2026

1. **Uma ficha documental, três nomes:** `originalName` preserva a origem; `displayName` serve à navegação; `downloadName` é calculado para documentos comuns. `storagePath` continua técnico e imutável. Para arquivos fiscais assinados, `downloadName=originalName` quando o nome oficial integra o artefato.
2. **Pasta deriva do tipo e do contexto**, não do nome digitado nem de IA. Documento sem tipo, titular, fornecedor ou referência indispensável entra em revisão. O usuário autorizado pode registrar exceção de pasta com motivo e auditoria; a exceção não muda acesso ou publicação.
3. **Nome comum:** `TIPO__ESCOPO__REFERENCIA__vNN.ext`, omitindo somente a referência quando não se aplica. `ESCOPO` é código estável da unidade, matrícula/código do colaborador ou fornecedor cadastrado; `GERAL` identifica documento da empresa toda. A data do upload fica apenas nos metadados. A extensão segue o tipo real do arquivo. Nomes não incluem CPF completo, diagnóstico, valor pago ou credencial.
4. **Versão:** `vNN` representa revisão do mesmo documento lógico; arquivo idêntico por SHA-256 não cria nova versão. Mês, parcela, evento e contraparte distinguem documentos lógicos diferentes. Renomear visualmente não reescreve o binário nem altera assinatura.
5. **Entrada controlada:** o servidor valida campos, categoria, escopo, tipo, referência, extensão/MIME/assinatura do arquivo e duplicidade; gera nome e pasta. A interface mostra a prévia antes de confirmar. IA sugere metadados somente quando necessária e nunca autoriza o arquivo por conta própria.

## Pastas e nomes por família

| Origem / natureza | Pasta padrão | Exemplo de nome público |
| --- | --- | --- |
| Empresa, inscrição/certidão/alvará | `Documentos da empresa / Fiscal e contábil` ou `Licenças e autorizações / Unidade` | `INSCRICAO-ESTADUAL__Q-JOAO-PAULO__v01.pdf`; certidão com vencimento usa `VENC-AAAA-MM-DD` como referência. |
| REP-P, registro/atestados | `Sistemas e conformidade / Regularidade do sistema de registro de ponto / 01 Registro e atestados` | `ATESTADO-TECNICO-REP-P__GERAL__VERSAO-<versão>__v01.pdf`; somente após emissão definitiva. |
| REP-P, amostras e assinaturas | `... / 02 Amostras e assinaturas` | Rótulo `AFD de homologação — 25/10/2026`; download mantém o nome técnico do `.txt` e de seu `.txt.p7s`. |
| REP-P, validação externa | `... / 03 Relatórios de validação` | `RELATORIO-ITI-AFD-CADES__GERAL__2026-10-25__v01.pdf`. |
| REP-P, operação e segurança | `... / 04 Controles técnicos` | `ENSAIO-RESTAURACAO-ARP__GERAL__2026-10-24__v01.pdf`. |
| REP-P, pacotes e versões | `... / 05 Dossiês e versões` | `DOSSIE-REGULARIDADE-REP-P__GERAL__2026-10-25__v02.zip`. |
| Admissão, documentos pessoais e contratos | `Documentos da empresa / Colaboradores / <pessoa> / categoria e processo do catálogo` | Padrões existentes do catálogo, como `{matrícula}__PACOTE-ADMISSIONAL__{data}__vNN`; arquivo original preservado. |
| Renovação de contrato CLT/PJ | `Colaboradores / <pessoa> / Contratos / Contrato ou Aditivos` | `{matrícula}__{tipo-contrato}__{referência-do-vínculo}__vNN.pdf`; o tipo civil/CLT vem do catálogo. |
| Contracheque, espelho e férias | `Colaboradores / <pessoa> / Remuneração, Jornada ou Férias / competência ou processo` | `{matrícula}__CONTRACHEQUE__AAAA-MM__vNN.pdf`; pacote assinado conserva sua política de publicação. |
| Comprovante de ausência | `Solicitações / Ausências / <solicitação>` e dossiê restrito quando o fluxo autorizar | `COMPROVANTE-AUSENCIA__{matrícula}__{data-evento}__vNN.ext`; sem motivo clínico no nome. |
| Nota, boleto e recibo financeiro | `Financeiro / fornecedor ou favorecido / obrigação ou despesa / competência` | `RECIBO-PAGAMENTO__{código-fornecedor}__AAAA-MM__vNN.pdf`; original recebido continua acessível e vinculado ao lançamento. |

As pastas são vistas autorizadas sobre os registros de origem; a mesma referência pode aparecer em mais de uma navegação sem copiar o arquivo. Ausência, saúde e financeiro permanecem sob suas permissões próprias. **Não encaminhar automaticamente todos esses documentos à pasta de regularidade do REP-P.**

## Catálogo inicial para os uploads mais frequentes

O **tipo é escolhido ou confirmado no fluxo de origem**; o nome recebido do usuário não determina o tipo. As referências abaixo são dados estruturados. Se faltar um campo obrigatório, o arquivo fica pendente de classificação, com nome original preservado; o sistema não inventa competência, titular ou contraparte. `v01` é a primeira versão do mesmo documento lógico. Um novo mês, evento, contrato ou parcela constitui outro documento lógico.

| Tipo controlado | Contexto e referência obrigatórios | Pasta de navegação | Nome de download proposto |
| --- | --- | --- | --- |
| `DOCUMENTO-PESSOAL` | Colaborador identificado, subtipo do catálogo (RG, CNH, CPF etc.); validade quando aplicável | Dossiê do colaborador / Admissão / Documentos pessoais | `{matrícula}__{subtipo}__vNN.ext` |
| `CONTRATO-TRABALHO` | Colaborador, vínculo e data de início | Dossiê / Admissão / Contratos | `{matrícula}__CONTRATO-TRABALHO__{início}__vNN.pdf` |
| `ADITIVO-TRABALHO` | Colaborador, vínculo, data do aditivo | Dossiê / Contratos / Aditivos | `{matrícula}__ADITIVO-TRABALHO__{data}__vNN.pdf` |
| `CONTRATO-PJ` ou `ADITIVO-PJ` | Contraparte PJ cadastrada, contrato e data do instrumento | Contratos empresariais / Prestadores PJ / {contraparte} | `{código-PJ}__CONTRATO-PJ__{código-contrato}__{data}__vNN.pdf` (ou `ADITIVO-PJ`) |
| `CONTRACHEQUE` | Colaborador e competência `AAAA-MM` | Dossiê / Remuneração / {ano} / {mês} | `{matrícula}__CONTRACHEQUE__AAAA-MM__vNN.pdf` |
| `ESPELHO-PONTO` | Colaborador e competência `AAAA-MM` | Dossiê / Jornada / {ano} / {mês} | `{matrícula}__ESPELHO-PONTO__AAAA-MM__vNN.pdf` |
| `RECIBO-FERIAS` | Colaborador, período aquisitivo e parcela | Dossiê / Férias / {período} / {parcela} | `{matrícula}__RECIBO-FERIAS__PA-{anos}__P{parcela}__vNN.pdf` |
| `COMPROVANTE-AUSENCIA` | Colaborador, solicitação e data do evento | Solicitações / Ausências / {solicitação}; dossiê restrito se permitido | `{matrícula}__COMPROVANTE-AUSENCIA__{data}__vNN.ext` |
| `NOTA-FISCAL`, `BOLETO`, `RECIBO-QUITACAO`, `COMPROVANTE-PAGAMENTO` | Fornecedor/favorecido confirmado, obrigação ou despesa vinculada e referência (competência ou data de emissão) | Financeiro / {contraparte} / {obrigação ou despesa} | `{tipo}__{código-contraparte}__{referência}__vNN.ext` |
| `ATESTADO-TECNICO-REP-P`, `REGISTRO-INPI-REP-P`, `RELATORIO-VALIDACAO-REP-P` | Versão do sistema ou data do relatório e seção de evidência | Sistemas e conformidade / Regularidade do sistema de registro de ponto / {seção} | `{tipo}__GERAL__{referência}__vNN.ext` |

**Limites do catálogo:** `ESPELHO-PONTO` não é evidência de regularidade técnica do REP-P; `COMPROVANTE-AUSENCIA` não expõe diagnóstico no nome. Comprovante de pagamento bancário, recibo de quitação e nota fiscal são tipos diferentes, mesmo quando relacionados à mesma despesa. Um contrato com PJ segue o cadastro da contraparte; somente documentos pessoais de uma pessoa vinculada entram no dossiê individual. Arquivos AFD/AEJ e assinaturas `.p7s` mantêm os nomes fiscais originais no download. O catálogo atual do DP já cobre vários desses tipos, mas usa alguns rótulos/templates distintos; esta tabela é a regra alvo e **ainda não altera os uploads**.

## Ordem de execução

1. Fechar catálogo de tipos, campos obrigatórios, referência e códigos de escopo por família. Definir regras de privacidade para nome visível e nome de download.
2. Integrar a validação ao upload de `companyDocuments` e mostrar prévia; eliminar colisão entre unidades sem reescrever arquivos legados. Tratar ZIP/TXT/P7S fiscais em fluxo próprio que preserve nomes e pares assinados.
3. Corrigir downloads do dossiê do colaborador para usar o nome calculado quando seguro, mantendo original e histórico; conferir versão, assinatura e publicação por tipo.
4. Acrescentar nome público e pasta de navegação ao Financeiro e às ausências **após** vínculo confirmado; preservar anexos externos e os caminhos técnicos. Validar permissões e retenção em cada consumidor.
5. Gerar inventário de nomes existentes, prévia de correção e exceções. Aplicar eventual backfill real somente após revisão do lote e autorização de migração; não inferir titular ou fornecedor de texto livre.

## Pendências a confirmar

- Resolvido em 02/11/2026: códigos de escopo são os IDs imutáveis existentes. Falta integrar a seleção/resolução dessas entidades aos uploads Empresa/Financeiro, que ainda admitem descrição textual em partes do legado.
- Tipos e referências obrigatórios dos recibos financeiros; separar comprovante bancário, recibo de quitação e nota fiscal.
- Quando contratos PJ pertencem ao dossiê de uma pessoa e quando pertencem ao acervo empresarial de contratos.
- Política de exibição de nomes sensíveis e retenção de anexos de ausências nos vários perfis.
- Nomenclatura final do atestado REP-P/PTRP após INPI e versão; pendências do INPI ficam fora desta entrega.
- Formatos adicionais aceitos no upload de evidências REP-P e tamanho máximo apropriado. O formulário comum atual aceita somente PDF/JPG/PNG.

## Verificações necessárias

Testar entradas válidas e incompletas, extensão/MIME incompatíveis, nomes colidentes por unidade, duplicata exata, versão concorrente, arquivo fiscal e `.p7s` pareado, falta de permissão, titular/unidade incorreta, exposição por nome, download, auditoria e falha entre Storage e banco. Revisar Doc Brown antes de qualquer commit que altere documento de ponto.
