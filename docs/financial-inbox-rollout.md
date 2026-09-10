# Caixa de cobranças por e-mail

## Escopo

- O Google Workspace mantém a mensagem original e encaminha somente cópias filtradas.
- O Resend entrega o evento assinado ao webhook já utilizado pelo produto.
- O Coala arquiva o `.eml` e anexos permitidos no Storage privado.
- A entrada cria somente uma pendência de revisão. Não cria despesa, não autoriza pagamento e não envia instrução bancária.
- A chave idempotente é o `email_id` do Resend; o replay do webhook não duplica a mensagem.

## Endereço e variáveis

- `FINANCIAL_INBOUND_ADDRESS`: `cobrancas@entrada.coalashakes.com`.
- `ASO_INBOUND_DOMAIN`: `entrada.coalashakes.com`, compartilhando somente o domínio técnico de recebimento; cada fluxo mantém destinatários próprios.
- `RESEND_API_KEY`: segredo já utilizado para recuperar conteúdo e anexos.
- `RESEND_WEBHOOK_SECRET`: segredo já utilizado para verificar a assinatura Svix.
- `OPENAI_API_KEY`: habilita a leitura visual de imagens e PDFs sem camada textual. Sem a chave, esses documentos permanecem como `OCR pendente`.
- `OPENAI_FINANCIAL_INBOX_DOCUMENT_MODEL`: modelo opcional da extração visual; quando ausente, reutiliza `OPENAI_FINANCIAL_DOCUMENT_MODEL`.
- `FINANCIAL_INBOX_DOCUMENT_DOMAINS`: lista opcional, separada por vírgulas, de domínios documentais adicionais aprovados. Subdomínios do mesmo domínio-base do remetente já são aceitos e não precisam entrar na lista.

O endereço técnico nunca deve ser o alias público do Google, evitando ciclos de encaminhamento.

## Preflight de custo do Firestore

Não foram adicionados `setInterval`, `onSnapshot`, `getDocs()` ou consultas de coleção completa.

Por mensagem inédita:

- 1 leitura direta para idempotência;
- 1 escrita do registro da caixa;
- 1 escrita do evento de recebimento;
- até 501 leituras de despesas abertas, 101 leituras de pagamentos do mesmo valor, 100 leituras diretas de despesas pagas referenciadas e 10 leituras de previsões; a análise só alcança esses limites quando valor, vencimento e fornecedor foram identificados;
- 0 consultas recorrentes.

Por revisão humana:

- 1 leitura transacional;
- 1 atualização do registro;
- 1 escrita de evento.

Na conciliação bancária, uma obrigação quitada faz uma leitura pontual da solicitação associada. Para registros históricos sem `paymentRequestId`, o fallback é uma consulta única limitada a dois resultados por despesa conciliada; não há polling adicional, e novos pedidos gravam o ponteiro na despesa de forma transacional.

A listagem usa `workspaceId`, status opcional, ordenação e `limit(25)`, com cursor. Considerando três usuários, seis aberturas/atualizações por dia e uma página por abertura: `25 × 6 × 3 × 30 = 13.500` leituras mensais. Não há atualização automática em segundo plano. Uma segunda página custa outras 25 leituras apenas quando solicitada.

No teto defensivo, 50 cobranças analisáveis por mês representam até 35.600 leituras para cruzamento. O armazenamento depende dos documentos: a 5 MB por mensagem, o crescimento seria de cerca de 500 MB por mês, além de um arquivo lateral de texto limitado a 80 KB por documento analisado. Não há polling, listener novo nem leitura de coleção sem limite.

## Limites de segurança

- e-mail original: até 35 MB;
- anexo individual: até 15 MB;
- anexos arquivados por mensagem: até 25 MB e 20 arquivos;
- tipos permitidos: PDF, XML, CSV, texto, EML e imagens;
- HTML nunca é renderizado na interface;
- até cinco documentos arquivados são analisados por cobrança;
- PDFs com camada textual, XML, CSV e TXT são lidos deterministicamente; imagens e PDFs escaneados usam análise visual somente quando a chave da OpenAI está configurada;
- cobranças de telefonia móvel ou fixa só recebem sugestão automática quando o número da linha extraído também coincide com a despesa ou previsão;
- no fallback visual, o arquivo temporário enviado à OpenAI usa `store: false` na resposta e é removido da Files API em melhor esforço após a análise;
- links só são consultados por HTTPS quando pertencem ao mesmo domínio-base do remetente, à lista explícita de domínios permitidos ou a uma rota documental pública e restrita de um provedor conhecido;
- o cadastro de provedor confiável não libera o domínio inteiro: Superlógica e Acessórias são limitadas às rotas públicas de cobrança/nota/guia, e o conteúdo baixado precisa confirmar por assinatura binária que é um tipo documental permitido;
- cada redirecionamento é revalidado, endereços locais/privados são bloqueados, a resposta é limitada a 15 MB e apenas PDF, XML, texto e imagens são arquivados;
- páginas que exigem login, senha, CAPTCHA ou sessão ficam como `Documento pendente`; o sistema não manipula credenciais do portal;
- parâmetros e tokens do link não são persistidos nos metadados do documento arquivado;
- downloads são atendidos por API autenticada e com `nosniff`;
- Storage e coleção Firestore não permitem acesso direto pelo cliente.

## Ativação e rollback

1. Publicar código, regras e índices.
2. Configurar `FINANCIAL_INBOUND_ADDRESS` e validar o webhook no Resend.
3. Enviar um e-mail direto ao endereço técnico e confirmar o registro único.
4. Ativar no Google a regra do alias `cobrancas@coalashakes.com`.
5. Ativar a regra legada com a lista autenticada de fornecedores.
6. Em rollback, desativar as regras do Google; a entrega original permanece intacta.

## Fila de implementação — vinculação automática opt-in

Status: planejada, ainda não ativada.

- Permitir que o usuário escolha entre `Automático`, `Confirmar sugestão` e `Somente manual`.
- No modo automático, vincular somente quando existir um único candidato e houver identidade documental forte:
  - mesma linha digitável/código de barras; ou
  - mesmo CNPJ, número da NF/documento, parcela, valor e vencimento.
- Tratar um novo e-mail com o mesmo fingerprint documental como lembrete da cobrança já vinculada, sem criar outra obrigação.
- Registrar regra, evidências, confiança, usuário/política responsável e data em evento auditável.
- Oferecer desfazer vínculo sem apagar o e-mail, a despesa ou o histórico.
- A vinculação automática nunca cria pagamento, nunca autoriza e nunca envia instrução ao banco.
- Ambiguidade, divergência ou ausência de identidade documental forte sempre volta para confirmação humana ou criação manual.
- Antes da ativação, cobrir por testes concorrência, reprocessamento, lembretes, parcelas, boleto reutilizado indevidamente e rollback.
