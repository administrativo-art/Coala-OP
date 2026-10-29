# Plano — Favorecidos unificados para pagamentos

Data do registro: 20/07/2026
Status: implementado localmente em 20/07/2026, validado e sem rollout

## Registro da implementação local

Foram implementados:

- contrato explícito `employee | entity`;
- resolvedor servidor para colaboradores e entidades;
- perfil financeiro protegido em `supplierPaymentProfiles/{entityId}`;
- criptografia AES-256-GCM para destinos de pagamento de entidades;
- mascaramento de CPF/CNPJ, chave Pix e conta nas respostas de interface;
- fotografia imutável pronta para ser utilizada nas futuras solicitações bancárias;
- auditoria de alterações do perfil financeiro;
- listagem unificada no menu **Financeiro > Favorecidos**;
- permissões separadas para visualizar, ver dados mascarados e gerenciar dados de pagamento;
- configuração de clínicas no menu **Pessoal > Recrutamento > Clínicas de ASO**;
- vínculo da clínica ao cadastro central por `entityId`;
- sinalização da situação do favorecido financeiro dentro do cadastro da clínica;
- bloqueio de CPF/CNPJ duplicado em novos cadastros e edições;
- inativação no lugar de exclusão física de pessoas e empresas;
- regras de Firestore impedindo acesso direto do cliente aos perfis protegidos e às configurações de clínicas;
- script de diagnóstico e normalização dos documentos existentes;
- testes unitários de normalização, mascaramento, schemas e criptografia.

Antes de uma publicação, ainda é obrigatório:

- criar o segredo `PAYMENT_DATA_ENCRYPTION_KEY` com 32 bytes aleatórios em base64;
- executar `scripts/migrate-payment-beneficiaries.ts` primeiro sem `--apply` e revisar duplicidades;
- cadastrar ou confirmar a entidade da clínica e preencher sua configuração de ASO;
- cadastrar e validar os dados financeiros das entidades que receberão pagamentos;
- aplicar e validar as regras dos bancos `coala`, `coala-financeiro` e `coala-rh` no rollout autorizado.

O envio ao Banco Inter e a baixa de pagamentos continuam pertencendo ao plano 2 e não fazem parte desta implementação.

## 1. Decisão principal

O Coala terá um contrato único de favorecido para pagamentos, mas não uma segunda base de fornecedores.

Cada pagamento deverá apontar explicitamente para uma destas origens:

- `employee`: colaborador cadastrado no Coala RH;
- `entity`: pessoa ou empresa cadastrada em **Configurações > Cadastros > Pessoas e empresas**.

Com isso:

- um colaborador recebe pela chave Pix já cadastrada no perfil dele;
- uma clínica, fornecedor, sócio ou prestador usa o cadastro central de pessoas e empresas;
- o Financeiro enxerga os dois tipos em um seletor único;
- o sistema não precisa copiar o colaborador para a lista de fornecedores;
- a origem do favorecido fica inequívoca e auditável.

Este plano é pré-requisito do [plano de implantação da API do Banco Inter](./plano-integracao-api-banco-inter-pagamentos.md).

## 2. Objetivos

- Eliminar cadastros duplicados de fornecedores e favorecidos.
- Permitir pagamentos para colaboradores e entidades pelo mesmo fluxo financeiro.
- Manter dados de RH, cadastro geral e pagamento em seus bancos responsáveis.
- Impedir que informações Pix completas fiquem expostas em documentos públicos ou de leitura ampla.
- Preservar, em cada pagamento, os dados efetivamente utilizados no momento da solicitação.
- Separar permissão de cadastro, manutenção de dados bancários e autorização de pagamento.

## 3. Fora de escopo

- Mover todos os dados do colaborador para a coleção geral de entidades.
- Criar um segundo cadastro de clínicas ou fornecedores dentro do RH.
- Permitir que o RH altere livremente favorecido ou valor no momento de pagar um ASO.
- Armazenar certificado, chave privada ou credenciais bancárias junto ao favorecido.
- Excluir fisicamente um favorecido que já esteja vinculado a pagamentos.

## 4. Fontes oficiais de dados

| Dado | Fonte de verdade | Banco/coleção proposta | Observação |
|---|---|---|---|
| Identidade de pessoa/empresa | Cadastro central | `coala/entities/{entityId}` | Nome, CPF/CNPJ, contato, endereço e situação |
| Dados Pix de fornecedor/entidade | Financeiro | `coala-financeiro/supplierPaymentProfiles/{entityId}` | Leitura protegida; não colocar a chave Pix completa em `entities` |
| Identidade e Pix de colaborador | Perfil do colaborador | registro do colaborador em `coala-rh` | Reaproveita o dado já coletado no RH |
| Configuração da clínica para ASO | RH | `coala-rh/asoClinicConfigs/{entityId}` | Valor do ASO, descrição, e-mail, endereço e situação operacional |
| Solicitação e resultado do pagamento | Financeiro | `coala-financeiro/bankPaymentRequests/{requestId}` | Guarda referência e fotografia imutável do favorecido |
| Histórico | Financeiro | subcoleção `events` ou coleção de auditoria já adotada | Somente acréscimo; não apagar eventos anteriores |

`entities` continua sendo o cadastro central. As coleções de Financeiro e RH são extensões especializadas ligadas pelo mesmo `entityId`, não novos cadastros da pessoa ou empresa.

## 5. Contrato técnico do favorecido

Toda origem que possa gerar pagamento deverá usar esta referência mínima:

```ts
type PaymentBeneficiaryReference =
  | {
      sourceType: "employee";
      sourceId: string;
    }
  | {
      sourceType: "entity";
      sourceId: string;
    };
```

O backend resolverá a referência e devolverá uma representação comum:

```ts
type ResolvedPaymentBeneficiary = {
  sourceType: "employee" | "entity";
  sourceId: string;
  name: string;
  document: string;
  paymentMethod: "pix_key" | "pix_copy_paste" | "bank_details";
  pixKeyType?: "cpf" | "cnpj" | "email" | "phone" | "random";
  pixKey?: string;
  pixCopyPaste?: string;
  validated: boolean;
  sourceUpdatedAt: string;
};
```

Não haverá fallback ambíguo por CPF, e-mail ou nome. O chamador deverá sempre informar `sourceType` e `sourceId`.

## 6. Perfil financeiro da entidade

Estrutura sugerida:

```ts
type SupplierPaymentProfile = {
  entityId: string;
  active: boolean;
  paymentMethod: "pix_key" | "pix_copy_paste" | "bank_details";
  pixKeyType?: "cpf" | "cnpj" | "email" | "phone" | "random";
  pixKeyEncrypted?: string;
  pixCopyPasteEncrypted?: string;
  holderName?: string;
  holderDocument?: string;
  validatedAt?: string;
  validatedBy?: string;
  updatedAt: string;
  updatedBy: string;
};
```

Regras:

- a chave deve ser mascarada nas listagens;
- o valor integral só pode ser resolvido no servidor durante operação autorizada;
- alteração de chave Pix gera evento de auditoria com autor e data;
- nunca registrar chave integral em log de aplicação;
- uma entidade inativa não poderá ser escolhida para nova solicitação;
- pagamentos antigos continuam apontando para a fotografia gravada na solicitação.

## 7. Configuração específica da clínica de ASO

A clínica será uma entidade comum com extensão operacional no RH:

```ts
type AsoClinicConfig = {
  entityId: string;
  active: boolean;
  asoPrice: number;
  defaultPaymentDescription: string;
  schedulingEmail: string;
  address: {
    street: string;
    number: string;
    complement?: string;
    district: string;
    city: string;
    state: string;
    postalCode: string;
    reference?: string;
    mapsUrl?: string;
  };
  updatedAt: string;
  updatedBy: string;
};
```

O CPF/CNPJ e o nome vêm de `entities`; a chave Pix vem do perfil protegido do Financeiro; os dados exclusivos do agendamento e do ASO ficam nesta configuração.

## 8. Resolução do favorecido

Criar um serviço de backend, sem acesso direto do navegador às fontes integrais:

```ts
resolvePaymentBeneficiary(reference, actorContext)
```

Comportamento:

1. valida a permissão do usuário;
2. identifica a fonte por `sourceType`;
3. carrega identidade, CPF/CNPJ e dados de pagamento da fonte correta;
4. verifica se o cadastro está ativo e se o meio de pagamento está completo;
5. devolve dados mascarados para conferência na interface;
6. entrega dados integrais somente ao serviço servidor que envia a ordem ao banco;
7. registra a origem e a versão dos dados usados.

Para `employee`, a resolução deverá acessar apenas os campos indispensáveis ao pagamento. Ter acesso financeiro ao favorecido não concede acesso ao restante do prontuário ou dos documentos de RH.

## 9. Fotografia imutável no pagamento

Ao criar a solicitação, o sistema grava:

```ts
type BeneficiarySnapshot = {
  sourceType: "employee" | "entity";
  sourceId: string;
  name: string;
  document: string;
  paymentMethod: string;
  pixKeyType?: string;
  maskedPixKey?: string;
  sourceUpdatedAt: string;
  resolvedAt: string;
};
```

A informação sigilosa necessária para transmissão ao banco deverá usar campo criptografado ou referência segura de curta duração, conforme a implementação final. A fotografia exibida em auditoria deve permanecer mascarada.

Se o colaborador ou fornecedor alterar a chave depois, o pagamento anterior não será reescrito. Uma nova tentativa de pagamento deverá resolver novamente a fonte e gerar uma nova fotografia.

## 10. Interface

### 10.1 Pessoas e empresas

A aba existente continua como cadastro central. Ela poderá exibir indicadores, sem revelar a chave:

- favorecido configurado;
- meio de pagamento: Pix ou dados bancários;
- dados validados ou pendentes;
- última alteração;
- ativo ou inativo.

### 10.2 Financeiro

O Financeiro terá a manutenção dos dados de pagamento e um seletor único de favorecidos, agrupado em:

- Colaboradores;
- Pessoas e empresas.

Cada resultado mostra nome, CPF/CNPJ mascarado, tipo de origem e situação dos dados de pagamento.

### 10.3 Perfil do colaborador

O perfil continua sendo a tela de manutenção da chave Pix do colaborador. O Financeiro pode consultar a disponibilidade e a versão do dado dentro da permissão concedida, mas não precisa receber acesso integral ao perfil de RH.

## 11. Permissões

Permissões sugeridas:

- `registrations.entities.view`
- `registrations.entities.manage`
- `financial.beneficiaries.view`
- `financial.beneficiaries.payment_data.view_masked`
- `financial.beneficiaries.payment_data.manage`
- `financial.payment_requests.create`
- `financial.payment_requests.authorize`
- `financial.payment_requests.view_proof`
- `hr.aso_clinics.view`
- `hr.aso_clinics.manage`

Regras importantes:

- cadastrar pessoa/empresa não autoriza alterar Pix;
- alterar Pix não autoriza pagamento;
- solicitar pagamento não implica autorizar pagamento;
- a autorização no Coala e a aprovação final no Banco Inter são controles distintos;
- o RH pode usar a clínica configurada sem visualizar a chave integral.

## 12. Integridade, privacidade e auditoria

- CPF/CNPJ deve ser normalizado e ter verificação de duplicidade.
- Uma entidade referenciada deve ser inativada, não apagada.
- Toda alteração de chave, titular, situação ou configuração da clínica deve registrar antes, depois, autor e data; valores sensíveis ficam mascarados no evento.
- Leituras de dados integrais devem ocorrer somente em rotas e serviços de servidor.
- Regras do Firestore não devem conceder leitura geral do perfil de pagamento ao cliente.
- Exportações e telas de auditoria devem mostrar apenas os últimos dígitos da chave quando aplicável.
- O pagamento deve validar que o documento do titular e o favorecido resolvido são coerentes antes do envio ao banco.

## 13. Migração

1. Mapear campos Pix existentes no perfil do colaborador e confirmar a fonte canônica.
2. Identificar clínicas e fornecedores já cadastrados em `entities`.
3. Criar extensões financeiras usando o `entityId` existente.
4. Migrar dados Pix de fornecedores que estejam armazenados em outro local, sem duplicar identidade.
5. Criar a configuração da MedClinic ligada à entidade correspondente.
6. Marcar registros incompletos como pendentes de validação, sem inventar dados.
7. Executar verificação de duplicidade por CPF/CNPJ normalizado.
8. Liberar o seletor unificado somente depois da conferência da migração.

## 14. Etapas de implementação

### Fase 1 — Contratos e segurança

- criar tipos e validadores;
- definir criptografia ou mecanismo seguro para dados Pix;
- criar permissões e regras de servidor;
- criar serviço de resolução e mascaramento.

### Fase 2 — Perfis e migração

- criar `supplierPaymentProfiles`;
- criar `asoClinicConfigs`;
- migrar e validar cadastros existentes;
- adicionar indicadores nas telas.

### Fase 3 — Seletor unificado

- listar colaboradores e entidades autorizadas;
- aplicar busca, agrupamento e situação;
- impedir seleção de cadastro inativo ou incompleto.

### Fase 4 — Integração com solicitações financeiras

- gravar `PaymentBeneficiaryReference`;
- resolver e fotografar o favorecido;
- registrar histórico imutável;
- conectar ao fluxo do Banco Inter.

## 15. Testes obrigatórios

- colaborador com Pix válido;
- colaborador sem Pix;
- entidade com perfil financeiro válido;
- entidade sem perfil financeiro;
- CPF/CNPJ duplicado;
- favorecido inativo;
- alteração de Pix depois da criação da solicitação;
- usuário com acesso ao cadastro, mas sem acesso financeiro;
- usuário financeiro sem acesso aos documentos de RH;
- tentativa de trocar `sourceType` ou `sourceId` pelo navegador;
- concorrência entre atualização do favorecido e criação do pagamento;
- mascaramento em interface, logs e auditoria.

## 16. Critérios de aceite

- O mesmo seletor permite escolher colaborador ou entidade sem duplicar cadastros.
- Todo pagamento possui `sourceType`, `sourceId` e fotografia do favorecido.
- A chave Pix integral não aparece em `entities`, listagens, logs ou documentos de auditoria.
- A alteração posterior do cadastro não muda pagamentos anteriores.
- Um colaborador recebe usando o Pix do perfil de RH.
- Uma clínica recebe usando a extensão financeira da entidade central.
- As permissões separam cadastro, dados Pix, solicitação e autorização.
- Cadastros referenciados podem ser inativados, mas não apagados.

## 17. Decisões pendentes para a implementação

- Nome definitivo da coleção de perfis de pagamento: específica para fornecedores ou genérica para entidades.
- Estratégia de criptografia em repouso para a chave Pix além das proteções da infraestrutura.
- Regra para colaborador que também exista como prestador em `entities`.
- Processo de validação inicial e periódica dos dados Pix.
