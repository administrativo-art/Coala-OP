# Gerador de Documentos — arquitetura e estado

Atualizado em 28/07/2026.

## Resultado

O Coala One possui um motor único de documentos. O modelo declara variáveis,
partes, passos, grupos repetíveis, cálculos e condições; o gerador resolve o
schema, produz DOCX e PDF, aplica o timbrado, registra auditoria e encaminha o
artefato para assinatura ou arquivamento.

O código do escopo consolidado está implementado. A entrada em produção dos
modelos admissionais permanece deliberadamente bloqueada por decisões externas:
revisão jurídica, homologação visual do RH, implantação autenticada do conversor
e teste real no provedor de assinatura.

## Componentes implementados

### Gerador guiado por schema

- schema declarativo de passos, campos, condições, partes, grupos repetíveis e
  campos calculados;
- colaborador deixou de ser obrigatório para modelos que não o exigem;
- partes polimórficas com snapshot de pessoa/empresa;
- clonagem OOXML de linhas de tabela para zero, um ou muitos itens;
- cálculos de soma e formatação monetária;
- assistente de geração construído a partir do schema;
- recibo como primeiro modelo genérico, com série `REC`, partes livres, itens,
  total por extenso e pagamento condicional;
- idempotência por modelo, versão, partes, colaborador e valores resolvidos.

### Preparação de modelos com IA

- leitura segura do texto do DOCX;
- bloqueio antes da IA quando a matriz contém indícios de CPF, salário, e-mail
  pessoal ou nome preenchido;
- saída estruturada como plano de mapeamento, com trecho, ocorrência, variável,
  confiança e justificativa;
- validação determinística das ocorrências;
- a IA não altera nem publica o arquivo.
- tabela de revisão linha a linha, com destaque de baixa confiança;
- aplicação somente das linhas aceitas, com nova versão em rascunho e validação
  exata antes de gravar o DOCX.

### Motor DOCX e conversão

- normalização de runs fragmentados;
- substituição determinística e remoção condicional de parágrafos;
- repetição de linhas de tabela;
- conversor remoto autenticado por identity token, com fallback local;
- imagem Gotenberg fixa por digest, Carlito nas quatro faces e verificação de
  Fontconfig;
- canário estrutural dos modelos: páginas, papel, orientação, fontes, âncoras,
  cortes, páginas vazias e área segura.

### Timbrado, compositor e integridade

- faixa superior encostada no topo e marca inferior padronizada;
- duas bandas inferiores reservadas: marca e rastreabilidade;
- manifesto genérico para admissão, recibo, uniforme e documento avulso;
- rodapé rastreável aplicado como sobreposição no PDF;
- `contentHash`, `artifactHash`, `packageHash` e `signedHash`;
- hashes do DOCX, PDF individual, relatório do provedor e cadeia de eventos;
- protocolo humano e índice de páginas do artefato pré-assinatura;
- `pdfProfile` e versões do compositor/timbrado no manifesto;
- componentes avulsos e componentes de pacote usam o mesmo compositor.

### Auditoria e ciclo de vida

- estados de rascunho, conferência, aprovação, finalização, substituição,
  cancelamento e descarte;
- estados de assinatura incluindo recusa, expiração e cancelamento;
- mapa protegido dos valores resolvidos, com valores renderizados, origem,
  formatador, versão do formatador e versão do catálogo;
- dados sensíveis excluídos de logs comuns e `rawValue` omitido quando não é
  necessário;
- registro principal guarda somente dados operacionais mascarados e o hash;
- limite para impedir auditorias excessivamente grandes.
- tela protegida para consultar protocolo, hash, origem, formatador e valor
  efetivamente renderizado.

### Retenção

- políticas versionadas e âncoras por geração, fim do vínculo, fim do tratamento,
  revogação, expiração ou evento manual;
- `retentionUntil` nulo enquanto uma âncora futura não existe;
- cálculo em lote no desligamento;
- reconciliação de colaboradores desligados com retenção ainda não calculada;
- `legalHold` previsto na estrutura.

O descarte automático não está ativo. As políticas estão
`pending_legal`, portanto nenhum documento será apagado com prazo não aprovado.

### Consentimento de imagem e voz

- solicitação e assinatura independentes do pacote admissional;
- estados concedido, negado e revogado;
- versão e hash do termo, canal e evidência da decisão;
- inventário de usos e bloqueio de novas publicações após revogação;
- tarefa/estado de efeito operacional e registro da retirada de cada uso;
- preservação da manifestação histórica.
- tela operacional no perfil do colaborador para registrar publicações e
  confirmar a retirada de cada uso.

### Vale-transporte

- solicitação e declaração de não utilização como modelos distintos;
- decisão canônica com versão e data de eficácia;
- alteração legítima cria novo protocolo e substitui, sem apagar, o documento
  anterior;
- idempotência inclui versão, data e modalidade.
- alterações posteriores podem ser enviadas como documento avulso pela tela de
  documentos gerados e são arquivadas no dossiê após o webhook da assinatura.

### Pacote admissional e Autentique

- documentos de escopo `bundle` são consolidados em uma única solicitação;
- consentimento de imagem e voz segue por solicitação independente;
- termo de encerramento criado por último com componentes e páginas reais;
- manifesto e PDF pré-assinatura ficam arquivados;
- webhook é o caminho primário e reconciliação por consulta é a segurança;
- um PDF assinado pode representar todos os documentos lógicos do pacote;
- hash pré-assinatura, hash assinado, ID da Autentique, relatório e evento de
  conclusão ficam registrados.

## Modelos

### Publicados tecnicamente

- papel timbrado em branco;
- documentos de movimentação de uniformes;
- recibo guiado por schema.

### Implementados, mas em `draft`

- contrato de experiência;
- banco de horas;
- termo LGPD;
- consentimento de imagem e voz;
- metas e prêmios;
- solicitação de vale-transporte;
- declaração de não utilização de vale-transporte;
- confidencialidade;
- ponto eletrônico;
- termo de encerramento.

O estado `draft` é a barreira de go-live, não falta de parametrização.

## Configuração operacional

### Conversor

- `DOCX_TO_PDF_URL`: URL privada do Cloud Run;
- `DOCX_TO_PDF_AUDIENCE`: audiência usada para gerar o identity token.

### Reconciliação de retenção

- `DOCUMENT_RETENTION_RECONCILIATION_SECRET`: bearer token do job
  `/api/jobs/documents/retention-reconcile`.

### Construtor com IA

Requer a configuração de IA já utilizada pelos fluxos Genkit da aplicação. O
construtor continua bloqueado caso a inspeção local detecte dados pessoais.

## Validação antes do go-live

Executar:

```bash
npm run typecheck
npm run test:unit
npm run build
npm run validate:documents
```

Validação local de 28/07/2026: 11/11 modelos convertidos, todos em A4, todas as
fontes incorporadas e todos dentro da área segura. O fallback do LibreOffice usa
perfil isolado por conversão para não compartilhar locks nem estado de falha.

Depois da implantação do Gotenberg:

```bash
export DOCX_TO_PDF_URL="https://URL-DO-SERVICO"
export DOCUMENT_CANARY_ID_TOKEN="$(gcloud auth print-identity-token)"
npm run validate:document-canary
```

## Dependências externas ainda abertas

| Decisão/ação | Responsável | Efeito |
|---|---|---|
| Autorizar e implantar o Gotenberg no projeto Google | Infraestrutura | Libera canário remoto e URL de produção |
| Aceitar Carlito ou fornecer licença de Calibri para servidor | RH/marca | Homologação visual |
| Revisar textos e assinatura única | Jurídico | Permite publicar admissionais |
| Definir prazos por classe documental | Jurídico | Permite aprovar políticas e ativar descarte |
| Definir tratamento de RPA para prestador PF | Contabilidade | Permite ampliar o recibo para esse caso |
| Decidir exigência de PDF/A | Jurídico | Define perfil arquivístico; não bloqueia go-live |
| Homologar pacote real na Autentique | RH/jurídico | Autoriza uso operacional |

Nenhuma dessas pendências deve ser resolvida pelo código por presunção. Em
especial, modelos admissionais não devem ser marcados como `published`, e o
expurgo não deve ser ativado, sem as aprovações correspondentes.
