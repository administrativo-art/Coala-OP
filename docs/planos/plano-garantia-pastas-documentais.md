# Garantia de pastas documentais

26/11/2026 — implementação conjunta; publicação autorizada pelo usuário em 26/11/2026, pendente de integração, gates e rollout.

## Regra aprovada

Todo documento gerado ou enviado deve ser localizável por uma pasta do Acervo, inclusive antes de classificar ou assinar, exceto anexos admissionais sujeitos à conclusão com documento final. Histórico e estado `archived` não substituem uma pasta. A pasta preserva a identidade e autorização da origem; não cria cópias nem atribui titular por nome, CPF ou participação na assinatura.

## Situação verificada

O gerador central persiste `generatedDocuments`; um avulso pode receber `archiveStatus: archived` sem entrada em `employeeDocuments`. O editor persiste separadamente `editorDocuments`. Uploads da Empresa têm categoria (inclusive A classificar); uploads de colaboradores pendentes ficam somente na fila de Fluxos. Documentos de colaboradores já arquivados têm pastas próprias. O levantamento também identificou guias de ASO, formulários contábeis, comprovantes financeiros e de ponto, termos de uniforme, pacotes fiscais e anexos da admissão que precisavam de entrada no Acervo. As fontes continuam autoritativas.

## Execução

1. Projetar pastas de gerados, editor e recebidos pendentes no Acervo, reutilizando registros e permissões das respectivas origens. Incluir legados sem backfill.
2. Paginar a leitura do gerador e manter continuação mesmo em página filtrada vazia. Editor e uploads reutilizam os leitores paginados existentes.
3. Oferecer `signed-pdf` explícito com origem e integridade conferidas; preparado e original preservam seus formatos. Assinatura incompleta não entrega silenciosamente o preparado.
4. Projetar fontes contextuais por permissão, workspace, unidade, titular e tipo. Paginar versões dos guias/formulários, comprovantes, termos e ZIP fiscais sem emitir novamente. No espaço pessoal ficam comprovantes próprios de ponto e termos próprios.
5. Os anexos do formulário de admissão só entram no Acervo após `status=completed`, etapa `done`, data de conclusão e documento final assinado comprovado: pacote CLT vinculado à solicitação/dossiê ou contrato PJ vinculado à solicitação do processo. Anexos já promovidos e gerados vinculados permanecem fora das pastas até essa condição; a origem operacional continua consultável durante o trabalho. Não existe pasta de preparação pública no Acervo. Se a admissão for encerrada sem conclusão, a regra aprovada pelo usuário é **exclusão física definitiva**, sem lixeira: o encerramento transacional solicita o descarte, leitores recusam disponibilidade e o executor apaga gerações dos objetos cuja origem foi comprovada. Metadados de resultado e auditoria permanecem. Referências reutilizadas de outra origem não são apagadas. Falhas, referências compartilhadas ou escopo incerto ficam pendentes, com retomada explícita e reconciliação automática; não se declara exclusão concluída sem confirmação. Uploads novos registram escopo privado antes da gravação; submissão pública e retornos de assinatura respeitam o encerramento. Eventos Storage/Firestore reabrem a reconciliação de gravações tardias. Não se infere titular por nome/CPF nem unidade operacional por empregador.
6. Validar autorização, legado avulso, continuidade, acesso ao assinado, isolamento contextual e navegação; atualizar os guias e inventários.

## Limites e implantação

Publicação autorizada inclui integração da revisão documental 3c37b4f85a6dd09101bdc7dd5de159116ff5192d e correção dos contratos vencidos antes de main → production. Sem associação retroativa de titular ou pagamento real. A exclusão de bytes fica restrita ao encerramento admissional aprovado, com propriedade comprovada; documentos alheios e deduplicados são preservados. O gerador legado usa acesso global `documents.view` (política `documents-admin` do inventário); não inventar isolamento por workspace ausente nos registros. Editor mantém workspace/autor ou revisor; recebidos mantêm pessoa/unidade/tipo. A pasta resolve a localização dos documentos dessas origens, não certifica produtores externos não inventariados.


## Custos e pré-requisitos

Listagens sob demanda, sem polling/listeners e sem varredura de todos os arquivos ao abrir a raiz. Contextos usam até 26 registros por página e, para versões admissionais, até 25 pais distintos para conferir escopo; uniformes podem ler até 25 titulares distintos. O processo admissional só lista objetos Storage ao abrir sua pasta: no máximo 27 objetos/página, metadados de até 25 slots e uma consulta de unicidade do token de até 2 registros. Downloads revalidam escopo e origem. A projeção não copia arquivos. O descarte autorizado da admissão lê lotes de até 200 registros por fonte e 100 gerações Storage por prefixo, com cursor privado, lease, revisão de eventos tardios e checagem de referências externas. Cliente drena até 10 lotes sem espera periódica; pendências continuam no job a cada 5 minutos, até 5 processos por execução. O ciclo regular da raiz não enumera objetos Storage.

Índices adicionados localmente: uniformTransactions por workspace/titular/ID, repP_receipts e repP_pilotMarkings por workspace/titular/ID, e generatedDocuments de RH em collection group por kind/ID e generatedBy/ID. Implantação dos índices e código permanece pendente de autorização de publicação. O gate global de contratos de segurança está bloqueado por exceção preexistente expirada em employee-documents (16/11/2026); não foi estendida.


## Implantação da exclusão admissional

Publicar a API interna `/api/jobs/hr/onboarding-document-discard` e as quatro funções `onboardingDocumentDiscardRequested`, `discardLateOnboardingObject`, `discardLateOnboardingEmployeeDocument` e `retryOnboardingDocumentDiscard`. Exigem segredo próprio `ONBOARDING_DOCUMENT_DISCARD_SECRET` no runtime da aplicação e funções; não reutilizar segredo bancário. Gatilhos e job fazem parte da mesma entrega: sem eles, não se declara garantia de remoção de gerações tardias. Eventos são filtrados por namespace antes de consultar dados; cron vazio faz uma consulta limitada por execução. Escopos/manifestos de upload ficam em subcoleções privadas do processo, nunca em DTOs públicos.
