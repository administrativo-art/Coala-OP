# Registro de documentos gerados pelo sistema

## Fonte única

Todo modelo capaz de gerar um documento no Coala One deve existir em `SYSTEM_DOCUMENT_TEMPLATES`, em `src/features/hr/documents/system-template-catalog.ts`. **Configurações → Pessoal → Documentos → Geração e publicação** deriva sua lista diretamente desse catálogo e não mantém uma cópia manual. A aba irmã **Modelos** reutiliza a mesma biblioteca de **Documentos → Modelos**, inclusive criação, upload, preparação, versionamento e publicação do modelo; não existe uma segunda implementação.

Modelos com `generationMode: reference` são referências e não aparecem na lista governada. Modelos `direct` e `contextual` aparecem agrupados pelo local de geração, com versão, formato, assinatura e retenção. Os componentes admissionais com `signatureScope: bundle` aparecem como um único **Pacote admissional**, preservando os componentes no detalhe e representando o PDF final único.

## Publicação para o colaborador

A política é `deny by default`: enquanto não existir configuração explícita, o documento permanece somente no arquivo restrito. A superfície de Pessoal deve concentrar, por modelo ou pacote, vínculo do titular, elegibilidade de publicação, momento, pasta de destino e comportamento de novas versões. Essa configuração não duplica nem edita o modelo de origem.

Uma implementação futura da escrita dessas políticas deve manter a autorização no servidor, registrar histórico e impedir que um documento seja publicado sem o identificador interno do colaborador. Documentos com assinatura só podem admitir a versão final assinada; a tela atual apresenta o catálogo e o estado seguro **Não configurada — permanece restrito**, sem afirmar que o motor de publicação já consome uma regra editável.

## Regra para novas implementações

Ao criar um fluxo que gere PDF, DOCX, termo, recibo, declaração, relatório arquivado ou outro documento persistente:

1. registrar o modelo em `SYSTEM_DOCUMENT_TEMPLATES` na mesma alteração;
2. declarar identificador estável, nome público, categoria, descrição, versão, origem, modo de geração, formato, assinatura e política de retenção;
3. versionar e catalogar a fonte oficial e seu hash quando houver DOCX;
4. garantir que a tela **Geração e publicação** passe a listar o item sem cadastro duplicado e no local de geração correto;
5. atualizar os testes do catálogo e o guia do fluxo gerador;
6. não concluir a implementação enquanto o modelo não estiver visível no catálogo ou enquanto a exclusão tiver sido explicitamente justificada como `reference`.

Arquivos enviados apenas como instâncias não entram nesse catálogo: pertencem ao fluxo de documentos do colaborador ou da empresa. Um arquivo enviado como **modelo reutilizável** continua sendo cadastrado no módulo Documentos e precisa entrar na fonte oficial efetiva antes de receber automação ou política de publicação. Exportações transitórias que não são preservadas também precisam de decisão explícita no guia do fluxo antes de serem tratadas como modelo catalogado.
