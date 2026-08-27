# Especificação técnica do papel timbrado v1

## Referência

- Arquivo canônico: `papel-timbrado-coala-shakes-v1.docx`
- SHA-256 do DOCX: `38c078bf2a52625b4f3956ba1c81cdd403565219d8c9b996b511b0c66ec574ec`
- Páginas verificadas: 1
- Seções: 1
- Pré-visualização usada na conferência: Quick Look do macOS, 1284 × 1800 px

## Sistema de página

- Formato: A4 retrato (`11909 × 16834` twips).
- Margem superior: aproximadamente 20 mm (`1133,858` twips).
- Margem inferior: aproximadamente 29,6 mm (`1678,110` twips).
- Margens esquerda e direita: 25,4 mm (`1440` twips).
- Distância do cabeçalho e rodapé: 12,7 mm (`720` twips).
- Numeração de páginas iniciada em 1, sem campo de número visível no modelo.
- Cabeçalho de primeira página e rodapés padrão/primeira página existem, mas não possuem conteúdo visual.

## Marca

- Imagem: `word/media/image1.png`.
- Relacionamento: `rId6` em `word/_rels/document.xml.rels`.
- Localizador: primeiro parágrafo de `word/document.xml`, desenho `wp:anchor`.
- Tamanho renderizado: aproximadamente 33,1 × 32,8 mm.
- Posicionamento: canto inferior direito, atrás do conteúdo (`behindDoc="1"`).
- A marca está ancorada no corpo da primeira página; não deve ser movida ou reconstruída ao criar documentos derivados.

## Slots e fluxo de conteúdo

- O documento não possui texto, tabelas, campos ou controles de conteúdo preexistentes.
- O único slot editável é a área central livre do corpo.
- Cabeçalhos, rodapés, relacionamentos, imagem, tema, estilos, numeração e geometria da seção são estruturas de preservação obrigatória.
- Novos conteúdos devem ser inseridos em uma cópia do arquivo canônico, sem substituir o parágrafo que ancora a marca.

## Inventário de preservação

| Parte | SHA-256 |
|---|---|
| `[Content_Types].xml` | `43693f77d833632a242da408411761b0df294fccb222194009d602a3a21f5fed` |
| `_rels/.rels` | `1cc87395d4a229f21c23af406724de12dd9454071925f983e4b648a7b2be8cc5` |
| `word/_rels/document.xml.rels` | `c40c787785a215d210411b28fc7db09fb1e981a6cf2dcc43b4866a0d9331046f` |
| `word/document.xml` | `8d02be41db51e96ec9f7e42a9e2cb5846f3f34a3fc8b8b375fedd9bd6b434ed9` |
| `word/fontTable.xml` | `36fed3e4e54487b04ca9ec16627dc50266bbec0cafcc3b31edd456423b10504a` |
| `word/footer1.xml` | `9972a1903b8263a31096c9a60a238ea35e7e6892c263584cd2426dde5cecf3c3` |
| `word/footer2.xml` | `c39858c831bb713ab6e1bb62c4c20e8cfd5356a15269874e4ba9aa72eb887927` |
| `word/header1.xml` | `a940ca869daa41a0f5af2ca8c280d2ae7bcfab17f10860edd46b03335a8a8327` |
| `word/media/image1.png` | `9b21a9edde481b56b339b022ea6ff88997998bebe8a223126d99b9515cdfcd87` |
| `word/numbering.xml` | `d2a3e08465525eee874ea10d780540816951a37b115e90f1cd56aefdd76adc2e` |
| `word/settings.xml` | `26f2853fde05b88d4b0a9da0bb016d56a896901f60c9272dddf33c3f3fa61e4a` |
| `word/styles.xml` | `7fb65cddc4d23c80c3533ed0fe3ae4afce795aa15cb612791716e6f13ae625b1` |
| `word/theme/theme1.xml` | `b2295d3198893d2c03f5e584c749a15751b798aefdcd9bee2889f13903d68cb2` |

## Portões de fidelidade

Antes de disponibilizar um novo modelo documental:

1. confirmar o SHA-256 do arquivo canônico;
2. gerar o documento a partir de uma cópia;
3. comparar geometria de página, relacionamentos e partes de preservação;
4. renderizar o PDF final e inspecionar todas as páginas;
5. confirmar que a marca não sofreu deslocamento, corte, sobreposição ou mudança de cor;
6. preservar o PDF aprovado e o hash utilizado no envio.
