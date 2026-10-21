# Avisos do sistema

**Estado:** publicado em produção em 18/10/2026. O segredo `SYSTEM_NOTICES_JOB_SECRET`, a rota e a função agendada estão ativos; a execução manual publicada concluiu com HTTP 200 e não abriu aviso indevido.

## Superfícies

- [`/dashboard/system-notices`](../../../src/app/dashboard/system-notices/page.tsx): central de avisos operacionais (Abertos/Resolvidos), com link no menu Configurações para quem pode abri-la.
- `GET /api/system-notices?status&cursor`: lista paginada (50) dos avisos dos públicos do usuário.
- `POST /api/jobs/system-notices/daily`: rotina diária idempotente, autenticada por `SYSTEM_NOTICES_JOB_SECRET` em `Authorization: Bearer`.
- Função agendada [`systemNoticesDailyMonitor`](../../../functions/src/system-notice-jobs.ts): 08:00 (America/Belem), chama a rota acima; URL padrão `https://op.coalashakes.com/api/jobs/system-notices/daily` (`SYSTEM_NOTICES_JOB_URL`).

## Acesso em duas camadas

1. **Central:** administrador padrão ou `settings.view` + `settings.viewSystemNotices` ("Ver avisos do sistema"). Sem isso a página e a API recusam.
2. **Aviso:** cada documento declara um público em [`core.ts`](../../../src/features/system-notices/core.ts). `system.admin` é só do administrador padrão; `dp.time-manager-global` exige `dp.settings.manageTime` e acesso a todas as unidades (mesma regra da exportação do AFD). O servidor consulta `audience in [públicos do usuário]`; nada é filtrado só na tela.

O sino recebe uma cópia em `userNotifications` para quem atende às duas camadas pelo perfil (até 50 pessoas por aviso). Administrador definido apenas por claim do token vê a central, mas não recebe no sino. Perder a permissão remove o acesso à central na hora; avisos já entregues no sino levam à central, que revalida.

## Dados

`systemNotices/{sha256(workspace, dedupeKey)}` no banco principal, somente Admin SDK (regra `deny`): categoria, gravidade, público, título, texto, `status open|resolved`, datas ISO e motivo da resolução. `openSystemNotice` cria uma única vez por `dedupeKey` em transação; reexecutar não duplica nem reabre aviso resolvido. `resolveSystemNotices` fecha os abertos da categoria que deixaram de valer.

## Rotina diária do ponto

[`monitor.server.ts`](../../../src/features/dp/rep-p/monitor.server.ts), público `dp.time-manager-global`:

- **Certificado e-CNPJ:** marcos em dias civis de America/Fortaleza — 60, 45, 30, 15, 7, 5, 4, 3, 2, 1, 0 (dia do vencimento) e vencido. Um aviso por marco e por impressão digital do certificado; o marco novo resolve o anterior e um certificado renovado resolve todos. Gravidade: informativo (60/45), atenção (30/15), crítico (≤7 e vencido). Credencial inválida gera aviso crítico. Não lê nem registra a chave.
- **Hora Legal:** a rotina usa o mesmo relógio do registro e abre aviso crítico quando a atestação HLB está ausente, inválida ou vencida; exige uma consulta nova aos servidores e só resolve quando ela volta a passar por quórum, tolerância e atualidade. Cache/fallback nunca resolve o aviso. A sonda não substitui o gate global nem a validação em cada batida.
- **Comprovantes pendentes** há mais de 1 hora: antes de contar, a rotina tenta emiti-los (`retryPendingRepPReceipts`, até 50 por execução); os que restarem geram um aviso por dia enquanto houver, resolvido quando zerar (consulta `count()` indexada).
- **Revisão das normas:** aviso quando `REP_P_NORMS_REGISTRY.lastReviewedAt` for nulo ou tiver mais de 30 dias.

Custo: uma execução por dia; leituras ≈ 4 consultas de avisos abertos + 1 contagem + até 200 perfis e 50 usuários por aviso novo, além de até quatro datagramas NTP de ida e quatro de volta. A central lê no máximo 51 documentos por página, sem listener nem polling.

## Evidência e lacunas

Unitários cobrem acesso, públicos, marcos (inclusive virada de dia no fuso) e gravidade. O emulador cobre abertura única por marco, troca 60→45, vencido, renovação, pendências, filtro por público e entrega no sino apenas ao gestor de Tempo. Regras confirmam `deny` a clientes. Em 18/10/2026, a raiz publicada respondeu HTTP 200, a rota do job recusou chamada sem segredo com HTTP 401 e a função agendada executou a rota real com sucesso; a resposta autenticada informou certificado válido, `clockState: ok`, zero comprovantes pendentes e nenhum aviso novo. Ainda não verificados: tela no navegador (sem E2E) e entrega a administradores definidos só por claim.
