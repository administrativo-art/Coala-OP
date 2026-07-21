# Contrato de reprodução do modelo MedClinic v2

## Referência

- Caminho: `docs/modelos-documentos/aso/medclinc/guia-encaminhamento-medclinic-v2.docx`
- SHA-256: `bfdb844b25e018c8e78342c38b435f304becb1cdd38b27c1e10d80f23672133a`
- Páginas: 1
- Seções: 1
- Render de inspeção: Quick Look do macOS, uma página, 1800 px de largura.

## Sistema de página

- Carta retrato: 12240 × 15840 DXA.
- Margens OOXML: superior 500, inferior 500, esquerda 1080 e direita 1080 DXA.
- Cabeçalho e rodapé: 708 DXA.
- Cor principal: azul `#1F6FB2`.
- Cor secundária: azul-acinzentado aproximado `#5C7182`.

## Componentes preservados

- Cabeçalho horizontal: marca MedClinic+ à esquerda e endereço/telefones à direita.
- Papel timbrado institucional: marca oficial Coala Shakes no canto inferior direito, extraída sem alteração do modelo canônico `papel-timbrado-coala-shakes-v1.docx`.
- Asset utilizado: `src/features/hr/aso/assets/coala-shakes-letterhead-v1.png`, SHA-256 `9b21a9edde481b56b339b022ea6ff88997998bebe8a223126d99b9515cdfcd87`.
- Título azul centralizado e subtítulo cinza.
- Seis blocos numerados com rótulo branco em tarja azul.
- Tabelas com contorno preto e separação explícita entre células.
- Grade de exames em duas colunas.
- Bloco separado para encaminhamentos/RAC.
- Instruções e autorização no último bloco.

## Slots variáveis

| Slot | Fonte | Regra |
|---|---|---|
| Empresa | `onboardingProcesses.employerUnitName` | Snapshot da escolha do RH |
| CNPJ | `onboardingProcesses.employerCnpj` | Obrigatório, válido e formatado |
| Forma de pagamento | Constante | `PIX` |
| Nome | `publicFormAnswers.fullName` | Fallback para `candidateName` |
| CPF | `publicFormAnswers.cpf` | Obrigatório para gerar |
| Setor | Constante | `GERAL` |
| Função | `functionName` | Fallback para `jobRoleName` |
| Data do atendimento | Retorno da clínica | `A DEFINIR PELA CLÍNICA` antes da confirmação |
| Observações | Fluxo do ASO | Vazio quando não informado |

## Fidelidade e auditoria

- O DOCX de referência deve permanecer byte a byte inalterado.
- A identidade da MedClinic permanece no cabeçalho; a marca Coala identifica a empresa emissora no rodapé.
- `Admissional` e `Exames conforme o PCMSO` são as únicas opções previamente marcadas.
- Cada PDF é uma nova versão; nunca substituir nem apagar uma geração auditada.
- Registrar SHA-256, versão `medclinic-v2`, CNPJ, data e responsável pela geração.
