# Catálogo de nomenclatura financeira

## Finalidade

Este catálogo é a fonte canônica para descrições de despesas e movimentações auditadas. A descrição original do banco deve permanecer preservada em `rawBankDescription`; a descrição abaixo é a versão tratada exibida na auditoria, nas despesas e nos relatórios.

| Natureza | Padrão |
| --- | --- |
| Internet | `Internet - Unidade \| Favorecido` |
| Sistema de RH | `Sistema RH - Bizneo` |
| Plano odontológico | `Plano odontológico - Odontoprev \| Vinculado` |
| Aluguel | `Aluguel - Unidade \| Favorecido` |
| Honorário contábil | `Honorário contábil - Unidade \| Favorecido` |
| DAS | `DAS - Única - MM/AAAA` |
| Salário | `Salário - MM/AAAA \| Colaborador` |
| Empréstimo consignado, linha analítica | `Empréstimo consignado - MM/AAAA \| Colaborador` |
| FGTS com consignado | `FGTS - MM/AAAA \| FGTS + empréstimo consignado` |
| FGTS sem consignado | `FGTS - MM/AAAA \| FGTS` |
| Carrinho do Shopping | `Compra do carrinho - Shopping do Automóvel` |
| GPT/Codex | `GPT/Codex \| Favorecido` |

## Regras complementares

- `Administrativo`, `João Paulo`, `Tirirical` e `Shopping do Automóvel` são os nomes curtos usados na descrição; o identificador e o nome completo do centro continuam preservados no cadastro.
- O aluguel e o condomínio do Shopping do Automóvel formam um único título de aluguel; a separação ocorre nas contas contábeis internas.
- O plano odontológico é um único pagamento e mantém a individualização por colaborador.
- O FGTS Digital é um único pagamento. Quando houver consignado, é desmembrado entre `FGTS` e `Empréstimos consignados a recolher`, e depois individualizado por colaborador, contrato e centro de resultado.
- FGTS é custo do empregador e integra a DRE. Consignado é desconto do colaborador, fica em conta patrimonial e não cria nova despesa na DRE.
- Quando a Heucilene estiver vinculada à folha ou a encargos, os valores são rateados igualmente entre João Paulo, Tirirical e Shopping do Automóvel, com ajuste de centavos para fechar o total.
- Provisões usam a mesma descrição canônica do documento real. A distinção é interna, por `provisionType`, estado de conciliação, série e competência; não haverá prefixo visível no título.
- O sistema e o assistente nunca autorizam o pagamento bancário. A autorização final continua exclusiva do usuário no aplicativo do Banco Inter.

## Implementação

Os formatadores determinísticos ficam em `src/features/financial/lib/expense-description-catalog.ts`. Regras de identificação por extrato ou documento podem sugerir um padrão, mas conta, unidade, pessoa, valor e conciliação precisam passar pelas validações do respectivo módulo.
