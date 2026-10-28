# Plano — Recesso do estagiário

**Produto:** Coala OP

**Status:** em revisão; nada implementado. O guia de regras de estágio recebido em 28/10/2026 muda o cálculo (ciclos de 12 meses, saldo projetado até o fim do recesso, limite interno de 3 meses) e a trilha (aviso de recesso assinado). Este plano será atualizado depois das decisões P3–P6.

**Última atualização:** 28/10/2026

**Responsável funcional:** RH / DP

**Referência visual:** quadro "7 · Recesso do estagiário" no canvas de Férias (privado).

> Este plano registra decisões de produto tomadas com o RH. Não é parecer jurídico. Pendências marcadas na seção 9 dependem do contador ou do RH e não viram regra no código antes da confirmação.

## 1. Objetivo

Controlar no módulo de Férias o recesso remunerado do estagiário (Lei 11.788/2008, art. 13): quanto ele acumulou, quanto agendou, quanto falta gozar antes do fim do estágio e quem precisa agir.

## 2. Escopo

**Entra:**

- regra de cálculo do recesso (acúmulo, arredondamento, saldo);
- estagiários no Panorama de Férias, com selo, filtro e alerta de fim de estágio;
- página individual do estagiário com "Agendar recesso", vigência e trilha curta;
- validação no servidor de todo agendamento de recesso;
- auditoria no histórico já existente de férias.

**Fica fora (com destino definido):**

| Assunto | Destino |
| --- | --- |
| Desligamento do estagiário e pagamento do saldo não gozado | Plano geral de desligamento de todos os vínculos (a criar). Este plano entrega a função de saldo que ele vai consumir. |
| Termo de compromisso, supervisor, instituição de ensino, seguro e efetivação como CLT | [Plano geral da trilha de admissão](plano-admissao.md). |
| Ponto do estagiário (REP-P, AFD, AEJ) | Decisão registrada em D9; sem mudança agora. |
| Recesso no portal do colaborador | Fase posterior; o portal continua mostrando o que mostra hoje. |

## 3. Situação atual (verificada no código em 28/10/2026)

| Área | Hoje | Onde |
| --- | --- | --- |
| Férias | O Panorama e a página individual só conhecem a regra da CLT. Na `main`, o Panorama lista quem está marcado como operacional; a troca para vínculo CLT ou aprendiz está pronta na branch `fix/vacation-completed-trail`, ainda não publicada. | [`dp-ferias-manager.tsx`](../../src/components/dp/dp-ferias-manager.tsx), [`vacation-logic.ts`](../../src/lib/utils/vacation-logic.ts) |
| Registro de férias | `dp_vacations` aceita `recordType` `gozo` ou `venda`, sempre ligado a um ciclo `AAAA-AAAA`, com trilha de 6 etapas (`workflow`). | [`vacations/schemas.ts`](../../src/features/hr/vacations/schemas.ts), `DPVacationRecordType` em [`types/index.ts`](../../src/types/index.ts) |
| Vigência do estágio | Não há campo de término do termo. Os períodos de vínculo (`dp_employmentReferenceHeads`/`Histories`) guardam tipo de vínculo com `validFrom` e `validTo`, e o servidor já resolve o vínculo numa data. | [`employment-reference/service.server.ts`](../../src/features/dp/employment-reference/service.server.ts), [`resolve.ts`](../../src/features/dp/employment-reference/resolve.ts) |
| Pasta documental | O modelo "Estagiário" já tem a pasta "Recesso". | [`employee-document-folder-templates.ts`](../../src/lib/hr/employee-document-folder-templates.ts) |
| Permissões | Férias usa `canManageVacation` com `view`, `edit` e `approve` no servidor. | [`vacations/server.ts`](../../src/features/hr/vacations/server.ts) |

## 4. Decisões

| # | Decisão | Data |
| --- | --- | --- |
| D1 | O vínculo resolvido na data decide a regra: CLT e aprendiz seguem férias da CLT; estágio segue recesso. Não há campo nem escolha manual. | 28/10/2026 |
| D2 | O recesso acumula 2,5 dias por mês completo de estágio (30 a cada 12 meses), em dias corridos, desde o início do período de estágio. | 28/10/2026 |
| D3 | O proporcional já acumulado pode ser agendado antes de completar 12 meses. | 28/10/2026 |
| D4 | Fracionamento livre, sem número máximo de partes, desde que caiba no saldo e na vigência. | 28/10/2026 |
| D5 | Frações de dia são arredondadas para cima (3 meses = 7,5 → 8 dias). Um ícone de ajuda ao lado do saldo explica a conta e o arredondamento. | 28/10/2026 |
| D6 | Férias escolares são só sugestão na tela; não bloqueiam. | 28/10/2026 |
| D7 | A bolsa segue normal no recesso. Sem 1/3, abono, aviso de 30 dias, contador, recibo ou pagamento. | 28/10/2026 |
| D8 | O saldo não gozado no fim do estágio é tratado no plano geral de desligamento. | 28/10/2026 |
| D9 | Estagiários poderão registrar ponto e entram no AFD e no AEJ. Sem mudança agora; a mudança futura exige revisão de Doc Brown. | 28/10/2026 |
| D10 | O recesso usa as permissões de Férias; não há submódulo nem acesso próprio. O Panorama ganha o filtro "Estagiários". | 28/10/2026 |

## 5. Regras de negócio

| # | Regra |
| --- | --- |
| RN1 | **Meses completos** numa data D = meses inteiros entre o início do período de estágio e D (15/07 → 15/10 = 3 meses). Dias soltos não contam. |
| RN2 | **Acumulado em D** = arredondar para cima (meses completos × 2,5). Nunca passa do total da vigência. |
| RN3 | **Saldo em D** = acumulado em D − dias de recesso aprovados ou pendentes com início até D. Recesso rejeitado ou cancelado não consome saldo. |
| RN4 | **Agendar uma parte** exige: vínculo de estágio vigente na data de início; dias ≤ saldo na data de início (contando as outras partes); fim ≤ término do estágio, quando ele estiver cadastrado; sem sobreposição com outra parte ou ausência. |
| RN5 | Sem término cadastrado no período de estágio, o agendamento é aceito com aviso "Cadastre o fim do estágio para controlar o prazo"; o alerta de fim de estágio fica desligado. |
| RN6 | **Alerta de fim de estágio:** a partir de 60 dias antes do término, com saldo projetado no término > 0, a pessoa recebe prioridade "Agendar antes do fim". |
| RN7 | **Trilha curta:** Agendar (registro criado) → Aprovar (status `APPROVED`) → Em gozo (hoje entre início e fim) → Concluído (fim passou). Rejeitar e cancelar exigem justificativa, como em férias. Em gozo e Concluído são derivados das datas, não gravados. |
| RN8 | **Efetivação como CLT:** recesso com início antes da data do novo período fica no histórico do estágio. As férias da CLT contam a partir do início do período CLT, não da admissão como estagiário. O processo de conversão está no [plano de admissão](plano-admissao.md#22-efetivação-de-estagiário-como-clt-conversão-de-vínculo). |
| RN9 | Registros `gozo` e `venda` são recusados para quem está em estágio na data, e `recesso` é recusado para quem não está. |

## 6. Contrato de dados

- **`dp_vacations`:** novo `recordType: 'recesso'`. Usa `userId`, `startDate`, `endDate`, `days`, `returnDate`, `status` e auditoria já existentes, mais `internshipPeriodStart` (o `validFrom` do período de estágio, que identifica o estágio a que a parte pertence). Não grava `cycleId` de CLT nem `workflow` de 6 etapas.
- **Tipos e schema:** `DPVacationRecordType` passa a `'gozo' | 'venda' | 'recesso'`; o schema de criação vira união discriminada por `recordType`, para que `recesso` não exija `cycleId` nem campos de CLT (abono, 13º, concordância de fracionamento CLT).
- **Função pura** em `src/lib/hr/internship-recess.ts`: `internshipRecessSummary({ periodStart, periodEnd, records, date })` → meses completos, acumulado, agendado, saldo, saldo projetado no término e texto da explicação do ícone. É a única fonte da conta: tela, servidor e o futuro desligamento a chamam.
- **Vigência para o Panorama:** o carregamento de Férias passa a trazer, só para usuários com vínculo de estágio, `{ userId, periodStart, periodEnd }` resolvido pelo servidor. Sem consulta por pessoa no navegador.
- **Auditoria:** reaproveita `dp_vacationEvents` com os tipos atuais de criação, aprovação, rejeição e cancelamento.

## 7. Servidor e permissões

- Criar, editar, aprovar, rejeitar e cancelar recesso passam pelas rotas atuais de férias (`POST /api/dp/vacations`, `PATCH`/`DELETE /api/dp/vacations/{id}`), com o mesmo `secureRoute` e as mesmas permissões (D10).
- Toda gravação resolve o vínculo na data de início pelo serviço de referência de vínculo e aplica RN4 e RN9 na mesma transação que grava o registro e o evento.
- Ações exclusivas da trilha CLT (gerar aviso, contador, recibo, pagamento) recusam registros `recesso` com erro esperado.
- Revisão de permissões antes do commit: nenhuma permissão nova; confirmar que `view`, `edit` e `approve` cobrem as ações do recesso e que chamadas diretas à API respeitam o mesmo controle.

## 8. Interface

- **Panorama:** estagiários na mesma tabela com o selo roxo "Recesso". Colunas: vigência e saldo (acumulados · agendados) no lugar do concessivo; acúmulo "X de 30 dias até o fim do estágio" no lugar do aquisitivo. Prioridades: "Recesso" (em dia) e "Agendar antes do fim" (RN6). Novo chip de filtro "Estagiários".
- **Página individual:** chips de saldo (com ícone explicativo, D5), fim do estágio e próximo acúmulo; botão "Agendar recesso"; linha do tempo da vigência com marcos de 7,5, 15, 22,5 e 30 dias; lista das partes com a trilha curta; lembrete do acordo de fracionamento na pasta "Recesso" quando houver mais de uma parte (D4).
- **Agendar recesso:** início e fim, dias corridos, acumulado na data de início, saldo depois do agendamento, sugestão de férias escolares (D6). Erros de RN4 aparecem junto do campo.
- Padrões de `docs/design/` (PageHero, LiftRow, SidePanel, StatusPill, tokens `ds-*`).

## 9. Pendências a confirmar

| # | Pergunta | Com quem | Bloqueia |
| --- | --- | --- | --- |
| P1 | O saldo não gozado no fim do estágio é pago? Qual a base? | Contador | Só o plano de desligamento |
| P2 | O saldo do primeiro ano continua valendo no segundo ano de estágio (sem vencimento dentro da vigência)? O plano assume que sim. | RH | RN3 antes da etapa 3 |
| P3 | Fração do mês incompleto: só meses completos (recomendado), fração diária arredondada para cima, ou fração guardada com dias inteiros só a cada mês? | RH | Cálculo |
| P4 | Aviso de recesso assinado pelo estagiário na Autentique; o recesso pode começar com o aviso pendente? | RH | Trilha |
| P5 | Cadastro passa a exigir "estágio remunerado: sim/não" (aparece no aviso)? | RH | Aviso |
| P6 | Limite interno de 3 meses após o ciclo para regularizar saldo, com alerta e justificativa do RH? | RH | Alertas |

## 10. Custo de leitura

- Panorama: os registros de férias já são carregados; o acréscimo é um resumo de vigência por estagiário, com um documento lido por estagiário a cada carregamento da página. Com 10 estagiários e 200 carregamentos por mês: cerca de 2.000 leituras por mês.
- Nenhum listener, polling ou consulta sem filtro novo.

## 11. Testes e critérios de aceite

| Nível | O que prova |
| --- | --- |
| Unitário (`internship-recess`) | 0, 1, 3, 6, 12, 13 e 24 meses; arredondamento para cima; teto da vigência; partes rejeitadas não consomem; saldo projetado no término. |
| Servidor | Recusa recesso sem estágio vigente, acima do saldo, depois do término ou sobreposto; recusa `gozo` para estagiário e `recesso` para CLT; ações da trilha CLT recusam recesso. |
| Interface | Estrutura do Panorama (selo, filtro, alerta) e da página (ícone com a conta, "Agendar recesso", trilha curta). |
| E2E (observação) | Emulador `demo-`: estagiária com 3 meses agenda 5 dias, RH aprova, a parte aparece como agendada e o saldo cai de 8 para 3. |

Critérios de aceite: um estagiário de exemplo com estágio desde 15/07/2026 mostra, em 28/10/2026, 8 dias acumulados; o ícone explica "3 meses × 2,5 = 7,5 → 8 dias"; agendar 9 dias é recusado com a mensagem do saldo; CLT continua exatamente como antes.

## 12. Etapas de entrega

1. Auditoria do módulo de Férias, para documentar e corrigir lacunas antes de construir.
2. Função `internship-recess` com testes unitários.
3. Tipo, schema e validações no servidor (RN4, RN9), com testes de servidor.
4. Panorama e página individual, com testes de interface e o E2E em observação.
5. Guia [`vacation-scheduling.md`](../engineering/flows/vacation-scheduling.md) atualizado e plano marcado como implementado.

## 13. Riscos

| Risco | Tratamento |
| --- | --- |
| Período de estágio sem início ou sem término cadastrado | RN5 e aviso na página; a conta não roda sem início. |
| Efetivação contando o tempo de estágio nas férias da CLT | RN8; teste do cálculo da CLT com início no período CLT. |
| Registros antigos de estagiário gravados como `gozo` | A auditoria (etapa 1) lista os casos; correção por script com ensaio, rodado pelo usuário. |
