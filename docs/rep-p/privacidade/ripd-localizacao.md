# Relatório preparatório de impacto da localização

Versão 1 para revisão — 27/10/2026, com acréscimos de 02/11/2026 para o termo LGPD v6 (aparelho pessoal, frequência e dados efetivamente coletados e gestão de aparelhos empresariais). Responsável pela aprovação: controladora identificada no vínculo de cada colaborador, com avaliação do responsável de privacidade e jurídico. Não é RIPD aprovado nem liberação de tratamento.

## Escopo e fluxo confirmado

| Tratamento | Dados e percurso | Necessidade a demonstrar |
| --- | --- | --- |
| Captura pontual | Confirmação da batida → captura no dispositivo → avaliação no servidor → `repP_locationEvidence` em banco fiscal dedicado, fora da ARP → consulta auditada | Por que conferência de local exige coordenadas exatas frente a unidade declarada, escala e conferência pelo responsável |
| Acompanhamento entre unidades | Turno elegível → serviço Android visível → eventos de início, amostra, pausa, retomada e fim → `dp_journeyLocationEvents` e sessões no RH → consulta auditada | Por que capturas por evento e declaração de deslocamento não bastam; quais funções e turnos exigem essa modalidade |
| Gestão de aparelhos empresariais | Google Workspace com gerenciamento avançado → inventário, apps gerenciados, políticas, bloqueio/apagamento remoto → vínculo aparelho × usuário no Coala Go com auditoria | Quais ações remotas são necessárias, quem as executa e como evitar acesso a conteúdo pessoal |

Categorias: identidade do colaborador, unidade, datas, horários, latitude, longitude, precisão, disponibilidade do sensor, versão da política e identificadores de eventos. Coordenadas podem revelar contextos pessoais; inferências sobre saúde, religião ou vida privada não fazem parte da finalidade e devem ser vedadas. Listas e documentos fiscais não recebem coordenadas.

A controladora determina finalidade e pessoas autorizadas; RH atende pedidos internos e encaminha questões de privacidade. Backend e Android executam o tratamento conforme configuração. Infraestrutura utiliza serviços Firebase/Google Cloud; contratos, papéis, localização dos dados, suboperadores e mecanismo de transferência internacional devem ser confirmados pelo inventário contratual, sem presumir que região do serviço comprove residência de todo o tratamento.

Aparelho do acompanhamento: o serviço roda no aparelho em que a pessoa estiver autenticada, empresarial ou pessoal; o vínculo empresarial é controle administrativo adicional, não requisito da coleta ([plano](../../planos/plano-monitoramento-continuo-celular-empresarial.md)). Em aparelho pessoal, a expectativa de privacidade é maior e o risco de coleta fora do trabalho também; avaliar separadamente se a modalidade deve ser limitada a aparelhos empresariais. Hoje o serviço usa somente posição, precisão, velocidade e deslocamento do sistema de localização; sensores de movimento e orientação, bateria e rede não são usados, e adotá-los exige nova versão do termo e nova avaliação neste relatório. A geocodificação para endereço aproximado envolve fornecedor de mapas.

## Hipóteses e alternativas

Registrar uma decisão separada para cada tratamento: finalidade concreta, interesse ou obrigação identificada, base legal aplicável, necessidade, expectativa do trabalhador e resultado do balanceamento. Não usar obrigação de registrar ponto como fundamento automático para GPS. Não usar consentimento genérico em relação laboral.

Para eventual legítimo interesse, preencher avaliação documentada de finalidade, necessidade, balanceamento e salvaguardas, identificando alternativas menos invasivas. Hipóteses a comparar: somente unidade declarada; conferência de escala; captura pontual em lugar de amostragem; área aproximada sem coordenada exata; acompanhamento restrito a função ou deslocamento específico. Registrar por que cada alternativa atende ou não à finalidade.

## Limites técnicos e lacunas

- Captura pontual não impede a batida e não muda o original fiscal. A avaliação de área é acessória, sujeita a erro e conferência humana.
- Acompanhamento depende de turno, participante e política. O kill switch permanece falso. O ciclo pausa/retoma/encerra, reconhece e descarta lote tardio após revogação.
- O Android pede posição aos provedores GPS e rede a cada 60 segundos ou 25 metros, mas o serviço grava no máximo um marco a cada 2 minutos em movimento (velocidade de pelo menos 1,2 m/s ou deslocamento de 120 m) e um marco a cada 15 minutos parado, descartando posições com precisão pior que 150 m (`journey-location-lease.server.ts`, `JourneyLocationService.kt`). Não há uso de acelerômetro, giroscópio, orientação, bateria ou rede para decidir a coleta. Medir no Galaxy a frequência efetiva e a duplicidade entre provedores antes de afirmar periodicidade exata.
- Janela técnica de quatro horas antes e duas após escala não representa autorização para coleta fora do trabalho. Avaliar ajuste, horas extras, ausência de encerramento e forma de parada efetiva.
- Consulta usa titular real ou concessão expressa, uma pessoa/unidade/dia/fonte, paginação, motivo e auditoria antes de resposta. Evidências vencidas não são entregues pela consulta comum; consulta e índices ainda precisam de publicação e ensaio no destino.
- Guarda configurada: 1.825 dias para evidências e trilha de acesso. Justificar separadamente o prazo das coordenadas e da auditoria, comparar prazo menor e definir destino após expiração. TTL não garante eliminação imediata nem cobre todos os backups.
- Campo `legalHold` não substitui procedimento de custódia, autorização, bloqueio de descarte, reavaliação e descarte posterior. Verificar essas rotinas antes da ativação e registrar lacunas em vez de considerar a mera presença do campo uma proteção comprovada.

## Riscos e salvaguardas

| Risco | Salvaguarda e evidência atual | Ação ou validação restante |
| --- | --- | --- |
| Consulta por colega, gestor indevido ou suporte | Permissão expressa, UID real, unidade, filtros e auditoria antes da resposta; testes emuladores | Revisão nominal de concessões e IAM no destino |
| Coleta fora do trabalho ou desnecessária | Turno elegível, indicador, pausa e parada; gate desligado | Galaxy, janela efetiva, necessidade/frequência e documentação aprovada |
| Falha de GPS tratada como falta | Batida preservada e ausência de decisão automática | Orientação RH e ensaio de interface/aparelho |
| Retenção excessiva ou descarte incompleto | Expiração, recusa de leitura vencida, dados separados da ARP | Decisão por classe, TTL no destino, backups, eliminação e custódia |
| Inferências indevidas e finalidade ampliada | Uso limitado à conferência humana; sem coordenadas nos fiscais | Política disciplinar, treinamento e revisão de acessos |
| Cópia ou divulgação em canais externos | Sem mapa externo no painel; campos de resposta limitados | Procedimento RH de entrega segura e resposta a incidente |
| Coleta em aparelho pessoal além do esperado | Ciência no termo v6, notificação permanente, encerramento por logout/troca de usuário e fim de jornada | Decisão sobre limitar a aparelhos empresariais, orientação RH sobre recusa e ensaio no aparelho pessoal |
| Inferência a partir de velocidade, deslocamento ou de sinais futuros | Vedação de inferências no termo v6; sensores, bateria e rede fora da coleta atual | Avaliar neste relatório e em nova versão do termo antes de adotar qualquer sinal adicional |
| Bloqueio ou apagamento remoto indevido de aparelho empresarial | Vínculo aprovado por administrador com auditoria; termo de patrimônio orienta não guardar conteúdo pessoal | Definir quem executa ações remotas, motivos admitidos e registro no console do Workspace |
| Dados incorretos, adulterados ou sem precisão | Precisão/status preservados; canal de contestação; origem declarada pelo cliente | Verificar aparelho físico e limites de confiança; não afirmar prova de presença |

Classificação e aceitação do risco residual devem ser preenchidas e assinadas pelo responsável após as medidas e os ensaios. Esta minuta não presume risco baixo nem aceitação da controladora.

## Direitos e resposta

RH recebe documentos e pedidos por canal interno, verifica identidade com minimização, protocola, encaminha, acompanha e entrega por meio individual. O canal formal do termo continua administrativo@coalashakes.com. Documentar pedidos de confirmação, acesso, correção, informação, oposição e eliminação quando aplicáveis, suas restrições legais e a justificativa da resposta. Dados fiscais originais não devem ser reescritos; contestação segue trilha separada.

## Registro de decisão necessário

Antes da liberação, registrar os responsáveis e as decisões: modalidade autorizada; participantes/funções/unidades; finalidade; alternativa escolhida; fundamento; frequência real; janela; guarda por classe; fornecedores e transferências; canal e procedimento de direitos; eliminação/hold/backups; medidas aplicadas; risco residual; data e assinaturas de aprovação; revisão periódica e gatilhos de reavaliação. Enquanto ausentes, a minuta permanece pendente e a coleta real não é liberada por este documento.

Referências: [LGPD](https://www.planalto.gov.br/ccivil_03/_ato2015-2018/2018/lei/l13709compilado.htm), [orientação RIPD da ANPD](https://www.gov.br/anpd/pt-br/canais_atendimento/agente-de-tratamento/relatorio-de-impacto-a-protecao-de-dados-pessoais-ripd), [legítimo interesse ANPD](https://www.gov.br/anpd/pt-br/centrais-de-conteudo/materiais-educativos-e-publicacoes/guia_orientativo_hipoteses_legais_tratamento_de_dados_pessoais_legitimo_interesse), [especificação técnica](../../engineering/time-recording-geolocation.md). Fontes consultadas em 27/10/2026.
