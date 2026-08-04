# Achados do sandbox Inter — API Cobrança V3

Data da execução: 2026-08-03
Ambiente: `https://cdpj-sandbox.partners.uatinter.co`
Integração: Coala Sandbox (credenciais e certificado exclusivos do sandbox)

Nenhum ClientID, ClientSecret, token OAuth ou chave privada foi persistido neste documento ou no repositório.

## B1. Autenticação e escopos

- O sandbox exige mTLS também na solicitação de token.
- `Certificado_Webhook.zip` contém apenas a CA usada para validar o cliente que chama nosso webhook; não substitui o certificado de cliente da API.
- `Inter_API-Chave_e_Certificado.zip` contém o certificado e a chave de cliente corretos do sandbox.
- `boleto-cobranca.read`: autorizado, HTTP 200.
- `boleto-cobranca.write`: autorizado, HTTP 200.
- As credenciais existentes de produção não foram substituídas nem alteradas.

## B2. Pagador igual ao beneficiário

Cobrança de R$ 2,50 com pagador pessoa jurídica usando o mesmo CNPJ da empresa beneficiária:

- resultado: rejeitada/falhou;
- HTTP: 500;
- `title`: `Erro desconhecido.`;
- `detail`: `Tente novamente mais tarde, caso o erro persista favor entrar em contato com o suporte inter.`;
- `violacoes`: array vazio.

O sandbox não forneceu um código de regra de negócio mais específico. Para o MVP, o mesmo CNPJ não deve ser usado como pagador.

## B3. Pagador pessoa física

Cobrança com CPF fictício fornecido pela própria documentação do sandbox:

- resultado da emissão: aceita, HTTP 200;
- retorno da emissão: objeto com `codigoSolicitacao` UUID;
- primeira consulta ativa: `situacao = A_RECEBER`;
- pagamento simulado por boleto: HTTP 204;
- consulta ativa posterior: `situacao = RECEBIDO` e `origemRecebimento = BOLETO`.

Consequência: o sandbox comprovou o fluxo com pessoa física. Para produção, o financeiro definiu uma entidade institucional por CNPJ, resolvida pelo cadastro canônico; a primeira emissão continuará manual para validar a aceitação desse pagador no convênio produtivo.

## B4. Valor mínimo

- R$ 2,50 foi aceito em emissão real do sandbox.
- O schema atual declara `valorNominal` no intervalo de `2.5` a `99999999.99`.
- Constante adotada: `MIN_BOLETO_CENTS = 250`.

## B5. Webhook e payload real

Cadastro:

- `PUT /cobranca/v3/cobrancas/webhook`;
- body: `{ "webhookUrl": "https://..." }`;
- resposta: HTTP 204.

Headers observados no callback:

```json
{
  "content-type": "application/json",
  "user-agent": "Java-http-client/21.0.8",
  "x-conta-corrente": "50607169",
  "x-chave-idempotencia": "343df2de-d811-431b-baf9-63dcfbcb3cf9"
}
```

Payload bruto recebido após o pagamento simulado:

```json
[
  {
    "codigoSolicitacao": "ca125087-005a-476f-8e77-6ec7a8728af4",
    "seuNumero": "CXPF03082601",
    "situacao": "RECEBIDO",
    "dataHoraSituacao": "2026-08-03T14:36:45.606Z",
    "valorTotalRecebido": "2.5",
    "origemRecebimento": "RECEBIDO_BOLETO",
    "nossoNumero": "5060098211",
    "codigoBarras": "00000050607169369950291263625464811897339382",
    "linhaDigitavel": "00000050607169323784828257440602555858250003548",
    "txid": "506071691785766893000HGreEEfpDOLzxs",
    "pixCopiaECola": "000201010212261010014BR.GOV.BCB.PIX2579cdpj-sandbox.partners.uatinter.co/pj-s/v2/cobv/d363755152b849ce9c87c880252a05d652040000530398654042.505802BR5901*6013Belo_Horizont61089999999962070503***630496A7"
  }
]
```

Confirmações importantes:

- o corpo é um array, mesmo com um único evento;
- o callback usa `origemRecebimento = RECEBIDO_BOLETO`, enquanto a consulta ativa retorna `origemRecebimento = BOLETO`;
- `x-chave-idempotencia` pode ser armazenado como evidência, mas a idempotência principal deve usar `codigoSolicitacao + situacao + dataHoraSituacao`;
- nenhuma baixa deve confiar só no callback: a consulta ativa confirmou a cobrança como recebida.

## B6. Situações alcançadas

Strings exatas observadas por consulta ativa:

- `A_RECEBER` — cobrança emitida e ainda não liquidada;
- `RECEBIDO` — após pagamento simulado;
- `CANCELADO` — após cancelamento aceito com HTTP 202.

Strings previstas no schema atual, mas não forçadas neste ensaio:

- `MARCADO_RECEBIDO`;
- `ATRASADO`;
- `EXPIRADO`;
- `FALHA_EMISSAO`;
- `EM_PROCESSAMENTO`;
- `PROTESTO`.

O código deve aceitar todas as strings do schema e preservar valores desconhecidos para diagnóstico, sem marcar cobrança como paga por default.

## B7. PDF

`GET /cobranca/v3/cobrancas/{codigoSolicitacao}/pdf` retornou:

- HTTP 200;
- `content-type: application/json`;
- objeto JSON com a chave `pdf`;
- valor de `pdf` em base64;
- resposta total observada: 92.178 bytes.

Consequência: o backend deve extrair `pdf`, decodificar base64 e responder ao navegador com `application/pdf`. Não deve tratar a resposta do Inter como binário direto.

## Decisões técnicas derivadas

- Produção e sandbox terão credenciais/certificados separados.
- O ambiente de Cobrança será escolhido por configuração própria, sem reutilizar `INTER_ENVIRONMENT` de outros fluxos durante a validação.
- `MIN_BOLETO_CENTS = 250`.
- `numDiasAgenda = 30` por default configurável.
- vencimento: D+2 dias úteis por default configurável.
- pagador: entidade institucional referenciada por CNPJ e resolvida no cadastro canônico de Entidades; a emissão fica indisponível se o cadastro estiver incompleto.
- nenhuma emissão bancária será automática.
- ao confirmar `RECEBIDO` em produção, o sistema registra uma única movimentação
  `transfer_in` na conta Banco Inter, em reais e também com `amountCents` para
  conferência; a origem é o caixa físico da unidade. Isso movimenta caixa para
  banco sem duplicar a receita das vendas.
- o lançamento financeiro usa ID determinístico e é reparado pela reconciliação,
  portanto webhook e polling não geram entradas duplicadas.
- liquidações do sandbox não geram lançamentos no financeiro de produção.

O webhook temporário usado para capturar o payload real era exclusivo do ensaio
de sandbox. No rollout ele deve ser substituído pelo endpoint autenticado do
Coala One usando `POST /api/financial/cash-deposits/inter/webhook`.
