# Ausências do Departamento Pessoal

## Objetivo e limites

Este fluxo separa quatro responsabilidades:

1. **Configurar** os tipos de ausência e as regras que alcançam cada pessoa.
2. **Solicitar** um período ou horas e anexar a comprovação necessária.
3. **Analisar** o pedido, registrar a decisão e preservar a trilha.
4. **Aplicar** a decisão aprovada na disponibilidade, escala, ponto, indicadores e integrações.

Férias não pertencem a este domínio: continuam no módulo próprio, com aquisição, concessão e efeitos específicos. Pessoa jurídica também não usa ausência trabalhista; eventual indisponibilidade contratual de PJ deve ser tratada em outro fluxo. Os vínculos elegíveis aqui são CLT, Aprendiz e Estágio, cada um com regras configuráveis e sem presumir que compartilham os mesmos limites.

Este documento descreve o plano completo. A implementação atual cobre somente a **Etapa 1**.

## Etapa 1 — catálogo e governança das regras (implementada)

A entrada fica em **Configurações → Pessoal → Tempo → Ausências**. Cada tipo é uma versão imutável depois de publicado e contém:

- nome, descrição e cor;
- solicitação por dia, hora ou ambos;
- quem poderá iniciar: colaborador, gestor, DP ou sistema;
- efeito pretendido na jornada;
- participação ou não no indicador de absenteísmo;
- intenção de bloquear o período na escala quando houver aprovação;
- vigência da versão;
- uma ou mais regras por vínculo e abrangência;
- forma de contagem, limites, antecedência e retroatividade;
- exigência de anexo;
- fluxo de aprovação;
- edição/cancelamento futuro e instruções ao solicitante.

As regras usam a mesma abrangência de Jornadas: empresa, organização, grupo ou unidade, refinada por cargo, função e pessoa. A precedência é **pessoa → função → cargo → abrangência**. Duas regras do mesmo tipo não podem empatar no mesmo nível para vínculos que se interceptam. A simulação por colaborador mostra a regra vencedora sem criar solicitação.

Cada regra pertence exclusivamente ao tipo de ausência em edição. Uma regra criada em **Atestado médico**, por exemplo, não é aplicada a nenhum outro tipo. A tela identifica esse escopo inclusive durante a criação, antes de o novo tipo receber um nome.

Cada bloco do editor possui ajuda contextual aberta por clique ou toque. A unidade da solicitação pode habilitar **Dias**, **Horas** ou ambos; quando ambos estiverem ativos, o pedido futuro escolherá uma unidade por solicitação. Na aba Regras, a ajuda permanece disponível junto a quatro grupos — público e abrangência, contagem e aprovação, limites/prazos/documento e gestão da solicitação — e detalha as opções de cada grupo. Os campos em duas colunas mantêm os controles alinhados mesmo quando um rótulo ocupa duas linhas.

O tipo pode ser identificado por uma paleta ampliada de doze cores. A cor é somente uma distinção visual e não altera precedência, aprovação ou efeito. As instruções ao solicitante podem ser geradas a partir da regra ativa; o texto reflete vínculos, abrangência, unidade, contagem, prazos, anexo, aprovação, efeito e bloqueio da escala, continua editável e só é persistido quando o rascunho for salvo. Para o rascunho existente de **Atestado médico**, a sugestão é preenchida quando ainda não houver instrução gravada.

### Efeito na jornada

O efeito descreve a apuração de tempo da ocorrência aprovada; ele não define sozinho pagamento ou desconto em folha:

- **Ausência justificada:** registra que a pessoa não trabalhou, mas mantém o período classificado como justificado, sem crédito de trabalho ou débito no banco;
- **Ausência não justificada:** mantém o tempo previsto como não cumprido e o encaminha como falta não justificada para os fluxos posteriores de ponto e DP;
- **Crédito como período trabalhado:** considera o período cumprido na jornada, sem marcação de ponto e sem criar hora extra;
- **Débito em banco de horas:** consome do saldo a quantidade aprovada; saldo insuficiente não permite aplicação automática e exige tratamento pelo DP;
- **Revisão manual:** não produz efeito automático até que o DP defina o tratamento da ocorrência.

Na Etapa 1, essas opções são somente configuração. A movimentação efetiva ocorre nas etapas futuras após uma solicitação aprovada e deve ser idempotente e auditável.

### Hierarquia de aprovação

O fluxo é configurado em cada regra por público, depois que vínculo e abrangência definem quem ela alcança:

- **Automática:** o servidor aprova somente depois de todas as validações da regra, sem decisão humana;
- **Gestor:** uma etapa atribuída ao gestor direto vigente do colaborador;
- **Departamento Pessoal:** uma etapa atribuída à fila do DP;
- **Gestor → Departamento Pessoal:** duas etapas sequenciais; o DP só recebe depois da aprovação do gestor.

Uma rejeição encerra as etapas seguintes e respeita a exigência configurada de motivo. Quando o fluxo exigir gestor e não houver um gestor direto válido, o pedido não pode avançar automaticamente nem escolher outro usuário por inferência: fica pendente e sinalizado ao DP. A Etapa 2 deverá congelar no pedido o fluxo e a regra aplicados, mas resolver a autorização de quem decide novamente no servidor em cada ação. Substituição temporária e SLA continuam lacunas de política; nenhum substituto é concedido implicitamente nesta etapa.

```text
rascunho --publicar--> publicado --arquivar--> arquivado
                         |
                         +--duplicar--> novo rascunho versionado
```

Somente rascunhos são editáveis ou excluíveis. A publicação de uma nova versão exige início de vigência posterior, arquiva a versão anterior e encerra sua vigência no dia anterior. Nenhum tipo é criado ou publicado automaticamente.

### Persistência, acesso e API

- Coleção: `dp_absenceTypes`.
- Listagem limitada a 100 documentos, carregada apenas na aba administrativa e sem polling.
- `GET/POST /api/dp/time/absence-types`.
- `GET/PATCH/DELETE /api/dp/time/absence-types/[id]`.
- Escritas e transições geram evento em `actionLogs` com a retenção já usada pelas configurações de Tempo.
- A API exige `dp.settings.manageAbsences` e acesso a todas as unidades. Ocultar a aba não substitui a validação no servidor.

O catálogo armazena apenas configuração. Publicar não cria ocorrência, não altera escala, não lança ponto, não movimenta banco de horas e não calcula folha.

## Etapa 2 — solicitação e documentos

Criar `dp_absenceRequests` com vínculo obrigatório à pessoa, ao tipo e à versão da regra resolvida. O pedido deve guardar um *snapshot* da regra aplicada para que uma publicação posterior não reescreva o histórico.

Entradas previstas:

- colaborador em **Minhas solicitações**;
- gestor ou DP no perfil/central de solicitações;
- sistema por uma integração explicitamente identificada.

```text
rascunho -> enviado -> em análise -> aprovado
                            |          |
                            |          +-> cancelado (quando a regra permitir)
                            +-> rejeitado
                            +-> ajustes solicitados -> enviado
```

Antes do envio, a interface deverá mostrar datas/horas no padrão brasileiro, quantidade calculada, documentos obrigatórios, aprovadores, prazo, retroatividade, limites restantes e o impacto ainda informativo na operação.

Anexos devem ficar em caminho segregado por workspace, pedido e proprietário, sem URL pública. Metadados entram no pedido; conteúdo binário permanece no Storage. Acesso deve exigir vínculo com o pedido e permissão, com auditoria para documento sensível. Uma pasta ampla nunca deve funcionar como autorização.

## Etapa 3 — análise e disponibilidade operacional

Ao aprovar, o servidor deverá criar uma ocorrência imutável de ausência e uma projeção limitada por pessoa e período para a escala. A ocorrência, e não o texto do pedido, será a fonte operacional.

- A ocorrência aprovada bloqueia somente os períodos configurados para bloquear escala.
- A Natasha recebe a projeção como indisponibilidade autoritativa antes de montar ou refazer uma escala.
- Conflito com turno já publicado exige decisão explícita, sem apagar o turno silenciosamente.
- Rejeição ou cancelamento não cria indisponibilidade.
- Reversão preserva o histórico e remove/invalida a projeção por operação idempotente.
- Férias continuam chegando pelo domínio próprio e não são duplicadas como ausência.

A análise deve respeitar escopo de unidade e separar `view`, `review` e eventual permissão para reverter decisão. A regra configurada informa o fluxo, mas o servidor volta a resolver autorização a cada ação.

## Etapa 4 — ponto, folha, integrações e indicadores

Somente depois da ocorrência aprovada e da integração validada:

- projetar justificativa no ponto/Bizneo;
- creditar período trabalhado, debitar banco ou enviar para revisão, conforme o efeito;
- produzir evento para folha sem calcular valor diretamente neste cadastro;
- consolidar absenteísmo apenas quando `includeInAbsenteeism` estiver ativo;
- disponibilizar relatórios por tipo, vínculo, unidade e período;
- reconciliar falhas de integração de forma idempotente, sem polling de coleções completas.

Cada adaptador deve registrar ID externo, tentativa, resultado sanitizado e capacidade de reprocessamento. Erro de integração não pode mudar uma aprovação para rejeição nem expor dados do anexo.

## Regras de produto aprovadas

- Aprendiz é um vínculo próprio e pode receber política de ausência própria.
- PJ fica fora do domínio de ausência trabalhista.
- Estágio pode ser configurado separadamente, sem herdar automaticamente a regra CLT.
- Férias ficam fora desta central.
- Datas apresentadas ao usuário seguem `dd/mm/aaaa`; a API persiste datas civis como `AAAA-MM-DD`.
- Configuração publicada é histórica e imutável; alteração exige nova versão.
- A ausência só afeta a operação depois de uma solicitação/ocorrência aprovada nas etapas futuras.

## Critérios de aceite das próximas etapas

- Nenhum pedido é enviado sem regra única e vigente para a pessoa e a data.
- A regra aplicada fica congelada no pedido.
- As etapas e os aprovadores resolvidos ficam registrados na trilha, com ordem, decisão, autor e data/hora.
- Anexo obrigatório é validado no servidor antes do envio.
- Ações de gestor/DP respeitam permissão e escopo no servidor.
- Aprovar e reverter são idempotentes e auditados.
- A escala recebe apenas ocorrências aprovadas e vigentes.
- Alterações entre competências preservam a continuidade, sem duplicar férias.
- Testes cobrem Aprendiz, exclusão de PJ, precedência, empate, vigência, documento obrigatório, concorrência de decisão e integração com disponibilidade.

## Custo e crescimento

Na Etapa 1, uma abertura da aba faz no máximo 101 leituras de configuração e não usa listener nem polling. Com 5 aberturas por dia por administrador, o teto é 505 leituras/dia por administrador. Validações de escrita leem apenas referências selecionadas e são operações administrativas esporádicas. Antes da Etapa 2, pedidos deverão ser consultados por pessoa/status/período com paginação; nunca por listagem integral da coleção.

## Lacunas antes das próximas etapas

- política concreta de cada tipo, incluindo limites e documentos;
- SLA e substituição de aprovadores ausentes;
- regra de conflito quando já existe escala publicada;
- mapeamento de cada efeito no Bizneo e na folha;
- retenção e classificação LGPD dos anexos por tipo;
- possibilidade e autoridade para reverter aprovação já exportada.

As regras cadastradas devem ser validadas pelo DP/jurídico antes da publicação; o sistema não transforma exemplos de interface em política trabalhista.
