# Cadastro automatico de empresa por CNPJ

## Arquitetura

O cadastro de fornecedores, clientes PJ, prestadores e empresas continua usando a colecao existente `entities`. O modulo novo adiciona uma camada de consulta e normalizacao para CNPJ sem criar uma base paralela.

Arquivos principais:

- `src/lib/company/cnpj-validator.ts`: limpeza, mascara e validacao de digitos verificadores.
- `src/lib/company/company-lookup-service.ts`: coordena base interna, cache, BrasilAPI, ViaCEP e Sintegra futuro.
- `src/lib/company/internal-company-repository.ts`: consulta/salva `entities`, cache e historico.
- `src/lib/company/providers/brasil-api-cnpj-provider.ts`: consulta BrasilAPI.
- `src/lib/company/providers/via-cep-provider.ts`: consulta ViaCEP.
- `src/lib/company/providers/sintegra-provider.ts`: contrato preparado para integracao futura.
- `src/lib/company/company-normalizer.ts`: converte retornos externos para o formato padrao.
- `src/lib/company/company-registration-service.ts`: salva o cadastro confirmado.
- `src/lib/company/company-refresh-service.ts`: forca consulta externa.
- `src/components/entity-management.tsx`: tela de Pessoas e empresas com busca automatica por CNPJ.

## Modelagem no Firestore

### `entities`

Campos principais usados para empresas:

- `cnpj`
- `razao_social`
- `nome_fantasia`
- `situacao_cadastral`
- `data_abertura`
- `natureza_juridica`
- `cnae_principal_codigo`
- `cnae_principal_descricao`
- `cnaes_secundarios_json`
- `inscricao_estadual`
- `contribuinte_icms`
- `situacao_inscricao_estadual`
- `cep`, `logradouro`, `numero`, `complemento`, `bairro`, `cidade`, `uf`
- `telefone`, `email`
- `tipo_empresa`
- `origem_dados`
- `data_ultima_consulta_cnpj`
- `observacoes`
- Campos legados compativeis: `name`, `fantasyName`, `document`, `address`, `contact`, `notes`.

### `consultas_cnpj`

Historico de consultas:

- `cnpj`
- `usuario_id`
- `fonte_consultada`
- `fontes_consultadas`
- `resultado`
- `erro`
- `dados_brutos_json`
- `criado_em`

### `cnpjLookupCache`

Cache por CNPJ limpo. TTL padrao: 24 horas.

### `fontes_empresa`

Persistencia dos retornos brutos/normalizados por fonte:

- `empresa_id`
- `cnpj`
- `fonte`
- `status`
- `mensagem`
- `dados_normalizados`
- `dados_brutos_json`
- `data_consulta`

## Endpoints internos

### `GET /api/companies/cnpj/{cnpj}`

Valida CNPJ, consulta `entities`, cache, BrasilAPI e ViaCEP.

Exemplo:

```http
GET /api/companies/cnpj/64433090000197
Authorization: Bearer <firebase-token>
```

Resposta resumida:

```json
{
  "found": true,
  "source": "brasilapi",
  "message": "CNPJ encontrado. Revise os dados antes de salvar.",
  "company": {
    "cnpj": "64433090000197",
    "razao_social": "GAB INDUSTRIA GRAFICA LTDA",
    "nome_fantasia": "NATUCOPOS EXPRESS",
    "origem_dados": "brasilapi"
  },
  "alerts": [],
  "canManualRegister": true
}
```

### `POST /api/companies`

Salva a empresa confirmada pelo usuario e impede duplicidade de CNPJ.

```json
{
  "company": {
    "cnpj": "64433090000197",
    "razao_social": "GAB INDUSTRIA GRAFICA LTDA",
    "nome_fantasia": "NATUCOPOS EXPRESS",
    "origem_dados": "brasilapi"
  },
  "sourceResults": []
}
```

### `PUT /api/companies/{id}`

Atualiza empresa existente.

### `POST /api/companies/cnpj/{cnpj}/refresh`

Ignora cache/base interna e forca nova consulta externa. A tela aplica os dados no formulario; o usuario ainda precisa salvar.

### `GET /api/companies/{id}/consultation-history`

Retorna historico das consultas daquele CNPJ.

## Fluxo de UI

1. Usuario digita ou cola o CNPJ.
2. A mascara `00.000.000/0000-00` e aplicada.
3. Com 14 digitos, a consulta automatica dispara com debounce de 650ms.
4. Ao sair do campo, a consulta tambem e tentada se o CNPJ estiver completo.
5. O formulario e preenchido, mas nada e salvo automaticamente.
6. O usuario revisa, edita IE/ICMS/CNAE/endereco e salva.
7. Se a base interna ja tiver o CNPJ, o cadastro existente e carregado e o salvamento atualiza esse registro.

## Variaveis de ambiente

Nenhuma chave e obrigatoria para BrasilAPI ou ViaCEP.

Opcional:

```bash
COMPANY_LOOKUP_TIMEOUT_MS=4500
CNPJ_LOOKUP_CACHE_TTL_HOURS=24
COMPANY_LOOKUP_USER_AGENT="Coala-OP/1.0 (email@dominio.com)"
```

## Testes basicos

```bash
npm run test:unit
npm run typecheck
```

O teste cobre:

- CNPJ valido;
- CNPJ invalido;
- normalizacao de resposta BrasilAPI;
- merge de endereco ViaCEP.

## Fontes externas

- BrasilAPI CNPJ: `https://brasilapi.com.br/api/cnpj/v1/{cnpj}`
- ViaCEP: `https://viacep.com.br/ws/{cep}/json/`
