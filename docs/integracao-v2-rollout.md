# Liberação da Integração V2

## Pré-requisitos

- configurar `CRON_SECRET` no ambiente de produção;
- agendar `POST /api/hr/probation/alerts` uma vez ao dia, depois de 00:05 no fuso `America/Belem`;
- manter backup do banco `coala-rh` antes da migração;
- configurar `FIREBASE_SERVICE_ACCOUNT_PATH` somente na estação responsável pela migração;
- publicar ao menos um modelo DOCX quando houver blocos de geração documental.

## Migração dos modelos legados

O script é idempotente e executa em simulação por padrão.

```bash
npm run migrate:onboarding-v2
```

Revisar a lista `pending`. Somente depois da conferência:

```bash
npm run migrate:onboarding-v2 -- --apply
```

Cada modelo recebe uma chave `legacyMigrationKey`; uma nova execução não recria itens já migrados. Processos antigos continuam com o fluxo legado e novos processos recebem `integrationV2` e `probationV2`.

## Verificações após a migração

1. Abrir Modelos de integração e conferir cargo, função, etapas e uploads.
2. Publicar um modelo novo de teste e confirmar que a versão anterior não muda.
3. Criar uma integração por importação e validar o snapshot da versão.
4. Criar uma integração avulsa, adicionar etapa/campo e confirmar que nenhum modelo foi alterado.
5. Preencher respostas condicionais, enviar PDF e avançar a etapa.
6. Enviar um DOCX com `{{employee.name}}` formatado em negrito e gerar o documento.
7. Confirmar as datas 45 + 45 e as duas janelas de dez dias.
8. Executar manualmente o endpoint de alertas e conferir `hrNotifications`.

## Regra operacional: Coleta, Conferência e link do candidato

- A etapa **Formalização · Coleta de dados** é o canal de preenchimento pelo candidato.
- No primeiro envio válido do formulário público, o processo avança para **Formalização · Conferência**, mesmo que ainda existam documentos pendentes.
- O link público não é fechado automaticamente nesse avanço. Ele permanece aberto para complementação/correção até aprovação, expiração ou fechamento manual pelo RH.
- A etapa **Coleta** não aprova documentos. Ela mostra dados, pendências e arquivos enviados.
- A etapa **Conferência** é o ponto de auditoria e decisão documental.
- O RH só pode aprovar ou reprovar um documento quando houver arquivo auditável (`fileUrl`) para abertura.
- Quando não houver arquivo, a interface deve mostrar **Nenhum arquivo enviado** ou **Sem arquivo**, e o backend deve bloquear aprovação.
- Mensagens do copiloto só devem aparecer quando houver extração real registrada no documento (`extractedFields` ou campos legados de extração).
- Sem extração, a Conferência deve operar como revisão manual: abrir documento, conferir conteúdo e então aprovar/reprovar.
- Reprovação mantém o link aberto e libera novo envio pelo candidato para aquele documento.

## Regra operacional: fases, requisitos e ações disponíveis

- A linha do tempo pode ser clicada para consulta, mas uma fase futura é somente leitura.
- O sistema não deve exibir botão genérico de **Definir como etapa atual**. Avanço de fase deve acontecer por conclusão de requisitos ou ação específica da etapa.
- Ações operacionais só ficam ativas quando a fase selecionada é também a fase atual do processo.
- A etapa **Formalização · Assinatura dos documentos** não pode exibir documentos hardcoded. Contrato, termo de VT, acordo de compensação ou qualquer outro item só aparecem se houver modelo/geração/solicitação real vinculada ao processo.
- Se não houver documento gerado nem assinatura solicitada, a etapa de assinatura deve mostrar estado vazio, sem sugerir que modelos já existem.
- A etapa **Formalização · Finalização** não encerra a integração sozinha. Ela salva as configurações finais do colaborador, quando aplicável, e deve deixar claro que isso não conclui o onboard.
- As configurações finais só podem ser salvas quando **Formalização · Finalização** for a fase atual; a API também deve bloquear salvamento fora dessa fase.
- Finalizar a integração exige requisitos de etapas anteriores concluídos. Enquanto essa matriz completa de requisitos não estiver implementada, a interface não deve permitir atalhos manuais para etapas futuras.

## Reversão operacional

- não excluir `onboardingStages` nem `onboardingDocuments` dos cargos e funções nesta liberação;
- em caso de interrupção, arquivar os modelos V2 e continuar lendo os processos legados;
- snapshots já iniciados não devem ser reescritos; correções devem ser feitas em nova versão do modelo;
- documentos gerados permanecem auditáveis em `generatedDocuments` e no Storage.
