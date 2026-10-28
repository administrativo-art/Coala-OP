# Contextos de unidade do colaborador

Use este mapa ao alterar cadastro, escala, ponto, metas, permissões ou fechamento. A palavra “unidade” sozinha não identifica o dado necessário.

| Contexto | Fonte | Uso | Não determina |
| --- | --- | --- | --- |
| Principal financeira | `users.unitId` no cadastro; referência financeira histórica quando aplicável | Lotação e custos | Onde a pessoa pode ser escalada ou registrar ponto por si só |
| Escala e operação | `users.unitIds` (e identificadores operacionais equivalentes, quando previstos no fluxo) | Unidades habituais em que a pessoa atua; classificação de turno regular e busca de cobertura | CNPJ empregador, escopo de visualização ou unidade da batida em outro local |
| Escopo de visualização | Configuração de acesso e permissões do usuário | Quais dados e ações o perfil pode consultar | Lotação, escala ou autorização para bater ponto |
| Execução do turno | `dp_schedules.unitId` e `shifts.unitId` | Local escalado em uma data; cobertura externa exige motivo e permissão `dp.schedules.assignExternal` | Alteração automática da lotação ou do empregador |
| Execução da batida | `executionUnitId` validado pelo servidor contra o vínculo histórico ou cobertura escalada | Local e fuso do registro; endereço no comprovante | `employerUnitId`, CNPJ, NSR ou hora fiscal informados pelo aparelho |
| Empregador fiscal | Revisão histórica do vínculo (`employerUnitId` e CNPJ) | Estabelecimento REP-P, ARP e documentos fiscais | Unidade operacional em que ocorreu cada turno |

Na escala do DP, a lista diária de pessoas sem turno usa apenas os vínculos operacionais habituais (`users.unitIds` e quiosques atribuídos). Um turno ou DSR de cobertura aparece na data do lançamento, mas não inclui a pessoa nessa lista durante todo o mês. O cartão da cobertura identifica a unidade de origem quando registrada; para membros da equipe sem lançamento, o rótulo é “Sem turno neste dia”.

## Percurso obrigatório de investigação

1. Parta do cadastro e confirme `unitId`, `unitIds`, escopo de visualização e revisão histórica do vínculo na data.
2. Siga a escala: unidade do calendário, turno da pessoa, cobertura externa, origem operacional, motivo, edição e permissão do DP.
3. Siga as opções de ponto, a unidade escolhida no web/Android, autorização offline, marcação e replay no servidor.
4. Confira o que o original e o comprovante congelam: unidade de execução, endereço, fuso, empregador e CNPJ. Teste turno noturno, alteração posterior da escala e ausência de endereço.
5. Para metas, banco e fechamento, confira separadamente se a cobertura conta ou não e qual unidade fornece a regra aplicável.

**Exemplo:** Luis tem Tirirical como referência financeira e pode atuar em duas unidades operacionais. Em 28/10, um turno no CD/Matriz é uma autorização de execução para aquela data; a batida no CD/Matriz preserva o empregador histórico. A tela de busca deve mostrar as unidades de escala e operação, sem chamar a referência financeira de “origem”.

**Limite da verificação:** os campos atuais e as relações acima foram rastreados no código desta candidata. O teste local de cobertura offline editada após o preparo e a conferência física no Galaxy são gates separados da publicação integral.
