# Solicitações do colaborador

## Objetivo

Centralizar pedidos recorrentes do colaborador. O vale-transporte segue para análise do Departamento Pessoal; a troca de turno é decidida pela outra pessoa envolvida e altera a escala automaticamente somente após o aceite autenticado.

## Entradas

- `src/app/dashboard/collaborator/requests/page.tsx`: central **Minhas solicitações**, histórico, andamento, termo e assinatura.
- `src/app/dashboard/dp/requests/page.tsx`: página do Departamento Pessoal em três abas (27/10/2026): **Para analisar** reúne vale-transporte pendente, ausências atribuídas, ajustes de ponto e turnos sem cobertura, com chips que filtram por tipo; **Acompanhamento** mostra vale-transporte em qualquer situação e as ausências da equipe; **Pendências de documento** mostra termos com falha de geração e a retenção de comprovantes. Fechamento do ponto e exportação AFD/AEJ saíram desta página.
- `src/app/api/collaborator/requests/route.ts`: lista pedidos próprios ou revisáveis e cria um pedido.
- `src/app/api/collaborator/requests/[requestId]/route.ts`: cancela, aprova, rejeita ou refaz a geração do termo.
- `src/app/api/collaborator/requests/[requestId]/document/route.ts`: entrega DOCX ou PDF somente ao titular ou ao RH autorizado.
- `src/app/api/collaborator/requests/[requestId]/signature/route.ts`: consulta ou inicia a assinatura independente.
- `src/app/api/collaborator/requests/shift-swaps`: lista e cria trocas de turno; `options` devolve somente pares possíveis e `[requestId]` aceita, recusa ou cancela.
- `src/features/dp/shift-swaps/contract.server.ts`: contrato central e autoritativo consumido pela web e pelo Coala Go.
- `src/app/api/dev/transport-voucher-templates/[kind]/route.ts`: prévia fictícia local dos três modelos; indisponível em produção e fora de `localhost`.
- Coala Go, entrada **Solicitações**: ausência, vale-transporte e troca de turno usam as mesmas rotas da web. Consulta de documentos não pertence ao aplicativo.

## Regra da troca de turno

A proposta sempre envolve dois turnos de trabalho futuros, da mesma unidade e do mesmo dia. O solicitante só oferece seu próprio turno e escolhe o turno de outra pessoa ativa. O servidor impede que qualquer um dos dois turnos participe de duas propostas pendentes.

A pessoa convidada recebe notificação e pode aceitar ou recusar; o solicitante pode cancelar enquanto estiver pendente. A recusa não altera a escala. No aceite, o servidor lê a escala novamente, compara a fotografia de ambos os turnos, revalida lotação, jornada, definição do turno, ausências e ocupação do dia, e troca somente `userId`/`userName` em uma única transação. Horários, unidade, data e definição continuam iguais; cada novo ocupante recebe uma nova referência histórica para preservar o contrato do dia. Se a escala mudou ou o dia começou, a proposta fica obsoleta e uma nova solicitação é necessária.

Cada envio, aceite, recusa e cancelamento registra no servidor UID autenticado, nome, instante, provedor da sessão, `auth_time`, operação idempotente, IP e agente do dispositivo, além da declaração apresentada. Isso identifica o aceite sem exigir assinatura reconhecida. A resposta aos participantes mostra a declaração, o nome, o instante e o provedor, mas redige e-mail, `auth_time`, IP, agente e chave idempotente. O cliente nunca decide a troca diretamente e o Firestore nega acesso direto a `dp_shiftSwapRequests`.

A decisão do programador em 21/10/2026 aceita essa manifestação autenticada como prova operacional do acordo, sem assinatura reconhecida. O pedido e suas manifestações têm retenção mínima de 20 anos e não recebem TTL de exclusão automática; os `actionLogs` correspondentes usam vencimento de 20 anos. As consultas são sempre limitadas e escopadas pelo workspace: até 100 pedidos na central, até 20 candidatos por turno para impedir proposta concorrente e até 2.001 pedidos na conferência defensiva de uma competência. `firestore.indexes.json` declara os três índices do contrato (`workspaceId + participantUids`, `workspaceId + shiftKeys` e `workspaceId + workDate`).

## Regra do vale-transporte

O corte padrão é o dia 20. Pedido feito até o corte vigora no primeiro dia do mês seguinte; depois do corte, no primeiro dia do segundo mês seguinte. A interface informa antes do envio:

- a data de vigência;
- a competência de processamento;
- o contracheque em que a mudança aparecerá, com a data prevista de pagamento.

O motivo é opcional. Só pode existir um pedido pendente por colaborador. O estado atual do benefício determina as ações disponíveis: quem nunca aderiu solicita adesão; quem está ativo solicita alteração ou suspensão; quem já teve o benefício e está suspenso solicita reativação.

## Documentos e assinatura

Adesão, suspensão e reativação têm modelos independentes no `SYSTEM_DOCUMENT_TEMPLATES`. Suspensão e reativação registram expressamente o pedido e a concordância com a regra de corte. Após a aprovação, o termo é gerado, armazenado em `generatedDocuments`, disponibilizado em PDF no navegador e encaminhado para assinatura independente. A trilha da solicitação registra geração, falha e envio para assinatura.

O catálogo visível em **Configurações → Pessoal → Documentos → Geração e publicação** deriva do mesmo registro oficial; consulte `docs/engineering/generated-documents-registry.md`.

## Segurança e escopo

Todas as rotas persistentes exigem usuário ativo. O colaborador acessa o próprio pedido; o RH precisa das permissões de solicitações e continua limitado às unidades visíveis. Entradas são validadas por schema e as rotas declaram contratos de segurança. A rota de prévia é apenas uma ferramenta local com dados fictícios e controle explícito de host.

Na decisão da troca, o contrato declara explicitamente a autorização `shift-swap-participant-action` e o escopo `shift-swap-participant`. O serviço autoritativo continua sendo a fonte da decisão: somente o solicitante cancela e somente a pessoa convidada aceita ou recusa, sempre dentro do mesmo workspace e com nova validação da escala antes da escrita.

## Estado atual

Implementado em 13/10/2026. A integração de assinatura reutiliza o fluxo de assinatura independente de documentos gerados. A data prevista do contracheque usa o quinto dia útil; feriados precisam continuar sendo fornecidos ao cálculo quando o calendário de folha estiver conectado ao fluxo.
