# Contrato de reprodução do modelo MedClinc v1

## Referência

- Caminho: `docs/modelos-documentos/aso/medclinc/guia-encaminhamento-medclinc-v1.docx`
- SHA-256: `4c18e8d8fd125a26ad392acae721f37682e18fcf40f1b121cc4ed35ea05a8383`
- Páginas: 1
- Seções: 1
- Render de inspeção: Quick Look do macOS, uma página, 1600 px de largura.

## Sistema de página

- A4 retrato: 11910 × 16840 DXA.
- Margens OOXML: superior 80, inferior 280, esquerda 260 e direita 280 DXA.
- Cabeçalho/rodapé: 360 DXA.
- O conteúdo ocupa uma única página; não pode haver quebra para uma segunda página.

## Elementos preservados

- Marca MedClinc centralizada no topo, em baixa opacidade.
- Endereço e telefones centralizados.
- Títulos “GUIA DE ENCAMINHAMENTO” e “( Autorização de exames )”.
- Bloco de identificação em duas colunas.
- Seções “TIPO DE EXAME”, “EXAMES” e “ENCAMINHADO PARA”.
- Grade de exames em três colunas.
- Nota de jejum e campo “AUTORIZADO POR” no rodapé.

## Slots variáveis

| Slot | Fonte | Regra |
|---|---|---|
| Empresa | `onboardingProcesses.employerUnitName` | Snapshot da escolha do RH |
| CNPJ | `onboardingProcesses.employerCnpj` | Obrigatório, válido e formatado |
| Nome | `publicFormAnswers.fullName` | Fallback para `candidateName` |
| CPF | `publicFormAnswers.cpf` | Obrigatório para gerar |
| Função | `functionName` | Fallback para `jobRoleName` |
| Atendimento | Retorno da clínica | “A definir pela clínica” antes da confirmação |
| Observações | Fluxo do ASO | Vazio quando não informado |

## Fidelidade e auditoria

- O DOCX de referência deve permanecer byte a byte inalterado.
- “Admissional” e “Exames conforme o PCMSO” são as únicas opções previamente marcadas.
- “PIX” e “Geral” são valores fixos desta versão.
- Cada PDF é uma nova versão; nunca substituir nem apagar uma geração anterior.
- Registrar SHA-256, versão do modelo, CNPJ, data e responsável pela geração.
