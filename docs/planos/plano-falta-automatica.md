# Plano — Falta automática e declarada

**Produto:** Coala OP e Coala Go

**Status:** opção A escolhida pelo programador em 29/10/2026, contra a recomendação de Doc Brown (B). A rotina de desconto automático **só liga em produção depois da resposta do advogado** (seção 8); até lá a implementação fica atrás de uma chave desligada. Nada foi implementado.

**Última atualização:** 29/10/2026

**Responsável funcional:** RH / DP

> Este plano registra decisões de produto e a orientação de Doc Brown. Não é parecer jurídico e não declara conformidade. Pendências da seção 7 viram regra no código só depois da confirmação.

## 1. Objetivo

Definir o que acontece com o dia escalado de trabalho em que o colaborador não bateu ponto: os caminhos que ele tem no app e quando o sistema registra a falta.

## 2. Decisões do programador (29/10/2026)

| # | Decisão |
| --- | --- |
| D1 | Em dia escalado de trabalho sem batida, o app oferece três caminhos: **Pedir ajuste** (esqueci de bater etc.), **Informar ausência** (atestado, folga combinada etc., com análise do DP) e **Declarar falta**. |
| D2 | O próprio colaborador pode declarar a própria falta. |
| D3 | "Falta é falta, desconta sempre": a falta declarada é injustificada, com desconto. Qualquer outro motivo é ausência ou pedido de ajuste. |
| D4 | Se o colaborador não resolver o dia até a virada (23:59:59), a falta entra automaticamente. Ele pode tratar depois, em outro momento. |
| D5 | **Revoga**, nesse ponto, a decisão de 20/10/2026 do [plano de ponto e fechamento](plano-jornada-fechamento-rh.md) ("falta é ato discricionário do operador; dia sem batida fica a tratar; o DP lança a ausência"). As decisões de DSR (toda folga da escala é DSR) e do tipo da ausência continuam valendo. |
| D6 | **Opção A** (seção 5): falta automática com desconto direto, sem confirmação do DP. Escolhida em 29/10/2026 depois de ler o risco alto e a recomendação da opção B. Não elimina a pendência jurídica da seção 8. | 

## 3. Situação atual

- O Coala Go mostra o dia sem batida com o chip "Sem batida" e o botão "Pedir ajuste". O atalho "Informar ausência" (pedido de ausência com a data do dia) está no código do app, sem commit.
- "Declarar falta" e a falta automática não existem. A rotina que cria a falta, a rota do servidor, a permissão e o evento de folha estão por projetar.

## 4. Orientação de Doc Brown (29/10/2026)

Risco jurídico **alto** no desconto automático sem ato do empregador (CLT art. 462; arts. 130 e 131 sobre férias; Lei 605/49 art. 6º sobre DSR; Súmula 338 do TST). O art. 74 não é violado se a falta for tratamento separado, sem NSR e sem AFD. Textos e vigência foram citados de memória e precisam de conferência em fonte oficial.

O que **não pode** virar falta automática: feriado, DSR/folga, dia sem escala, escala em revisão ou ambígua, férias, afastamento, licença, desligamento, data anterior à admissão, atestado ou ausência em análise, ajuste pendente, turno em curso na virada, turno noturno que cruza a meia-noite (vale o dia do início, e a falta só depois do fim do turno), dia com batida original (mesmo incompleta é "a tratar") e falha de sincronização ou batida offline que ainda possa chegar. A virada vale no fuso da unidade; sem fonte de hora confiável, a rotina não roda.

Salvaguardas mínimas: aviso prévio ao colaborador antes da virada, janela de reversão (por ajuste ou ausência aprovados), evento append-only com origem, autor, hora legal e versão das regras, nunca apagar (reverter é novo evento), visibilidade para o colaborador e para o DP, folha alimentada só no fechamento, e a falta nunca aparece como marcação.

Texto do app: "Se houver motivo legal, use Informar ausência." O botão Declarar falta é neutro, avisa que gera desconto, e a declaração é revogável na janela de reversão.

## 5. Alternativas (decisão pendente)

| Opção | O que faz | Risco |
| --- | --- | --- |
| A | Falta automática com desconto direto, como decidido em D4. | Alto; defesa fraca por falta de ato humano. |
| B (recomendada por Doc Brown) | Falta **presumida**, "a tratar com aviso", sem desconto. O DP confirma em lote (uma lista, um clique) até o fechamento; sem reversão em um prazo (a definir, por exemplo 5 dias úteis) a confirmação ocorre sozinha, com aviso. | Menor; mantém a automação e o ato do empregador. |
| C | Só o DP lança a falta (decisão de 20/10). | Menor, mais trabalho manual. |

A falta **declarada** pelo colaborador pode seguir qualquer uma das opções.

## 6. Regras de negócio (rascunho, valem após a escolha da seção 5)

| # | Regra |
| --- | --- |
| RN1 | Candidato a falta: dia com turno `work` escalado, nenhuma batida, nenhum ajuste, ausência ou atestado pendente, fora das exclusões da seção 4. |
| RN2 | O corte é o fim do turno mais tolerância e prazo de sincronização, no fuso da unidade, não 23:59:59 do calendário. O prazo é configurável. |
| RN3 | A rotina é idempotente: reprocessar não duplica, e grava a versão da escala, da jornada, dos feriados e da política. |
| RN4 | Reverter é um novo evento ligado ao primeiro. A competência fechada só aceita retificação auditada pelo DP, com justificativa. |
| RN5 | Efeito em DSR e em férias exige regra expressa e recalcula na reversão. |
| RN6 | Falta alimenta o evento de folha só no fechamento. No AEJ aparece como ausência tratada (código a confirmar com o atestado técnico), nunca como marcação. |

## 7. Pendências a confirmar

| # | Pergunta | Com quem |
| --- | --- | --- |
| P1 | Resolvida em D6: opção A (29/10/2026). | — |
| P2 | Prazo de sincronização antes da falta, janela de reversão e o caso de falta do último dia da competência. | RH / DP |
| P3 | Código do AEJ para ausência injustificada tratada pelo sistema, e identificação do autor "sistema". | Atestado técnico |
| P4 | Convenção coletiva aplicável: abonos que exijam análise antes do desconto. | RH / advogado |
| P5 | Conferência de Portaria 671, Súmula 338, CLT arts. 130, 131, 462 e 473 e Lei 605/49 em fonte oficial. | Doc Brown / advogado |

## 8. Pergunta ao advogado

Sistema de ponto eletrônico (REP-P/PTRP, Portaria MTP 671/2021), empresa com CCT [informar]. Pretende-se que, no dia escalado sem nenhuma marcação e sem ajuste, ausência ou atestado pendentes ao fim do turno, mais um prazo de sincronização, o sistema registre falta injustificada com desconto do dia, reflexos em DSR e férias, sem ato do DP; o empregado é avisado antes e pode reverter por ajuste ou ausência aprovados. O empregado também poderá declarar a própria falta pelo aplicativo, sem análise.

1. O desconto automático, sem ato do empregador, é defensável diante da Súmula 338 do TST e do art. 462 da CLT?
2. A falta declarada pelo empregado, sem análise, vale como prova e como justificativa do desconto, ou há risco de vício?
3. O desconto do DSR e o impacto em férias (arts. 130 e 131) devem ser automáticos ou depender de confirmação do DP?
4. A CCT prevê abonos que obriguem a análise antes do desconto?
5. A opção B é suficiente?
6. Qual prazo de reversão e de guarda dos eventos o escritório recomenda?

## 9. Ordem de execução

1. Enviar a seção 8 ao advogado. Enquanto ele não responde, a rotina e a rota ficam atrás de uma chave desligada em produção (`FALTA_AUTOMATICA_ENABLED=false`), como o gate do REP-P.
2. Fechar P2 a P4.
3. Projetar a rotina, o evento, a rota de "Declarar falta", a permissão e o aviso prévio, com revisão de Doc Brown e de permissões.
4. Implementar com testes de fronteira (turno noturno, virada de fuso, batida offline tardia, reversão após o fechamento) e um teste que garanta que a falta nunca grava NSR, AFD nem altera a batida original.
5. Atualizar os guias de ponto, as telas do Coala Go e o [plano de ponto e fechamento](plano-jornada-fechamento-rh.md).
