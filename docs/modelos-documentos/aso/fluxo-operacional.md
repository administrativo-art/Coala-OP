# Fluxo operacional do ASO admissional

## Estados

1. `guide_generated`: guia PDF gerada e versionada.
2. `guide_validated`: versão atual revisada pelo RH.
3. `email_sent`: guia enviada à clínica com anexo e endereço de resposta rastreável.
4. `appointment_pending_review`: resposta recebida ou registrada, aguardando conferência humana.
5. `candidate_notified`: agendamento confirmado e candidato avisado.
6. `aso_received`: candidato anexou o ASO.
7. `completed`: RH aprovou o ASO.

Gerar uma nova versão da guia invalida a validação da versão anterior. O envio por e-mail só aceita a versão atual validada.

## Auditoria

- PDFs gerados ficam em `onboardingProcesses/{id}/generatedDocuments` e no Storage.
- Eventos operacionais ficam em `onboardingProcesses/{id}/asoEvents`.
- Comunicações ficam em `emailCommunications`, vinculadas ao `onboardingId` e ao identificador do provedor.
- Tokens públicos são aleatórios e somente o SHA-256 é persistido.
- O ASO devolvido registra nome, MIME, tamanho, caminho, SHA-256, data e decisão do RH.

## Retorno da clínica

- A clínica pode responder normalmente, por escrito, ao próprio e-mail recebido.
- Como alternativa, o e-mail apresenta um link mínimo para informar somente data e horário. Após o envio, a clínica recebe uma mensagem de agradecimento.
- O cabeçalho `Reply-To` utiliza um endereço exclusivo no formato `aso+{token}@{ASO_INBOUND_DOMAIN}` para vincular a resposta ao processo correto.
- O webhook recupera o texto integral da resposta, sugere data, horário e local e encaminha a proposta para conferência do RH.
- Contingência: registro manual pelo RH para respostas recebidas por telefone, WhatsApp ou outro canal.

A leitura automática de e-mail apenas sugere data, horário e local. O candidato só é avisado depois da confirmação humana do RH.

O e-mail do candidato contém, por escrito, data, horário, local, orientações e a exigência de documento oficial com foto. O link enviado ao candidato tem uma única finalidade: anexar o ASO. O upload permanece bloqueado até o dia do exame.

## Configuração necessária antes do rollout

- `RESEND_API_KEY` disponível no backend.
- `RESEND_WEBHOOK_SECRET` disponível no backend.
- `ASO_INBOUND_DOMAIN` configurado com um subdomínio habilitado para recebimento no Resend.
- Webhook `/api/webhooks/resend` inscrito em eventos de envio, entrega, abertura, clique, falha e `email.received`.
- `NEXT_PUBLIC_RECRUITMENT_URL` apontando para o domínio que serve as páginas públicas.

Sem `ASO_INBOUND_DOMAIN`, o sistema bloqueia o envio à clínica para não encaminhar uma mensagem cuja resposta não possa ser vinculada e auditada. O registro manual continua disponível como contingência.
