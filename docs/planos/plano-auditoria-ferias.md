# Plano — Auditoria do módulo de Férias

**Produto:** Coala OP

**Status:** registrado em 29/10/2026; a auditoria fica para depois. Nada foi investigado nem implementado.

**Última atualização:** 29/10/2026

**Responsável funcional:** RH / DP

> Este plano só registra o que foi combinado. Ele não descreve o estado atual do módulo: isso é o produto da primeira etapa.

## 1. Objetivo

Documentar o módulo de Férias como ele funciona hoje, listar as lacunas e os registros fora da regra, e decidir o que corrigir antes de construir o [recesso do estagiário](plano-recesso-estagio.md), que usa o mesmo módulo.

## 2. Escopo

**Entra:** Panorama e página individual de Férias, registro `dp_vacations` (`gozo` e `venda`), trilha de 6 etapas, aviso e recibo de férias, permissões (`canManageVacation`), eventos de auditoria e o cálculo do período aquisitivo e concessivo.

**Fica fora:** o recesso em si (plano próprio), o desligamento e o saldo de férias na rescisão ([plano de desligamento](plano-desligamento.md)).

## 3. Situação atual

A verificar na etapa 1. Não copiar para cá o que o [plano de recesso](plano-recesso-estagio.md) descreve do módulo sem reconferir no código.

## 4. Decisões

| # | Decisão | Data |
| --- | --- | --- |
| D1 | A auditoria acontece antes de construir o recesso, mas fica para depois da rodada de ponto de 28–29/10/2026. | 29/10/2026 |

## 5. Pendências a confirmar

| # | Pergunta | Com quem |
| --- | --- | --- |
| P1 | Quando a auditoria entra na fila, e se pode rodar junto com o recesso. | RH / DP |

## 6. Ordem de execução

1. Mapear o módulo: fluxos, dados, rotas, permissões e documentos, conforme `docs/engineering/investigation-harness.md`.
2. Listar lacunas e registros antigos fora da regra (por exemplo, estagiário gravado como `gozo`), com dry-run, sem escrita em produção.
3. Propor as correções e o que entra antes do recesso. Atualizar o guia `docs/engineering/flows/vacation-scheduling.md`.
