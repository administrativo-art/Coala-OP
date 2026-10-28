# Política interna de localização no ponto

Minuta para aprovação interna — 27/10/2026. Complementa o termo LGPD v5; não o substitui, não muda documentos assinados e não autoriza ativação. Controladora: a empregadora identificada no termo do colaborador.

## Atendimento pelo RH

O colaborador solicita documentos, cópia de seus dados, esclarecimentos ou correções ao RH pelos canais internos de atendimento já utilizados na empresa. O RH confirma a identidade por meio adequado, registra o pedido e encaminha questões de privacidade ao responsável da controladora. O canal de privacidade previsto no termo continua sendo administrativo@coalashakes.com. Não se exige que o colaborador conheça um fluxo técnico para pedir atendimento.

O pedido recebe protocolo, data, assunto e responsável. O RH acompanha o atendimento, informa o resultado e registra eventual impossibilidade ou restrição fundamentada. Pedidos de confirmação ou acesso seguem os procedimentos e prazos aplicáveis da LGPD, incluindo a declaração completa em até 15 dias prevista no art. 19; isso não cria prazo único para todos os direitos. Não solicitar documentos excessivos para comprovar identidade nem enviar coordenadas a grupo de mensagens. Uma contestação não altera a batida fiscal original; correções e esclarecimentos ficam em registro separado.

## Captura na confirmação da batida

Finalidade proposta: contextualizar o local informado na marcação e apoiar conferência humana. Ao confirmar uma batida, o aplicativo poderá tentar obter latitude, longitude, precisão e horário da captura. O servidor associa a evidência à pessoa, unidade, dia e versão da política. Abrir o aplicativo não inicia a coleta pontual.

Permissão negada, GPS indisponível, baixa precisão, tempo esgotado ou posição fora da área não impedem a batida. A posição não integra o original fiscal, AFD, AEJ ou comprovante. Não há decisão automática sobre pagamento, falta ou punição a partir da localização.

Aviso contextual proposto:

> Ao confirmar esta batida, o aplicativo tentará obter sua localização para conferência humana do local de trabalho. A batida será registrada mesmo sem localização ou fora da área. São tratados coordenadas, precisão e horário, associados à sua marcação e unidade. O acesso é restrito e auditado. Para pedir documentos, consultar seus dados ou esclarecer dúvidas, procure o RH. Consulte o termo LGPD para os detalhes de guarda e os canais de privacidade.

## Acompanhamento entre unidades

Finalidade proposta, sujeita à demonstração de necessidade: apoiar a conferência humana dos deslocamentos de trabalho nos turnos expressamente configurados para atuação entre unidades. Não se aplica a todos os turnos ou colaboradores.

O ciclo acompanha início da jornada, pausa no intervalo, retomada e encerramento; há parada manual. A revogação da política ou desligamento remoto interrompe a coleta. A implementação Android solicita atualizações aos provedores habilitados com mínimos de cinco minutos e 100 metros por provedor; não há garantia de uma amostra exata a cada cinco minutos nem teto conjunto comprovado. A frequência efetiva deve ser medida no Galaxy e aprovada antes da ativação.

Aviso contextual distinto proposto:

> Este turno prevê trabalho entre unidades. Quando o acompanhamento estiver autorizado e configurado, o aplicativo poderá registrar amostras de localização durante o trabalho, com indicador visível, pausa no intervalo e opção de encerrar. As atualizações dependem do tempo, deslocamento e disponibilidade do aparelho. A localização serve à conferência humana e não altera automaticamente seu ponto ou pagamento. Para solicitar documentos ou atendimento, procure o RH.

O limite técnico do servidor de quatro horas antes e duas horas depois da escala não autoriza rastrear fora do trabalho efetivo. Ausência de batida final, horas extras, classificação alterada e reinício devem ser tratados no ensaio e na decisão de necessidade. O acompanhamento permanece desligado até essa aprovação e o teste físico.

## Consulta e proteção

O titular consulta somente seus dados. A consulta de terceiros exige a permissão específica `dp.timeRecording.readLocation`, inclusive para administrador, o acesso ao módulo DP e o escopo da unidade de execução. A autorização para configurar jornada, consultar ponto ou fechar competência não concede acesso às coordenadas.

Cada consulta delimita uma pessoa, uma unidade e um dia, separa captura pontual de jornada e usa paginação. O motivo é escolhido entre atendimento do colaborador, conferência operacional e atendimento de privacidade. Antes da resposta, o servidor registra quem consultou, pessoa consultada, unidade, dia, motivo, fonte e identificadores retornados, sem copiar coordenadas para a auditoria. Falha na gravação da auditoria impede a resposta. Não usar modo de suporte para assumir a titularidade.

O painel não envia posições a mapas externos. Atribuições de permissão devem ser nominais, justificadas e revistas em mudança de função ou desligamento. Infraestrutura e prestadores técnicos devem ser inventariados no RIPD; o acesso operacional por IAM é distinto da permissão de negócio e exige controle próprio.

## Guarda e encerramento

O termo v5 e o código preveem 1.825 dias para as evidências; esse prazo é uma proposta operacional que precisa de justificativa por modalidade e não decorre automaticamente da obrigação de manter o registro de ponto. A consulta comum não retorna evidência vencida, mesmo enquanto a exclusão automática estiver pendente. A trilha de acesso tem expiração de 1.825 dias. Índices e TTL precisam ser publicados e conferidos no destino.

Antes da coleta real, aprovar o procedimento de eliminação, cópias de segurança, eventual suspensão por litígio e descarte após essa suspensão. A presença de `legalHold` no contrato não comprova que todo o procedimento de custódia e eliminação foi implementado. Nenhuma retenção adicional pode ser aplicada informalmente pelo RH.

## Decisões para liberar o tratamento

| Decisão | Responsável pela aprovação | Estado |
| --- | --- | --- |
| Finalidade, necessidade e base legal da captura pontual | Controladora com revisão jurídica | Pendente |
| Necessidade e base próprias do acompanhamento entre unidades | Controladora com revisão jurídica | Pendente |
| Frequência efetiva, limites e janela durante trabalho | Controladora após ensaio físico | Pendente |
| Justificativa para cinco anos de coordenadas e alternativa de prazo menor | Controladora e responsável de privacidade | Pendente |
| RIPD, fornecedores, eliminação, custódia e risco residual | Controladora e responsável de privacidade | Pendente |
| Entrega do aviso e comunicação aos atuais colaboradores | RH após aprovação dos textos | Pendente |

Legítimo interesse é hipótese para avaliação de finalidade, necessidade e balanceamento; não é declarado aprovado por esta minuta. A obrigação de registrar jornada não torna o GPS obrigatório. Assinatura registra ciência, sem consentimento genérico.

Fontes: [LGPD arts. 6, 7, 18, 19, 37, 38 e 46](https://www.planalto.gov.br/ccivil_03/_ato2015-2018/2018/lei/l13709compilado.htm), [ANPD sobre RIPD](https://www.gov.br/anpd/pt-br/canais_atendimento/agente-de-tratamento/relatorio-de-impacto-a-protecao-de-dados-pessoais-ripd), [guia de legítimo interesse da ANPD](https://www.gov.br/anpd/pt-br/centrais-de-conteudo/materiais-educativos-e-publicacoes/guia_orientativo_hipoteses_legais_tratamento_de_dados_pessoais_legitimo_interesse). Consulta em 27/10/2026.
