# Plano — Implantação da API do Banco Inter para pagamentos

Data do registro: 20/07/2026
Status: implementação local concluída; sem rollout e aguardando credenciais/testes de homologação do Banco Inter

## 1. Objetivo

Implantar pagamentos Pix pelo Banco Inter em dois fluxos iniciais:

1. pagamento do ASO antes da solicitação de agendamento à clínica;
2. pagamento de recibos gerados pelo Coala, após autorização do Financeiro.

O Coala criará e acompanhará a solicitação bancária. Quando a conta exigir aprovação, o responsável aprovará o pagamento no aplicativo ou Internet Banking do Inter. O sistema somente marcará o pagamento como concluído após confirmação bancária e, então, armazenará o comprovante para visualização e auditoria.

Este plano depende do [plano de favorecidos unificados](./plano-favorecidos-pagamentos-unificados.md). Ele é independente do plano de cobrança de depósitos descrito em [fechamento de caixa e depósitos](./plano-fechamento-caixa-depositos.md): aqui o foco é **saída por Pix**, não emissão de boleto de entrada.

## 2. Resultado operacional esperado

### ASO

```text
Guia validada
  → pagamento Pix enviado ao Inter
  → aprovação do responsável no banco
  → confirmação e comprovante
  → e-mail para a clínica com 3 anexos
  → monitoramento do agendamento
  → comunicação ao candidato
  → envio e auditoria do ASO final
```

### Recibo

```text
Recibo gerado
  → despesa/solicitação criada no Financeiro
  → autorização do Financeiro
  → pagamento Pix enviado ao Inter
  → aprovação do responsável no banco
  → confirmação e comprovante
  → baixa financeira e recibo marcado como pago
```

## 3. Premissas bancárias validadas

Para pagamentos Pix, a API Banking do Inter disponibiliza:

- criação: `POST https://cdpj.partners.bancointer.com.br/banking/v2/pix`;
- consulta: `GET /banking/v2/pix/{codigoSolicitacao}`;
- pagamento por chave Pix, dados bancários ou código Pix Copia e Cola;
- idempotência pelo cabeçalho `x-id-idempotente`, com UUID;
- retorno de solicitação pendente de aprovação com `tipoRetorno: "APROVACAO"` e `codigoSolicitacao`;
- webhook de Banking do tipo `pix-pagamento`;
- consulta ativa para reconciliação e confirmação final.

Escopos iniciais:

- `pagamento-pix.write`;
- `pagamento-pix.read`;
- `webhook-banking.write`;
- `webhook-banking.read`;
- `extrato.read`, se necessário para conciliação e comprovante.

A aprovação no aplicativo depende da configuração da conta e deve ser validada no Internet Banking em **Aprovar > Gestão de Aprovações**.

Fontes oficiais:

- [API Banking do Banco Inter](https://developers.inter.co/references/banking)
- [Changelog oficial](https://developers.inter.co/changelog)
- [Certificado e credenciais da API](https://ajuda.inter.co/conta-digital-pessoa-juridica/como-faco-o-download-do-certificado-e-credenciais-da-minha-api)
- [Disponibilidade da API para Conta Digital PJ](https://ajuda.inter.co/conta-digital-pessoa-juridica/o-inter-disponibiliza-alguma-api-para-minha-conta-digital-pj)

Antes de codificar os estados finais, a documentação e as respostas do ambiente de homologação deverão ser conferidas novamente, pois os códigos e recursos da API podem evoluir.

## 4. Pré-requisitos

- Integração ativa e aprovada pelo Banco Inter.
- `client_id` e `client_secret` da mesma integração.
- certificado `.crt` e chave privada correspondentes.
- conta corrente vinculada à integração.
- escopos de Pix e webhook habilitados.
- política de aprovação bancária configurada.
- ambiente de homologação disponível antes da produção.
- URL pública HTTPS para o webhook.
- favorecidos cadastrados e validados conforme o plano unificado.
- definição do processo de obtenção do comprovante oficial.

### Custos

O Inter informa oficialmente que a integração da API Pix é gratuita e descreve as tarifas de recebimento como de baixo custo. Para o fluxo deste plano, porém, será usado Pix de saída pela API Banking, e a página pública não apresenta uma tabela objetiva por transação. Antes do rollout, o titular deve confirmar no contrato ou com o atendimento do Inter se a conta possui tarifa para Pix Cash-Out. Custos próprios de hospedagem, armazenamento e execução do Coala continuam aplicáveis.

## 5. Segredos e configuração

Variáveis propostas:

- `INTER_CLIENT_ID`
- `INTER_CLIENT_SECRET`
- `INTER_CERTIFICATE_BASE64`
- `INTER_PRIVATE_KEY_BASE64`
- `INTER_ACCOUNT_NUMBER`
- `INTER_ENVIRONMENT`
- `INTER_WEBHOOK_SECRET`, se a estratégia de validação adotada exigir segredo adicional do Coala

Regras:

- armazenar todos os segredos no Secret Manager usado pelo App Hosting;
- nunca salvar certificado, chave privada ou segredo no Firestore, repositório ou logs;
- nunca enviar credenciais ao navegador;
- validar que certificado, chave e credenciais pertencem à mesma integração;
- separar configuração de homologação e produção;
- renovar o certificado antes do vencimento com alerta operacional.

## 6. Arquitetura proposta

Módulos de servidor sugeridos:

```text
src/lib/integrations/inter/
  config.server.ts
  auth.server.ts
  client.server.ts
  pix-payments.server.ts
  webhooks.server.ts
  proof.server.ts

src/features/financial/payment-requests/
  types.ts
  schemas.ts
  repository.server.ts
  service.server.ts
  reconciliation.server.ts
```

Rotas sugeridas:

```text
POST /api/financial/payment-requests
POST /api/financial/payment-requests/{id}/authorize
POST /api/financial/payment-requests/{id}/submit
POST /api/financial/payment-requests/{id}/refresh
GET  /api/financial/payment-requests/{id}/proof
POST /api/webhooks/inter/banking
```

Todas as chamadas ao Inter serão feitas no servidor com mTLS. O token OAuth, atualmente com validade informada de 60 minutos, deve ser reutilizado por cache seguro e renovado somente quando necessário.

## 7. Modelo da solicitação bancária

Coleção proposta:

`coala-financeiro/bankPaymentRequests/{requestId}`

```ts
type BankPaymentRequestStatus =
  | "draft"
  | "awaiting_financial_authorization"
  | "ready_to_submit"
  | "submitting"
  | "awaiting_bank_approval"
  | "processing"
  | "paid"
  | "rejected"
  | "approval_expired"
  | "failed"
  | "cancelled";

type BankPaymentRequest = {
  sourceType: "aso" | "generated_receipt";
  sourceId: string;
  expenseId?: string;
  beneficiaryReference: PaymentBeneficiaryReference;
  beneficiarySnapshot: BeneficiarySnapshot;
  amount: number;
  description: string;
  status: BankPaymentRequestStatus;
  idempotencyKey: string;
  interRequestId?: string;
  bankStatus?: string;
  endToEndId?: string;
  proofStoragePath?: string;
  authorizedBy?: string;
  authorizedAt?: string;
  submittedAt?: string;
  paidAt?: string;
  createdAt: string;
  createdBy: string;
  updatedAt: string;
  lastError?: {
    code: string;
    safeMessage: string;
    occurredAt: string;
  };
};
```

Cada solicitação terá uma subcoleção `events` somente para acréscimo, contendo mudanças de estado, chamadas relevantes, webhook recebido, consulta de reconciliação, autorização, rejeição e comprovante.

## 8. Idempotência e concorrência

- Gerar um UUID de idempotência uma única vez por tentativa bancária.
- Reutilizar a mesma chave ao repetir uma chamada cujo resultado seja desconhecido.
- Nunca reutilizar a chave em uma nova tentativa intencional após rejeição ou cancelamento.
- Usar transação no banco para impedir dois envios simultâneos da mesma solicitação.
- Desabilitar duplo clique na interface, sem depender apenas dessa proteção visual.
- Antes de reenviar após timeout, consultar o Inter pelo identificador disponível.
- Webhooks duplicados ou fora de ordem não podem regredir um pagamento `paid`.

## 9. Mapeamento de estados

O adaptador do Inter deverá preservar o status bruto em `bankStatus` e mapear para o estado interno.

Regras mínimas:

- retorno de aprovação exigida → `awaiting_bank_approval`;
- aceito e ainda processando → `processing`;
- confirmado/liquidado → `paid`;
- rejeitado pelo aprovador ou banco → `rejected`;
- prazo de aprovação encerrado → `approval_expired`;
- erro técnico recuperável → permanece no último estado seguro e agenda reconciliação;
- falha definitiva → `failed`;
- cancelamento permitido e confirmado → `cancelled`.

A relação exata entre códigos brutos e estados internos será congelada depois dos testes na homologação.

## 10. Webhook e confirmação ativa

O webhook acelera a atualização, mas não será a única prova de pagamento.

Ao receber um evento:

1. validar método, formato e controles de autenticidade disponíveis;
2. localizar a solicitação pelo identificador bancário;
3. persistir o evento bruto de forma segura e idempotente;
4. consultar ativamente `GET /banking/v2/pix/{codigoSolicitacao}`;
5. comparar valor, favorecido, situação e identificadores;
6. somente então atualizar o estado interno;
7. disparar as consequências do domínio uma única vez.

Também haverá reconciliação periódica para solicitações em `awaiting_bank_approval`, `processing` ou com webhook inconsistente. A consulta informada pelo Inter possui janela máxima de 90 dias; o Coala deverá guardar seu próprio histórico definitivo.

## 11. Comprovante

Ordem de preferência:

1. obter e armazenar o PDF oficial do Banco Inter;
2. caso o endpoint disponível não forneça o arquivo, gerar no Coala um documento auditável com os dados confirmados pelo banco.

O PDF gerado pelo Coala deve se chamar claramente **Comprovante de pagamento confirmado pelo Banco Inter**, sem se apresentar como comprovante emitido pelo banco. Ele deve conter:

- favorecido e CPF/CNPJ mascarado;
- valor;
- data e hora de confirmação;
- descrição;
- `codigoSolicitacao`;
- identificador End-to-End, quando fornecido;
- origem do pagamento;
- registro de que os dados foram confirmados por consulta à API.

O endpoint e o formato exatos do comprovante oficial precisam ser validados na homologação antes da decisão final.

## 12. Fluxo do ASO

### 12.1 Preparação

1. RH seleciona a clínica já cadastrada.
2. Sistema carrega empresa/CNPJ da contratação, clínica, valor do ASO e favorecido configurado.
3. Sistema gera a guia do ASO.
4. RH audita e valida a guia.
5. Valor e favorecido aparecem bloqueados para edição no fluxo do ASO.

Alterações no valor ou Pix da clínica devem ocorrer no cadastro autorizado, com histórico, e não na tela do processo.

### 12.2 Pagamento

1. O fluxo do ASO cria a solicitação com `sourceType: "aso"`.
2. Para este caso, não há uma etapa adicional de autorização pelo Financeiro dentro do Coala.
3. O servidor resolve o favorecido e envia o Pix ao Inter.
4. Se o banco exigir aprovação, a etapa mostra **Aguardando aprovação no Banco Inter**.
5. O responsável aprova no aplicativo ou Internet Banking.
6. Webhook e consulta ativa confirmam o pagamento.
7. O sistema armazena o comprovante e libera o envio à clínica.

### 12.3 E-mail à clínica

O e-mail só poderá ser enviado quando o pagamento estiver `paid` e o comprovante estiver disponível.

Anexos, nesta ordem e com nomenclatura padronizada:

1. `Anexo 1 - Contrato social.pdf` — documento mais recente do CNPJ responsável;
2. `Anexo 2 - Comprovante de pagamento.pdf`;
3. `Anexo 3 - Guia de solicitação do ASO.pdf`.

O restante do fluxo já previsto continua: entrega e abertura, resposta escrita ou link de agendamento, análise de data/horário, aviso ao candidato, link exclusivo para anexar o ASO e auditoria do documento final.

## 13. Fluxo dos recibos

1. Ao gerar o recibo, criar uma despesa e uma solicitação bancária com `sourceType: "generated_receipt"`.
2. A solicitação começa em `awaiting_financial_authorization`.
3. O Financeiro confere valor, origem e favorecido e autoriza no Coala.
4. O sistema envia o Pix ao Inter.
5. O responsável aprova no aplicativo ou Internet Banking, quando exigido.
6. Webhook e consulta ativa confirmam a liquidação.
7. Somente em `paid` o sistema:
   - marca a despesa como paga;
   - cria ou conclui o registro em `payments`;
   - cria a transação financeira correspondente;
   - vincula o comprovante;
   - marca o recibo como pago.

O diálogo atual que registra uma despesa como paga manualmente deverá ser adaptado. Solicitar ou autorizar pagamento via Inter não pode produzir baixa antecipada.

## 14. Interface

### Solicitação

- origem do pagamento;
- favorecido e documento;
- chave mascarada;
- valor e descrição;
- situação da validação do favorecido;
- botão de solicitar ou autorizar, conforme o fluxo e a permissão.

### Acompanhamento

- aguardando autorização do Financeiro;
- pronto para envio;
- aguardando aprovação no Banco Inter;
- processando;
- pago;
- rejeitado, expirado ou com falha;
- ação **Atualizar situação**;
- histórico de eventos;
- ação **Visualizar comprovante** quando disponível.

Não haverá botão que simule pagamento concluído antes da confirmação bancária.

## 15. Permissões

Permissões mínimas:

- `financial.payment_requests.view`
- `financial.payment_requests.create`
- `financial.payment_requests.authorize`
- `financial.payment_requests.submit`
- `financial.payment_requests.refresh`
- `financial.payment_requests.view_proof`
- `financial.inter_integration.manage`
- permissões de favorecidos definidas no plano anterior

O ASO poderá possuir uma autorização de serviço específica que permita a criação e o envio predefinido sem conceder ao RH poder de criar pagamentos arbitrários.

## 16. Segurança

- Toda comunicação com o Inter ocorre no backend com mTLS.
- Valor, favorecido e origem são revalidados no servidor.
- O navegador nunca envia uma chave Pix livre para a rota de pagamento; envia a referência do favorecido.
- No ASO, a clínica e o preço devem corresponder à configuração ativa.
- Usuários do Financeiro não recebem acesso automático ao prontuário do colaborador.
- Logs devem omitir segredo, certificado, chave Pix integral, token e corpo bancário sensível.
- Webhook não executa baixa financeira sem consulta de confirmação.
- Mudanças administrativas na integração geram auditoria.

## 17. Observabilidade e recuperação

- métricas de solicitações por estado e tempo em cada estado;
- alerta para aprovação pendente além do prazo operacional;
- alerta para webhook sem solicitação correspondente;
- alerta para divergência de valor ou favorecido;
- fila de reconciliação com retentativa exponencial;
- painel de falhas com mensagem segura e código técnico;
- rotina manual autorizada para consultar novamente, nunca para forçar `paid`;
- registro de correlação entre `requestId`, idempotency key e `codigoSolicitacao`.

## 18. Etapas de implantação

### Fase 1 — Homologação e fundação

- validar credenciais, certificado e escopos;
- implementar cliente mTLS e cache de token;
- confirmar payloads, respostas e estados reais;
- validar aprovação no app e obtenção de comprovante.

### Fase 2 — Núcleo de pagamentos

- criar modelo e repositório;
- implementar idempotência, envio, consulta e eventos;
- implementar webhook e reconciliação;
- implementar comprovante.

### Fase 3 — Favorecidos e permissões

- conectar o resolver unificado;
- aplicar mascaramento;
- criar permissões e regras de acesso;
- implementar telas de acompanhamento.

### Fase 4 — ASO

- inserir pagamento entre validação da guia e e-mail à clínica;
- bloquear envio sem confirmação e comprovante;
- incluir os três anexos na ordem definida;
- testar o fluxo completo.

### Fase 5 — Recibos e Financeiro

- criar solicitação ao gerar recibo;
- implementar autorização do Financeiro;
- impedir baixa antecipada;
- concluir despesa, pagamento, transação e recibo após confirmação.

### Fase 6 — Produção controlada

- configurar segredos de produção;
- cadastrar webhook de produção;
- validar com pagamentos de baixo valor e favorecidos controlados;
- acompanhar reconciliação e auditoria;
- liberar gradualmente os fluxos autorizados.

Nenhuma fase deverá ir a rollout apenas por estar codificada; produção exige homologação bancária, teste de segurança e autorização explícita.

## 19. Matriz mínima de testes

- autenticação mTLS válida e inválida;
- token expirado e renovação;
- certificado perto do vencimento;
- favorecido colaborador e favorecido entidade;
- chave Pix ausente, inválida ou alterada;
- clique duplo e chamadas concorrentes;
- timeout depois do envio ao banco;
- aprovação, rejeição e expiração no aplicativo;
- webhook duplicado, atrasado ou fora de ordem;
- consulta ativa com divergência de valor ou favorecido;
- pagamento confirmado sem comprovante disponível;
- falha de armazenamento do comprovante;
- ASO tentando enviar e-mail antes do pagamento;
- ASO com contrato social desatualizado;
- recibo sem autorização financeira;
- garantia de que despesa não foi baixada antes de `paid`;
- permissão insuficiente em cada ação;
- logs e auditoria sem segredos ou chave Pix integral.

## 20. Critérios de aceite

- O mesmo pagamento não pode ser criado duas vezes por repetição de requisição.
- O Coala representa corretamente a espera pela aprovação no Banco Inter.
- Webhook isolado não marca pagamento como concluído sem confirmação ativa.
- Apenas `paid` produz baixa financeira e comprovante definitivo.
- O e-mail da clínica contém os três anexos na ordem e nomenclatura definidas.
- O pagamento do ASO usa clínica e valor previamente configurados.
- Recibos exigem autorização do Financeiro antes do envio ao banco.
- Colaboradores recebem pela chave Pix do perfil; entidades, pelo perfil financeiro central.
- Certificados e credenciais permanecem no Secret Manager e no servidor.
- Todas as mudanças de estado possuem histórico, autor/origem e data.

## 21. Decisões pendentes para a implementação

- Endpoint e formato definitivo do comprovante oficial de Pix no ambiente contratado.
- Regras exatas de aprovação configuradas na conta Inter.
- Prazo operacional para alertar ou expirar solicitações pendentes.
- Política de nova tentativa depois de rejeição ou expiração.
- Forma de validação periódica de chave Pix e titularidade.
- Contas Inter envolvidas e regra de seleção quando houver mais de uma conta.

## 22. Registro da implementação local

Implementado em 20/07/2026, sem publicação:

- cliente OAuth com mTLS, cache de token e ambientes sandbox/produção;
- criação e consulta de Pix com idempotência e conta corrente opcional;
- coleção protegida `bankPaymentRequests`, histórico somente de acréscimo e transições transacionais;
- autorização financeira separada do envio bancário;
- webhook com segredo, deduplicação e confirmação por consulta ativa;
- reconciliação periódica protegida, processando uma solicitação por execução para respeitar o limite bancário;
- validação de valor e CPF/CNPJ antes da baixa;
- comprovante PDF auditável gerado pelo Coala após confirmação;
- conclusão idempotente de despesa, pagamento, transação e recibo;
- pagamento do ASO após validação da guia, usando clínica/valor/favorecido cadastrados;
- bloqueio do e-mail da clínica até `paid` e comprovante disponível;
- anexos do e-mail do ASO na ordem e nomenclatura aprovadas;
- painel de pagamentos bancários e permissões granulares no perfil;
- segredos declarados no App Hosting, sem valores no repositório.

Pendências externas antes de rollout:

- cadastrar os segredos no Secret Manager;
- testar certificado, escopos, aprovação no aplicativo, webhook e estados reais no sandbox;
- confirmar se a conta contratada oferece comprovante oficial individual; até lá o Coala gera o documento auditável claramente identificado;
- configurar a URL pública do webhook e o agendamento da reconciliação;
- autorizar explicitamente o rollout após homologação.
