# Kit de documentos admissionais

## Estado desta versão

Os nove modelos originais fornecidos pela operação em 20/07/2026 estão preservados nesta pasta, sem alterações de conteúdo ou formatação. Esta é a fonte documental para a adaptação do fluxo de geração e assinatura.

- Categoria funcional: **Informações admissionais**
- Versão do kit: **1.0**
- Formato editável: **DOCX**
- Formato oficial para assinatura e auditoria: **um único PDF consolidado**
- Estado operacional: **modelos arquivados; publicação e consolidação ainda não implantadas**

## Inventário e integridade

| Ordem | Arquivo | SHA-256 |
|---:|---|---|
| 1 | `01-contrato-experiencia-v1.docx` | `935fbe335a50349a389a61a537c9f20570da5ac26d8a3e437506b5d91734bc12` |
| 2 | `02-banco-horas-v1.docx` | `f8310fabb8da2c9a102eb1d93d37ccf748a6d8ae5580f32d16693c058c13aaa1` |
| 3 | `03-termo-lgpd-v1.docx` | `9a2d03b2c6303af1801dbb32511ee865496216ad5994e3e81ba8ee1416a89587` |
| 4 | `04-imagem-voz-v1.docx` | `8c3a5883b1d413b310be6095a05a48d88b0e824c0124390d2d033afa5ee6fcce` |
| 5 | `05-metas-premios-v1.docx` | `ef6ebf77cdf7cf079fa01395dd7c826190e23a73be277ffeccf5d5fb79c078b0` |
| 6 | `06-vale-transporte-v1.docx` | `da7c9f8b849a6a42e989ffc3e2ec71bb945670aaa114cc43fcb3188568373395` |
| 7 | `07-confidencialidade-v1.docx` | `01f6f0536f72869fd4decd6ebad73a8a214341db32bd38a4184c927a5e6189fa` |
| 8 | `08-ponto-eletronico-v1.docx` | `cf3b4baecba1e12932cb1513e09b78a0448cbc6beaf5021e9d8f430b2e30f1e2` |
| 9 | `09-termo-encerramento-v1.docx` | `e63f92bc5a8769952f0bb3cc713466bb55463a065bc5f6d397488d276d03365b` |

O arquivo `kit-manifest.json` registra a ordem, os identificadores estáveis e o comportamento esperado de cada componente.

## Campos encontrados nos modelos

| Campo atual | Significado esperado | Origem futura |
|---|---|---|
| `custom_field_15914645` | Nome completo do colaborador | formulário de admissão |
| `custom_field_15874630` | Número da CTPS | formulário ou documento validado |
| `custom_field_15874638` | Série da CTPS | formulário ou documento validado |
| `custom_field_15874657` | Remuneração mensal | cargo/função da integração |
| `contract_start` | Data de admissão | integração |
| `custom_field_15914630` | Término dos primeiros 45 dias | cálculo do sistema |
| `custom_field_15914631` | Término final de 90 dias | cálculo do sistema |
| `CAMPO_CPF_DO_TITULAR` | CPF do colaborador | formulário ou documento validado |
| `CAMPO_DATA_PUBLICACAO_TERMO` | Vigência da versão do termo LGPD | versão do modelo |
| `custom_field_15874601` | Opção de vale-transporte | resposta do candidato |
| `CAMPO_ENDERECO_RESIDENCIAL` | Endereço residencial | formulário ou comprovante validado |
| `CAMPO_OPCAO_IMAGEM_VOZ` | Marcação da autorização de imagem e voz | consentimento explícito salvo no processo |

Antes da publicação, os nomes legados devem ser mapeados para o catálogo de variáveis do Coala. Não se deve preencher esses campos por substituição textual fora do gerador de DOCX.

## Ajustes obrigatórios antes da publicação

1. **Empresa dinâmica.** Razão social, CNPJ e endereço estão fixos como CT Sorvetes Ltda. Devem usar o CNPJ responsável escolhido pelo RH na criação da integração e preservar um snapshot dos dados usados.
2. **Função dinâmica.** O contrato de experiência fixa a função como `ATENDENTE`. Deve utilizar cargo/função da integração.
3. **Assinatura única.** Os oito documentos possuem blocos individuais de assinatura. Na versão operacional consolidada, esses blocos devem ser retirados ou transformados em identificação das partes; os únicos campos de assinatura devem ficar no termo de encerramento.
4. **Lista dinâmica.** O termo de encerramento atualmente lista sempre os oito documentos. A lista e a numeração devem refletir exatamente os modelos selecionados pelo RH.
5. **Consentimento de imagem e voz.** A marcação deve reproduzir o booleano explícito já respondido pelo candidato. O RH não pode alterar a resposta ao montar o kit. A versão do termo, data da resposta e metadados de auditoria continuam preservados separadamente.
6. **Vale-transporte.** A redação e a opção exibida devem corresponder à resposta validada do candidato.
7. **Campos de página.** Os modelos possuem `PAGE` e `NUMPAGES`. Depois da consolidação, a paginação deve ser recalculada para o PDF completo.
8. **Papel timbrado.** Os arquivos recebidos não contêm a logo como mídia incorporada. A versão operacional deve aplicar o papel timbrado oficial sem alterar os originais desta pasta.

## Fluxo recomendado de geração e assinatura

1. O RH acessa a etapa **Geração dos documentos admissionais**.
2. O sistema exibe os oito modelos selecionáveis, com nome, versão, campos pendentes e indicação de que serão abrangidos pela assinatura final.
3. O RH marca os documentos que deseja gerar. O termo de encerramento não é selecionável e é sempre acrescentado ao final.
4. O sistema popula cada DOCX e disponibiliza a versão editável para download.
5. Se houver edição manual, o RH envia novamente o DOCX alterado. A versão original e a alterada permanecem no histórico.
6. O sistema converte cada documento aprovado em PDF, mantém a ordem do manifesto e produz o termo final com a lista efetivamente selecionada.
7. Todos os PDFs são consolidados em um único arquivo. O RH visualiza, audita e valida o pacote completo.
8. Após a validação, o pacote é bloqueado por hash e enviado como **um único documento** ao provedor de assinatura.
9. O candidato assina uma vez no termo final. Se a empresa também for signatária, cada parte assina uma vez no mesmo termo.
10. O PDF assinado e o relatório do provedor são arquivados. Cada documento lógico do perfil aponta para o mesmo pacote e exibe `Incluído no kit assinado`.

## Auditoria mínima do pacote

O registro do pacote deve preservar:

- identificador do processo e do colaborador;
- modelos selecionados, ordem e versão de cada modelo;
- hash dos DOCX gerados e dos DOCX eventualmente reenviados pelo RH;
- hash de cada PDF intermediário;
- hash do PDF consolidado antes da assinatura;
- decisão de imagem e voz registrada separadamente;
- usuário e data de geração, edição, revisão e aprovação;
- identificador da solicitação no provedor;
- hash do PDF assinado e relatório de assinatura;
- vínculo entre o pacote assinado e cada documento lógico do colaborador.

## Impacto no código atual

O sistema já permite selecionar modelos e gerar DOCX individualmente. Porém, o envio atual percorre cada documento aprovado e cria uma solicitação separada no Autentique. Para atender este kit, a etapa precisa passar a criar um registro de pacote, consolidar os PDFs aprovados e realizar apenas uma solicitação de assinatura para o PDF final.

Essa mudança não deve reaproveitar o estado `assinado` de um componente isolado. O indicador de cada documento somente muda para assinado quando o pacote completo assinado for recebido, validado e arquivado.

## Validação jurídica

A assinatura eletrônica deve preservar autoria, integridade e aceitação pelas partes. A adoção de uma única assinatura ao final de um PDF consolidado deve ser validada pelo jurídico trabalhista, especialmente quanto à redação do termo de encerramento e aos poderes do signatário da empresa.
