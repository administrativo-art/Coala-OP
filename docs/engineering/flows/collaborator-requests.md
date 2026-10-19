# Solicitações do colaborador

## Objetivo

Centralizar pedidos recorrentes do colaborador com análise do Departamento Pessoal, trilha auditável, vigência calculada e documento próprio. O primeiro fluxo implementado é o vale-transporte, com adesão, alteração, suspensão e reativação.

## Entradas

- `src/app/dashboard/collaborator/requests/page.tsx`: central **Minhas solicitações**, histórico, andamento, termo e assinatura.
- `src/app/dashboard/dp/requests/page.tsx`: fila de análise do Departamento Pessoal.
- `src/app/api/collaborator/requests/route.ts`: lista pedidos próprios ou revisáveis e cria um pedido.
- `src/app/api/collaborator/requests/[requestId]/route.ts`: cancela, aprova, rejeita ou refaz a geração do termo.
- `src/app/api/collaborator/requests/[requestId]/document/route.ts`: entrega DOCX ou PDF somente ao titular ou ao RH autorizado.
- `src/app/api/collaborator/requests/[requestId]/signature/route.ts`: consulta ou inicia a assinatura independente.
- `src/app/api/dev/transport-voucher-templates/[kind]/route.ts`: prévia fictícia local dos três modelos; indisponível em produção e fora de `localhost`.
- Coala Go, entrada **Solicitações** (Etapa 7, 19/10/2026): lista os pedidos próprios (`scope=own`) e cria adesão, alteração, suspensão ou reativação pela mesma rota, depois de um resumo; termo e assinatura continuam na web. O schema do pedido fica em `src/features/hr/requests/schemas.ts`, reexportado pela segurança, para também validar o payload do app.

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

## Estado atual

Implementado em 13/10/2026. A integração de assinatura reutiliza o fluxo de assinatura independente de documentos gerados. A data prevista do contracheque usa o quinto dia útil; feriados precisam continuar sendo fornecidos ao cálculo quando o calendário de folha estiver conectado ao fluxo.
