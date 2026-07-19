# Plano — Onboarding, integração, documentos e assinatura

Data do registro: 17/07/2026

Este documento consolida o que foi planejado, o que já foi implantado e o que ainda falta no fluxo de integração/onboarding do Departamento Pessoal, incluindo modelos por cargo/função, coleta/conferência, documentos, assinatura, período de experiência e gerador de documentos.

## 1. Objetivo do fluxo

O objetivo é transformar a integração de colaboradores em um fluxo configurável por cargo/função, capaz de:

- importar um modelo de integração por cargo/função;
- criar uma integração avulsa do zero sem sobrescrever modelos;
- coletar dados e documentos do candidato;
- permitir conferência documental pelo RH;
- gerar documentos admissionais a partir de modelos DOCX;
- solicitar assinatura dos documentos;
- configurar acessos, vale-transporte, turno, metas e regras operacionais;
- conduzir treinamento;
- controlar período de experiência quando aplicável;
- finalizar a integração com rastreabilidade.

## 2. Linha do tempo operacional desejada

Para o modelo de integração do Atendente de balcão, a linha do tempo consolidada deve seguir esta lógica:

1. Formalização - Coleta e conferência
2. Formalização - Assinatura dos documentos
3. Formalização - Acessos
4. Formalização - Finalização
5. Treinamento
6. Finalização

Observação: a fase de período de experiência continua sendo parte do plano de onboarding/integração, mas precisa ter sua posição final confirmada no desenho operacional: como etapa dentro da linha do tempo principal ou como módulo pós-admissão vinculado ao onboarding.

## 3. O que já foi implantado em produção

### 3.1 Modelo e fases do Atendente de balcão

Status: implantado.

Foi criado/ajustado o fluxo da integração do Atendente de balcão com a estrutura de formalização, treinamento e finalização.

Commit-base conhecido:

- `9be1522d` — `chore: rollout atendente balcao integration`

### 3.2 Correções da coleta/conferência documental

Status: implantado com rollout.

Commit:

- `0ff526c0` — `fix: guard onboarding document review`

Rollout:

- `build-2026-07-17-002`
- Status: `SUCCEEDED`

Itens implantados:

- bloqueio de “Aprovar” quando não há arquivo anexado;
- exibição de “Nenhum arquivo enviado” quando não existe arquivo;
- mensagem do copiloto só aparece quando existe extração real;
- primeiro envio público mantém o link aberto;
- primeiro envio público coloca o processo em conferência documental;
- remoção do botão “Definir como etapa atual”;
- etapas futuras ficam somente leitura;
- finalização deixou de parecer encerramento automático indevido;
- documentos fake da etapa de assinatura foram removidos.

### 3.3 Fusão de Coleta e Conferência

Status: implantado com rollout.

Commit:

- `74e45d79` — `fix: merge onboarding collection review stage`

Rollout:

- `build-2026-07-17-003`
- Status: `SUCCEEDED`

Itens implantados:

- `Formalização - Coleta` e `Formalização - Conferência` foram consolidadas em `Formalização - Coleta e conferência`;
- a conferência dos documentos passou a acontecer na mesma página da coleta;
- processos antigos em `document_review` continuam compatíveis, mas aparecem consolidados na interface;
- envio público não avança mais para uma fase separada;
- aprovação/reprovação documental é permitida na etapa única de coleta/conferência;
- continua bloqueado aprovar/reprovar documento sem arquivo.

## 4. O que existe localmente, mas ainda não está implantado

O workspace possui uma base técnica local ainda não commitada/implantada para o plano maior.

### 4.1 Gerador de documentos DOCX

Status: existe localmente, não implantado.

Arquivos principais:

- `src/features/hr/documents/docx-generator.ts`
- `src/features/hr/documents/generate-document.server.ts`
- `src/app/api/documents/generate/route.ts`
- `tests/unit/hr-integration/docx-generator.test.ts`

Capacidades já presentes localmente:

- geração de DOCX a partir de modelo `.docx`;
- uso de variáveis no formato `{{employee.name}}`;
- preservação básica de formatação do Word;
- suporte a condicionais `{{#if ...}} ... {{/if}}`;
- normalização de placeholders quebrados em múltiplos runs do Word;
- extração das variáveis usadas no DOCX;
- teste unitário cobrindo preenchimento e preservação de negrito.

Dependências adicionadas localmente:

- `docxtemplater`
- `pizzip`
- `angular-expressions`

### 4.2 Cadastro de modelos documentais

Status: existe localmente, não implantado.

Arquivos principais:

- `src/app/api/documents/templates/route.ts`
- `src/app/api/documents/templates/[id]/file/route.ts`
- `src/app/dashboard/documents/templates/page.tsx`

Capacidades já presentes localmente:

- criar modelo documental;
- subir arquivo `.docx`;
- validar variáveis desconhecidas;
- publicar versão do modelo;
- listar modelos;
- exibir quantidade de variáveis usadas.

### 4.3 Gestão documental

Status: existe localmente, não implantado.

Arquivos principais:

- `src/app/dashboard/documents/page.tsx`
- `src/app/dashboard/documents/company/page.tsx`
- `src/app/dashboard/documents/collaborators/page.tsx`
- `src/app/api/documents/company/route.ts`
- `src/app/api/documents/company/access/route.ts`

Capacidades já presentes localmente:

- hub de documentos;
- documentos da empresa;
- upload de PDF/JPG/PNG;
- visualização/download auditado;
- exclusão lógica;
- redirecionamento para documentos dos colaboradores.

### 4.4 Catálogo das 87 variáveis documentais

Status: existe localmente, não implantado.

Arquivos principais:

- `src/features/hr/integration/document-variables.ts`
- `docs/dicionario-variaveis-documentos-rh.md`
- `tests/unit/hr-integration/document-variables.test.ts`

Capacidades já presentes localmente:

- contrato com 87 variáveis;
- formatações de data, moeda, booleano, CPF, CNPJ, PIS, telefone, e-mail;
- variáveis sensíveis;
- condicionais;
- grupo repetível para filhos/dependentes;
- fontes de resolução por `field_value`, `employee_record`, `user_record`, `reference` e `computed`;
- teste unitário garantindo a contagem das 87 variáveis.

### 4.5 Integração V2 configurável

Status: base existe localmente, não implantada.

Arquivos principais:

- `src/features/hr/integration/schemas.ts`
- `src/features/hr/integration/engine.ts`
- `src/features/hr/integration/process.ts`
- `src/features/hr/integration/action-executor.ts`
- `src/features/hr/integration/runtime-actions.server.ts`
- `src/features/hr/integration/IntegrationTemplateManager.tsx`
- `src/app/api/hr/integration-templates/`
- `src/app/api/hr/onboarding/[id]/integration/route.ts`

Capacidades já presentes localmente:

- modelos por cargo/função;
- estágios configuráveis;
- blocos configuráveis;
- perguntas condicionais em cascata;
- uploads;
- subformulários;
- grupos repetíveis;
- tabelas repetíveis;
- regras condicionais;
- simulação de visibilidade, obrigatoriedade e bloqueios;
- execução parcial de ações configuráveis.

Ações já previstas/executáveis localmente:

- criar tarefa;
- notificação interna;
- gerar documento;
- solicitar assinatura interna;
- atualizar perfil;
- concluir integração por regra.

Observação: isso ainda precisa ser fechado, commitado, validado e implantado em produção.

### 4.6 Período de experiência

Status: base existe localmente, não implantada como fluxo completo.

Arquivos principais:

- `src/features/hr/integration/probation.ts`
- `src/features/hr/integration/probation-process.ts`
- `src/app/api/hr/onboarding/[id]/probation/route.ts`
- `src/app/api/hr/probation/`
- `tests/unit/hr-integration/probation.test.ts`
- `tests/unit/hr-integration/probation-process.test.ts`

Regras planejadas:

- usuário informa a quantidade de dias do primeiro período;
- usuário informa a quantidade de dias da prorrogação;
- a soma não pode ultrapassar 90 dias;
- com a data de admissão, o sistema calcula automaticamente:
  - início e fim do primeiro período;
  - início e fim da prorrogação;
  - data final do contrato de experiência;
  - janelas de avaliação;
  - alertas;
  - necessidade de termo de prorrogação.

Avaliação:

- deve ter uma janela configurável, por exemplo últimos 10 dias de cada período;
- formulário da avaliação será definido depois;
- regra de efetivação pode ser manual, por avaliações aprovadas ou automática ao final.

## 5. O que ainda falta implementar

### 5.1 Trilha interna da etapa “Assinatura”

Status: não implementado em produção.

Hoje a etapa de assinatura mostra estado vazio quando não há documento gerado. Isso está correto para evitar documento fake, mas ainda falta a trilha real.

Trilha desejada:

1. Listar documentos configurados para assinatura.
2. Gerar documento a partir de modelo DOCX publicado.
3. Salvar documento gerado.
4. Permitir baixar/revisar.
5. Criar solicitação interna de assinatura.
6. Exibir status por documento:
   - não gerado;
   - gerado;
   - em revisão;
   - pronto para assinatura;
   - enviado para assinatura;
   - aguardando candidato;
   - aguardando empresa/RH;
   - assinado;
   - recusado;
   - expirado;
   - cancelado.
7. Permitir marcar assinatura manualmente enquanto a API externa não estiver conectada.
8. Bloquear avanço quando houver assinatura obrigatória pendente.

### 5.2 API externa de assinatura digital

Status: não implementada.

Ainda precisa definir o provedor:

- Clicksign;
- Autentique;
- ZapSign;
- outro.

Depois da escolha, implementar:

- credenciais e configuração;
- criação de envelope;
- upload/envio do documento;
- cadastro de signatários;
- links de assinatura;
- reenvio;
- cancelamento;
- webhook de retorno;
- atualização automática de status;
- download do PDF assinado;
- auditoria.

### 5.3 Conversão DOCX/PDF

Status: não implementada.

Necessária para provedores que assinam PDF.

Possíveis caminhos:

- gerar DOCX e converter para PDF antes do envio;
- exigir upload de modelo PDF em uma segunda fase;
- usar serviço de conversão;
- usar LibreOffice/headless no backend, se o ambiente suportar.

### 5.4 Promoção do documento assinado para a pasta do colaborador

Status: não implementada.

Após assinatura, o documento final deve ser gravado na pasta documental do colaborador.

Regras desejadas:

- vincular ao `employeeId`;
- vincular ao `onboardingId`;
- preservar documento gerado original;
- preservar PDF assinado final;
- registrar hash;
- registrar auditoria;
- respeitar regras de acesso por tipo documental.

### 5.5 Editor de modelos dentro do sistema

Status: não implementado.

Decisão atual:

- o sistema não será um Word completo neste momento;
- a edição fina do texto/estilo ocorre no Word ou Google Docs;
- o usuário sobe um `.docx` no sistema;
- o sistema valida variáveis, versiona, gera e assina.

Possível fase futura:

- editor rico simples para texto base;
- edição avulsa antes de gerar;
- preview de variáveis;
- preview PDF/DOCX;
- comparação de versões.

## 6. Onde ficam os modelos e documentos

### 6.1 Modelos documentais

Tela recomendada:

- `Documentos → Modelos`

Atalho recomendado também:

- `Departamento pessoal → Configurações → Modelos documentais`

Ambos podem apontar para a mesma tela.

Metadados:

- Firestore: `companyDocumentTemplates`

Arquivo DOCX:

- Storage: `document-templates/{templateId}/versions/{version}/template.docx`

### 6.2 Documentos gerados

Metadados:

- Firestore: `generatedDocuments`

Arquivo DOCX gerado:

- Storage: `generated-documents/{onboardingId ou employeeId}/{generatedDocumentId}/{nome}.docx`

### 6.3 Solicitações de assinatura

Metadados:

- Firestore: `hrSignatureRequests`

Campos esperados:

- `onboardingId`;
- `employeeId`;
- `templateId`;
- `generatedDocumentId`;
- `storagePath`;
- `provider`;
- `providerEnvelopeId`;
- `providerDocumentId`;
- `signers`;
- `status`;
- `requestedAt`;
- `signedAt`;
- `cancelledAt`;
- `error`.

### 6.4 Documentos assinados

Arquivo final:

- Storage: `signed-documents/{onboardingId ou employeeId}/{signatureRequestId}/{nome}.pdf`

Destino final recomendado:

- promover o documento assinado para a pasta documental do colaborador após conclusão.

## 7. Regras importantes já decididas

### 7.1 Coleta e conferência

- Coleta e conferência são uma única fase.
- O link do candidato pode continuar aberto após o envio.
- O RH confere na mesma tela em que os dados e documentos chegam.
- Cada documento tem status individual.
- Se o RH reprovar, o candidato corrige apenas o item reprovado.
- Não pode aprovar documento sem arquivo.
- A mensagem do copiloto só aparece se existir extração real.

### 7.2 Modelos de integração

- A integração é direcionada por cargo/função.
- Ao clicar em `+ Integração`, o sistema deve oferecer:
  - importar modelo;
  - nova integração.
- `Nova integração` é avulsa e não sobrescreve o modelo do cargo/função.
- O modelo deve ser totalmente configurável:
  - fases;
  - perguntas;
  - uploads;
  - responsáveis;
  - ações;
  - regras;
  - condicionais em cascata sem limite artificial;
  - subformulários;
  - grupos/tabelas repetíveis.

### 7.3 Documentos

- O modelo é um DOCX com variáveis.
- O sistema preserva a formatação do Word quando possível.
- Variáveis usam sintaxe `{{employee.name}}`.
- Condicionais usam sintaxe `{{#if employee.has_vt}} ... {{/if}}`.
- O sistema versiona modelos publicados.
- Um documento gerado deve ficar vinculado ao onboarding/colaborador.

### 7.4 Assinatura

- A etapa “Assinatura” não deve mostrar contrato, VT ou acordo fake.
- Só deve mostrar documentos reais, gerados ou configurados.
- Antes da API externa, pode existir assinatura manual/controlada internamente.
- Depois da API externa, status deve vir do provedor por webhook.

## 8. Próximas etapas recomendadas

### Etapa 1 — Fechar e implantar base documental

Incluir:

- dependências do gerador DOCX;
- API de modelos documentais;
- tela `Documentos → Modelos`;
- API de geração;
- testes do gerador e variáveis.

Critério de aceite:

- RH consegue cadastrar um DOCX;
- sistema valida variáveis;
- sistema gera um DOCX preenchido para onboarding/colaborador;
- documento gerado fica salvo em Storage e Firestore.

### Etapa 2 — Implementar trilha interna de assinatura

Incluir:

- UI da etapa “Assinatura” com trilha por documento;
- botão gerar;
- botão baixar/revisar;
- botão criar solicitação interna;
- status interno;
- marcação manual de assinado;
- bloqueio de avanço se obrigatório estiver pendente.

Critério de aceite:

- etapa não é mais placeholder;
- documento real aparece na trilha;
- status muda conforme ações internas;
- auditoria mínima registrada.

### Etapa 3 — Conectar API externa de assinatura

Incluir:

- provedor escolhido;
- criação de envelope;
- envio para signatários;
- webhook;
- download do PDF assinado;
- atualização de status;
- tratamento de erro/reenvio/cancelamento.

Critério de aceite:

- candidato assina pelo provedor;
- sistema recebe webhook;
- documento final assinado volta para o Coala;
- onboarding avança quando todos obrigatórios forem assinados.

### Etapa 4 — Fechar Integração V2

Incluir:

- telas finais de modelo por cargo/função;
- execução real das ações configuráveis;
- validação completa de campos repetíveis/subformulários;
- publicação/versionamento de modelos;
- importação de modelo ao iniciar integração;
- integração com documentos e assinatura.

Critério de aceite:

- usuário cria modelo por cargo/função;
- inicia integração importando modelo;
- executa fluxo sem depender de hardcode;
- nova integração avulsa não altera o modelo.

### Etapa 5 — Fechar período de experiência

Incluir:

- configuração dos dias dos períodos;
- cálculo por data de admissão;
- janela de avaliação;
- alertas;
- termo de prorrogação obrigatório;
- regra de efetivação;
- vínculo com documento de prorrogação e assinatura.

Critério de aceite:

- sistema calcula todas as datas;
- avaliações ficam disponíveis na janela correta;
- termo de prorrogação é exigido quando configurado;
- efetivação respeita a regra definida.

## 9. Estado resumido

Implantado:

- modelo/fases básicas do Atendente de balcão;
- coleta e conferência unificadas;
- bloqueios de aprovação documental;
- link público preservado;
- remoção de documentos fake da assinatura.

Existe localmente, mas ainda precisa commit/rollout:

- gerador DOCX;
- cadastro de modelos documentais;
- hub de documentos;
- 87 variáveis documentais;
- Integração V2 configurável;
- base de período de experiência.

Ainda falta implementar:

- trilha real da etapa Assinatura;
- assinatura digital externa;
- webhook;
- conversão DOCX/PDF;
- promoção automática de documento assinado;
- editor rico interno, se for desejado no futuro.

