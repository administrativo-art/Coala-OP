# Conversor DOCX-PDF do Coala One

## Contrato da imagem

- Gotenberg: `8.34.0-libreoffice-cloudrun`
- Base fixada por digest:
  `sha256:fce81fe9f385be06fe3a8c8a90d8d8fbf77e21e6ebd93d060c306ff3cc59f522`
- Arquitetura do Cloud Run: `linux/amd64`
- Fonte declarada nos DOCX oficiais: Cambria
- Fonte exigida no conversor: Caladea, incluindo regular, bold, italic e
  bold-italic
- Compatibilidade legada: Calibri resolve para Carlito nas quatro faces
- Serviço privado: somente identidades com `roles/run.invoker`

O build falha se o Fontconfig deixar de resolver Cambria para Caladea ou
Calibri para Carlito. Não se usa tag móvel no deploy: a imagem customizada é
construída, seu digest é resolvido no Artifact Registry e o Cloud Run recebe a
referência imutável `imagem@sha256`.

## Implantação

Pré-requisito: conta `gcloud` autenticada no projeto.

```bash
gcloud auth login administrativo@coalashakes.com
bash infra/gotenberg/deploy.sh
```

Valores padrão:

| Parâmetro | Valor |
|---|---|
| Projeto | `smart-converter-752gf` |
| Região | `southamerica-east1` |
| Repositório | `coala-services` |
| Serviço | `coala-gotenberg` |
| CPU / memória | 2 / 2 GiB |
| Concorrência | 4 |
| Escala | 0 a 2 instâncias |

Todos podem ser sobrescritos por variáveis `GOTENBERG_*` descritas no script.

## Integração com o App Hosting

Depois do deploy, adicionar ao `apphosting.yaml` os valores exibidos pelo
script:

```yaml
  - variable: DOCX_TO_PDF_URL
    value: "https://URL-DO-SERVICO"
  - variable: DOCX_TO_PDF_AUDIENCE
    value: "https://URL-DO-SERVICO"
```

Quando `DOCX_TO_PDF_AUDIENCE` existe, a aplicação solicita um identity token
ao metadata server do ambiente Google e envia `Authorization: Bearer` ao Cloud
Run. A aplicação não executa o LibreOffice instalado na máquina do usuário.
No desenvolvimento local, configure as mesmas variáveis e autentique o `gcloud`;
se o serviço remoto estiver indisponível, a prévia degrada para DOCX.

## Canário

O canário compara propriedades, nunca bytes:

- hash do DOCX de origem;
- páginas, A4 e orientação;
- fontes e incorporação;
- páginas sem conteúdo;
- caixas de texto fora da página;
- âncoras de texto e suas coordenadas;
- área segura do modelo.

Após a implantação:

```bash
export DOCX_TO_PDF_URL="https://URL-DO-SERVICO"
export DOCUMENT_CANARY_ID_TOKEN="$(gcloud auth print-identity-token)"
npm run validate:document-canary
```

O golden controlado deve representar o baseline remoto com Caladea. Depois que o primeiro
canário remoto for aprovado visualmente, uma atualização deliberada pode ser
feita com `DOCUMENT_CANARY_UPDATE_GOLDEN=true`. Alterações de golden devem
passar por revisão, nunca ocorrer durante deploy automático.
