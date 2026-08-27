# Contrato de execução — piloto do contrato de experiência

## Referência

- Arquivo imutável: `/Users/imated/Coala Sistemas/Coala-OP/docs/modelos-documentos/admissionais/01-contrato-experiencia-v1.docx`
- SHA-256: `935fbe335a50349a389a61a537c9f20570da5ac26d8a3e437506b5d91734bc12`
- Páginas renderizadas: 3
- Seções: 1
- Render de referência: `tmp/document-pilot-probation/reference-render`
- Evidências: `tmp/document-pilot-probation/evidence`

## Sistema de página

- A4 retrato: 8,27 × 11,69 pol.
- Margens: esquerda 1,11 pol.; direita 1,11 pol.; superior 1,00 pol.; inferior 1,00 pol.
- Uma seção iniciada em nova página.
- Cabeçalho e rodapé próprios, sem vínculo com seção anterior.
- Sem primeira página diferente e sem páginas pares/ímpares diferentes.
- Cabeçalho: contador `Página PAGE de NUMPAGES`, alinhado à direita.
- Rodapé: identificação do contrato e empregadora, alinhado à esquerda.

## Tipografia e fluxo

- Família predominante: Calibri.
- Título centralizado, em caixa alta e negrito.
- Corpo justificado, com cláusulas numeradas e recuo suspenso.
- Ênfases jurídicas existentes em negrito devem permanecer nos mesmos runs.
- Página 1: título, qualificação das partes e cláusulas 1 a 5.
- Página 2: continuação da cláusula 5 e cláusulas 6 a 11.
- Página 3: continuação da cláusula 11, cláusula 12, encerramento e assinaturas.
- Não há imagens incorporadas.
- O documento possui comentários e partes de notas; todos são preservação obrigatória.

## Slots editáveis

| Parte | Local estável | Conteúdo atual | Destino |
|---|---|---|---|
| Corpo | `word/document.xml`, qualificação inicial | CT SORVETES LTDA | `integration.employer_name` |
| Corpo | `word/document.xml`, qualificação inicial | 14.276.603/0001-25 | `integration.employer_cnpj` |
| Corpo | `word/document.xml`, qualificação inicial | endereço da CT Sorvetes | `integration.employer_address` |
| Corpo | `word/document.xml`, qualificação inicial e assinatura | `custom_field_15914645` | `employee.name` |
| Corpo | `word/document.xml`, qualificação inicial | `custom_field_15874630` | `employee.ctps_number` |
| Corpo | `word/document.xml`, qualificação inicial | `custom_field_15874638` | `employee.ctps_series` |
| Corpo | `word/document.xml`, cláusula 1 | ATENDENTE | `integration.job_function` |
| Corpo | `word/document.xml`, cláusula 1 | `custom_field_15874657` | `contract_monthly_salary`, mapeado com moeda por extenso |
| Corpo | `word/document.xml`, cláusula 7 | `contract_start` | `contract_start_long`, data por extenso |
| Corpo | `word/document.xml`, cláusula 7 | `custom_field_15914630` | `contract_first_end_long`, data por extenso |
| Corpo | `word/document.xml`, cláusula 7 | `custom_field_15914631` | `contract_final_end_long`, data por extenso |
| Corpo | `word/document.xml`, assinatura | CT SORVETES LTDA | `integration.employer_name` |
| Rodapé | `word/footer1.xml` | CT Sorvetes Ltda | `integration.employer_name` |

## Preservação do pacote

- Editáveis: somente os nós `w:t` que contêm os slots acima em `word/document.xml` e `word/footer1.xml`.
- Preservação obrigatória: estilos, numeração, configurações, cabeçalho, comentários, notas, relacionamentos, tipos de conteúdo, propriedades, fontes e quaisquer partes opacas.
- Os campos `PAGE` e `NUMPAGES` não serão alterados.
- A fonte v1 deve continuar byte a byte idêntica ao hash registrado.

## Gates de fidelidade

- Mesma seção, tamanho de página e margens.
- Mesmos estilos, numeração, cabeçalho, linhas de assinatura e comentários.
- Nenhum placeholder pode atravessar parágrafos.
- O modelo preparado deve renderizar em três páginas antes do preenchimento.
- A amostra preenchida pode mudar a quebra de linhas, mas não pode produzir sobreposição, corte ou invasão da área segura do timbrado.
- Todos os valores obrigatórios devem ser resolvidos antes da aprovação.
