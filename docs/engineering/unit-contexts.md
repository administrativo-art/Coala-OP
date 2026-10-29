# Contextos de unidade do colaborador

Use este mapa ao alterar cadastro, escala, ponto, metas, permissões ou fechamento. A palavra “unidade” sozinha não identifica o dado necessário.

| Contexto | Fonte | Uso | Não determina |
| --- | --- | --- | --- |
| Principal financeira | `users.unitId` no cadastro; referência financeira histórica quando aplicável | Lotação e custos | Onde a pessoa pode ser escalada ou registrar ponto por si só |
| Escala e operação | `users.operationalUnitPeriods` resolvido na data; `users.unitIds` é projeção para consumidores legados | Unidades habituais em que a pessoa atua; classificação de turno regular e busca de cobertura | CNPJ empregador, escopo de visualização ou unidade da batida em outro local |
| Escopo de visualização | Configuração de acesso e permissões do usuário | Quais dados e ações o perfil pode consultar | Lotação, escala ou autorização para bater ponto |
| Execução do turno | `dp_schedules.unitId` e `shifts.unitId` | Local escalado em uma data; cobertura externa exige motivo e permissão `dp.schedules.assignExternal` | Alteração automática da lotação ou do empregador |
| Execução da batida | `executionUnitId` validado pelo servidor contra o vínculo histórico ou cobertura escalada | Local e fuso do registro; endereço no comprovante | `employerUnitId`, CNPJ, NSR ou hora fiscal informados pelo aparelho |
| Empregador fiscal | Revisão histórica do vínculo (`employerUnitId` e CNPJ) | Estabelecimento REP-P, ARP e documentos fiscais | Unidade operacional em que ocorreu cada turno |

Na escala do DP, a lista diária usa a vigência operacional da data. Apenas pessoas sem esse campo mantêm a união legada de unidades e quiosques. Depois da inicialização, quiosque atribuído não acrescenta unidade habitual. Cobertura externa aparece na data do turno e não muda a lotação financeira nem o empregador.

## Percurso obrigatório de investigação

1. Parta do cadastro e confirme `unitId`, `unitIds`, escopo de visualização e revisão histórica do vínculo na data.
2. Siga a escala: unidade do calendário, turno da pessoa, cobertura externa, origem operacional, motivo, edição e permissão do DP.
3. Siga as opções de ponto, a unidade escolhida no web/Android, autorização offline, marcação e replay no servidor.
4. Confira o que o original e o comprovante congelam: unidade de execução, endereço, fuso, empregador e CNPJ. Teste turno noturno, alteração posterior da escala e ausência de endereço.
5. Para metas, banco e fechamento, confira separadamente se a cobertura conta ou não e qual unidade fornece a regra aplicável.

**Regra confirmada pelo responsável em 28/10/2026:** Luís atua habitualmente em Tirirical e CD/Matriz; a financeira e a empregadora são Tirirical. A tela anterior já mostrava ambas por unir quiosques atribuídos e unidades gravadas, enquanto o ponto lia uma referência separada. A correção centraliza as unidades em `users.operationalUnitPeriods`, editado em **Editar colaborador → Unidades**. Não exige repetir essas unidades na antiga revisão contratual.

A primeira vigência exige início confirmado e termina em aberto. A seguinte fecha a anterior na véspera. Não adotar automaticamente admissão, primeiro turno ou 22/10 (início de um ensaio nominal) como prova do início real. Pessoas fora da escala/ponto podem ficar sem vigência. Nenhum dado real foi migrado nesta implementação.

O REP-P continua exigindo uma referência fiscal válida de empregador; a resolução normal sobrepõe as unidades canônicas por data, com snapshot/hash preservado em novas autorizações e marcações. Revisão explicitamente solicitada permanece original e imutável. Datas anteriores ao corte inicial mantêm a referência legada; lacunas posteriores não recebem fallback. Replay offline usa a unidade congelada na autorização válida, inclusive autorizações legadas sem o novo metadado, mantendo autenticação, dispositivo, assinatura, sequência e validade.

`users.unitIds` e RH são projeções reconciliadas por job limitado. A vigência não move nem clona acesso PDV: atribuições de quiosque continuam separadas. Dados contratuais são editados em Identificação com motivo/data e apresentados apenas para consulta no perfil. Ver [pessoas e acesso](flows/people-access.md).

Quando a pessoa trabalha excepcionalmente fora das unidades operacionais, o turno precisa ser uma cobertura externa válida, com origem operacional, motivo e autorização do DP. O painel e o app mostram “Você foi escalado excepcionalmente para [unidade] nesta data.” somente quando a escala vigente registra `assignmentKind: external_coverage` e a unidade foi liberada nas opções de ponto. O aviso não se aplica a um turno regular em unidade operacional habitual.

**Verificação local:** testes de integração em emulador cobrem vigência por data, revisão explícita e replay offline após mudança. Isso não confirma datas reais nem substitui homologação fiscal/jurídica.

Na edição, financeira vazia não é preenchida pela primeira unidade operacional. A inicialização legada da admissão mantém sua compatibilidade explícita. Se um período contratual aplicado remove financeira ou empregadora, a resolução fiscal fica inconsistente e exige conferência; não reutiliza silenciosamente o dado histórico anterior.

Ajuste de interface em 28/10/2026: todos os seletores de unidade ficam exclusivamente na aba Unidades. O quadro Como ler esta tela foi removido; cada tipo tem ícone InfoPopover com ajuda por clique/toque. Financeira e empregadora continuam sendo dados contratuais auditados; a justificativa fica disponível também na aba Unidades, sem mudar fontes ou regras. Gestores de usuários preservam acesso à aba mesmo sem visualização DP.
