# Registro de documentos gerados pelo sistema

## Fonte única

Todo modelo capaz de gerar um documento no Coala One deve existir em `SYSTEM_DOCUMENT_TEMPLATES`, em `src/features/hr/documents/system-template-catalog.ts`. **Configurações → Pessoal → Documentos → Geração e publicação** deriva sua lista diretamente desse catálogo e não mantém uma cópia manual. A aba irmã **Modelos** reutiliza a mesma biblioteca de **Documentos → Modelos**, inclusive criação, upload, preparação, versionamento e publicação do modelo; não existe uma segunda implementação.

Modelos com `generationMode: reference` são referências e não aparecem na lista governada. Modelos `direct` e `contextual` aparecem agrupados pelo local de geração, com versão, formato, assinatura e retenção. Os componentes admissionais com `signatureScope: bundle` aparecem como um único **Pacote admissional**, preservando os componentes no detalhe e representando o PDF final único.

## Publicação para o colaborador

A política é `deny by default`: enquanto não existir configuração explícita, o documento permanece somente no arquivo restrito. A superfície de Pessoal deve concentrar, por modelo ou pacote, vínculo do titular, elegibilidade de publicação, momento, pasta de destino e comportamento de novas versões. Essa configuração não duplica nem edita o modelo de origem.

Desde 20/10/2026 a publicação existe como marca no documento do colaborador, com política padrão por tipo de documento em código e publicação automática ao assinar ou validar; ver [documentos por colaborador](flows/employee-documents.md#duas-macros-e-publicação-20102026). Ela mantém a autorização no servidor, registra histórico, não publica sem o identificador do colaborador e só admite a versão final assinada. A tela atual ainda apresenta o catálogo e o estado **Não configurada — permanece restrito**; a edição da política pela tela é a próxima etapa.

## Regra para novas implementações

Ao criar um fluxo que gere PDF, DOCX, termo, recibo, declaração, relatório arquivado ou outro documento persistente:

1. registrar o modelo em `SYSTEM_DOCUMENT_TEMPLATES` na mesma alteração;
2. declarar identificador estável, nome público, categoria, descrição, versão, origem, modo de geração, formato, assinatura e política de retenção;
3. versionar e catalogar a fonte oficial e seu hash quando houver DOCX;
4. garantir que a tela **Geração e publicação** passe a listar o item sem cadastro duplicado e no local de geração correto;
5. atualizar os testes do catálogo e o guia do fluxo gerador;
6. não concluir a implementação enquanto o modelo não estiver visível no catálogo ou enquanto a exclusão tiver sido explicitamente justificada como `reference`.

Essa regra abrange todos os módulos e todos os nomes usados pela interface: documento, termo, recibo, declaração, aviso, ordem, relatório, espelho, comprovante, pacote e equivalentes. O fato de o arquivo nascer dentro de Patrimônio, Financeiro, DP, Estoque, Tarefas ou de um job não altera a obrigação. O critério é o resultado persistido e oficial, não o nome da função que o produziu.

Use o [harness de documentos gerados](generated-documents-harness.md) para classificar a saída, conferir o catálogo, assinatura, publicação, retenção e evidências antes do commit. A ausência de um gerador em uma busca textual não comprova cobertura; o responsável pelo fluxo deve declarar cada saída persistida no registro do chamado.

Arquivos enviados apenas como instâncias não entram nesse catálogo: pertencem ao fluxo de documentos do colaborador ou da empresa. Um arquivo enviado como **modelo reutilizável** continua sendo cadastrado no módulo Documentos e precisa entrar na fonte oficial efetiva antes de receber automação ou política de publicação. Exportações transitórias que não são preservadas também precisam de decisão explícita no guia do fluxo antes de serem tratadas como modelo catalogado.

AFD e AEJ são exceções `reference` deliberadas: não são modelos editáveis nem documentos gerais da pasta do colaborador, mas exportações fiscais de leiautes oficiais, geradas por estabelecimento/período e preservadas junto da assinatura e da auditoria. Permanecem fora da lista **Geração e publicação**; o fluxo e a retenção estão documentados em [Registro de ponto REP-P](flows/dp-time-recording.md). O comprovante individual e o espelho, por serem documentos pessoais apresentados ao colaborador, continuam registrados no catálogo.

## Patrimônio

`system-asset-custody-term` é o termo contextual de entrega e responsabilidade criado ao transferir a posse de um patrimônio para colaborador. Usa `coala-letterhead-v2`, protocolo patrimonial `PAT`, assinatura independente do colaborador e do signatário institucional, retenção `employment_plus_5y` e publicação automática somente depois da assinatura. A origem preserva `sourceAssetId` e `sourceCustodyTransferId`; o arquivo assinado segue para **Documentos do colaborador → Uniformes e EPIs → Entregas**. Veja o [fluxo patrimonial](flows/assets.md).

`system-asset-maintenance-order` é a ordem contextual das manutenções preventivas, corretivas e manuais. Usa o timbre `coala-letterhead-v2`, protocolo `MNT`, retenção `asset_lifecycle_plus_5y` e não passa pelo Autentique (`signatureScope: none`). O registro preserva `sourceAssetId` e `sourceMaintenanceOccurrenceId`; o PDF contém componentes enviados e linhas para complemento manual, sem IMEI, telefone ou segredo.
