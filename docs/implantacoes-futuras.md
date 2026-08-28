# Implantações Futuras

## Link externo para envio de despesas, compras e cotações com IA

### Objetivo

Criar um link externo seguro para colaboradores enviarem prints, comprovantes, PDFs, extratos, fotos de notas e outras evidências sem precisar acessar o sistema completo. O sistema deve receber o material, processar com IA e criar rascunhos para revisão interna.

### Fluxo previsto

1. O colaborador acessa um link externo com token.
2. Informa dados mínimos: nome, unidade, tipo da solicitação e observação.
3. Envia um ou mais arquivos.
4. O sistema cria uma solicitação em fila com o arquivo bruto preservado.
5. A IA extrai e classifica os dados.
6. O sistema cria apenas rascunhos:
   - sessão diária de despesas com origem `ai_assisted` / `external_upload`;
   - cotação com status `draft`;
   - compra com status `created`;
   - item marcado como `needs_review` quando faltar informação.
7. Um usuário interno revisa e finaliza no fluxo normal.

### Regras de segurança e auditoria

- Nunca finalizar despesa, compra ou cotação automaticamente.
- Guardar o arquivo original para conferência.
- Registrar origem da solicitação: `external_upload`.
- Registrar origem do processamento: `ai_assisted`.
- Manter status da solicitação: `received`, `processing`, `draft_created`, `needs_review`, `rejected`.
- Separar permissões do link externo das permissões internas do sistema.

### Provedor de IA

Implementar a integração por adaptador para permitir troca de provedor:

- `provider: "openai" | "gemini"`
- Começar preferencialmente com Gemini Flash-Lite/Flash para custo baixo.
- Usar modelo mais forte apenas em exceções: PDFs ruins, extratos grandes ou documentos ambíguos.

### Estimativa de custo

Implementação MVP: 7 a 14 dias de desenvolvimento.

Custo mensal de IA estimado:

- 100 documentos/mês: abaixo de US$ 1-3.
- 1.000 documentos/mês: cerca de US$ 3-20.
- 10.000 documentos/mês: cerca de US$ 30-200.

O custo principal tende a ser desenvolvimento e manutenção, não o consumo de IA.

### Decisão pendente

Decidir depois:

- se o processamento será automático via API ou assistido manualmente;
- se o provedor inicial será Gemini ou OpenAI;
- quais usuários externos poderão receber link;
- se cada unidade terá link próprio ou se o formulário pedirá a unidade;
- política de retenção dos arquivos enviados.

---

## Card de dependentes, IRRF e salário-família no onboarding

### Status

Ideia consolidada para implantação futura. Ainda não implementada.

### Objetivo

Criar, na etapa **Documentos** do onboarding, um card específico para tratar dependentes, declaração de IRRF e salário-família. O sistema deve conferir os dados informados pela candidata com a documentação dos dependentes, encaminhar divergências ao RH, gerar os documentos aplicáveis e acompanhar as assinaturas pelo Autentique.

O card deve ser criado sempre que houver dependentes declarados. IRRF e salário-família serão trilhas independentes dentro do mesmo card, pois um dependente pode ser aplicável ao IRRF sem gerar direito ao salário-família.

### Princípios da solução

- A pré-elegibilidade será calculada por regras determinísticas no backend, considerando vínculo, competência, remuneração total, outros vínculos, idade ou invalidez e documentação exigida.
- O copiloto apenas confrontará formulário e documentos. Ele não concederá nem rejeitará o benefício.
- A decisão final e a resolução de divergências serão responsabilidade do RH.
- Antes da confirmação, a interface usará **Pré-elegível**, e não **Elegível**.
- As regras e valores legais serão parametrizados por competência, sem constantes duplicadas espalhadas pelo sistema.
- Cada dependente deverá possuir identificador estável, sem depender da posição na lista.

### Campos complementares do formulário

- Parentesco do dependente.
- Nome, CPF e data de nascimento.
- Pedido de dedução como dependente no IRRF.
- Pedido de salário-família.
- Existência de outros vínculos e remuneração mensal correspondente.
- Informação sobre dependente comum e eventual assinatura do cônjuge.
- Situação de invalidez ou tutela, quando aplicável, direcionando o caso para conferência manual.

### Fluxo do card

1. **Triagem automática**
   - Classifica como `Pré-elegível ao salário-família`, `Somente IRRF`, `Não aplicável` ou `Informações insuficientes`.
2. **Documentação dos dependentes**
   - Exibe checklist individual por dependente conforme idade e situação declarada.
3. **Análise automática do copiloto**
   - Começa quando todos os dados e documentos mínimos estiverem disponíveis.
   - Compara nome, CPF, nascimento, parentesco e demais evidências relevantes.
   - Aponta documento ausente, ilegível, incompleto ou divergente, acompanhado da confiança da leitura.
4. **Revisão do RH**
   - Permite confirmar o enquadramento, solicitar correção, marcar como não aplicável ou registrar a não concessão com justificativa.
5. **Geração dos documentos**
   - Declaração de dependentes para IRRF, quando solicitada.
   - Termo de responsabilidade para salário-família, quando confirmado.
6. **Assinatura**
   - Revisa e envia os documentos ao Autentique, preferencialmente em envelopes separados porque os signatários podem ser diferentes.
7. **Conclusão**
   - Arquiva os PDFs assinados e libera as informações para folha, contador e cadastro no eSocial.

Estados principais do card:

`Aguardando documentos` → `Análise programada` → `Analisando` → `Revisão do RH` → `Pronto para gerar` → `Aguardando assinatura` → `Concluído`

### Controle de consumo de IA

O responsável comum pelo fluxo não terá botões capazes de consumir tokens diretamente.

- A análise inicial será disparada pelo backend quando o conjunto mínimo estiver completo.
- Alterações materiais em dados ou arquivos invalidarão o resultado anterior e programarão nova análise automaticamente.
- O backend gerará uma impressão digital dos campos e arquivos. Uma combinação já analisada reutilizará o resultado existente.
- Uma análise em execução bloqueará solicitações duplicadas.
- A substituição por arquivo idêntico não disparará nova análise.
- Retentativas automáticas serão limitadas e usarão intervalo progressivo.
- `Solicitar correção` e `Confirmar enquadramento` não chamarão o modelo.
- `Tentar novamente` ficará restrito a administradores e somente após falha técnica registrada.
- Cada execução registrará motivo, versão dos dados, arquivos analisados, usuário, tokens e custo estimado.
- Não haverá polling de coleções para iniciar ou acompanhar a análise.

### Processos em andamento

A implantação não deverá retroceder etapas nem exigir o reenvio de documentos já existentes.

- Processos sem dependentes não serão alterados.
- Processos antes ou dentro de Documentos entrarão no fluxo normal.
- Processos que já passaram de Documentos receberão o card como `Regularização pendente`, sem mudança da etapa atual.
- Processos com documentação incompleta ficarão aguardando documentos e não consumirão IA.
- Processos ativos com documentação completa poderão receber uma única análise automática, por fila controlada.
- Termos já assinados poderão ser vinculados pelo RH e marcados como regularizados sem nova análise.
- Processos concluídos ou arquivados não serão modificados automaticamente.
- Quando o pacote admissional já tiver sido enviado ao contador, os novos termos assinados formarão um pacote complementar.

Antes da migração deverá existir um preflight que apresente quantidade de processos afetados, documentação disponível, número de análises necessárias e estimativa de tokens e custo. A rotina será idempotente e criará no máximo um card por processo.

### Bloqueios operacionais

Pendências no card não deverão impedir ASO ou outras atividades admissionais independentes. Entretanto, a finalização documental para folha e contador exigirá uma destas saídas auditadas:

- termos aplicáveis assinados;
- caso marcado como não aplicável;
- decisão formal do RH de seguir sem concessão naquele momento.

### Permissões e auditoria

- Leitura dos dados e documentos sensíveis dependerá das permissões existentes de RH e documentos.
- A revisão, confirmação, geração e envio para assinatura deverão ser validados no servidor por permissões específicas ou equivalentes já existentes.
- Ocultar botões não será considerado controle de acesso.
- Toda decisão, correção, geração, envio, assinatura e regularização deverá entrar no histórico do processo.

### Decisões pendentes

- Definir os modelos oficiais da declaração de IRRF e do termo de salário-família.
- Confirmar quando a assinatura do cônjuge será exigida na declaração de IRRF.
- Definir o prazo operacional para regularização de processos que já avançaram.
- Definir se haverá permissão exclusiva para administrar falhas e retentativas da análise.
- Executar o preflight dos processos ativos antes de aprovar a migração e o orçamento de IA.
