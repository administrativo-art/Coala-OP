# Plano arquivado — Localização contínua e registro presencial em dispositivo dedicado

**Estado:** arquivado para exploração futura
**Decisão:** 30/10/2026
**Prioridade atual:** nenhuma; as duas alternativas não fazem parte da implantação corrente do registro de ponto
**Condição operacional:** manter `DP_JOURNEY_LOCATION_ENABLED=false`

## 1. Objetivo futuro

Avaliar, em trabalho separado, o acompanhamento da localização de celulares empresariais durante uma jornada autorizada. A finalidade, o público abrangido e o efeito operacional ainda precisam ser definidos antes de qualquer ativação.

Este plano não autoriza monitoramento permanente, oculto ou fora da jornada. Também não autoriza usar localização para advertência, desconto, falta, folha, decisão disciplinar ou alteração automática do registro de ponto.

## 2. Motivo do arquivamento

A implantação atual deve concluir o registro pontual de localização associado à batida e o cadastro da área de cada unidade. O acompanhamento contínuo amplia materialmente finalidade, volume, retenção, acesso, consumo de bateria e risco trabalhista/LGPD. Por isso, foi retirado do caminho crítico em 30/10/2026 e será tratado como produto independente quando houver decisão expressa de retomada.

## 3. Situação técnica verificada em 30/10/2026

Já existe uma base local, ainda desativada:

- serviço Android em primeiro plano, com notificação permanente;
- amostragem por tempo e deslocamento durante a jornada;
- início, pausa, retomada e encerramento vinculados às classificações das batidas;
- limite temporal de segurança e interrupção por kill switch;
- fila local e envio em lotes;
- endpoint idempotente e coleções separadas da ARP/PTRP;
- elegibilidade restrita a turno `Entre unidades` com política `Durante a jornada`;
- consulta sujeita a autorização e auditoria.

Fontes principais: `JourneyLocationService.kt`, `JourneyLocationController.kt`, `journey-location.server.ts` e o [guia de geolocalização](../engineering/time-recording-geolocation.md).

A existência desse código não significa que o recurso esteja aprovado, pronto para produção ou juridicamente liberado. O gate de servidor continua desligado e nenhuma ativação integra a implantação atual.

## 4. Decisões necessárias antes da retomada

1. Definir finalidade específica e demonstrar por que captura pontual ou declaração de deslocamento não bastam.
2. Delimitar aparelhos, pessoas, funções, turnos e horários elegíveis.
3. Definir se o objetivo é segurança do aparelho, logística entre unidades ou acompanhamento de jornada; não misturar finalidades.
4. Obter análise trabalhista e de LGPD, incluindo necessidade, proporcionalidade, base legal e transparência.
5. Aprovar RIPD, política interna, comunicação aos trabalhadores e eventual instrumento contratual ou coletivo.
6. Definir frequência, precisão, retenção, descarte, acesso pelo titular, perfis internos, auditoria e contestação.
7. Decidir se haverá mapa de percurso, apenas posições isoladas ou alertas operacionais, sem automatizar efeitos disciplinares.
8. Confirmar distribuição do aplicativo e compatibilidade com as políticas vigentes do Android e da Google Play.

## 5. Trabalho técnico para um futuro piloto

1. Revisar o código existente contra as versões atuais do Android e das políticas da loja.
2. Testar em aparelhos empresariais reais, especialmente Samsung, com tela apagada, Doze, economia de bateria, reinício e perda de rede.
3. Medir consumo de bateria, dados e taxa real de amostras antes de escolher a frequência.
4. Finalizar uma consulta restrita e auditada, com minimização de coordenadas e sem exposição em listas ou logs genéricos.
5. Implementar retenção e eliminação verificáveis, inclusive exceção formal de `legalHold`.
6. Preparar piloto nominal pequeno, reversível e com botão de encerramento sempre disponível.
7. Validar kill switch, revogação de política e exclusão de eventos posteriores à interrupção.
8. Submeter toda mudança de ponto eletrônico à revisão obrigatória do Doc Brown antes de commit.

## 6. Custos a reavaliar

O GPS do aparelho e o armazenamento básico não exigem uma chave específica do Google Maps. O custo variável depende de volume de eventos, leituras, armazenamento, tráfego, mapas exibidos e eventual geocodificação. Coordenadas não devem ser convertidas em endereço a cada amostra; essa escolha multiplicaria custo e compartilhamento de dados com terceiros.

Uma futura análise deve usar quantidade real de aparelhos, duração diária e frequência desejada. Também deve comparar desenvolvimento próprio com uma solução MDM adequada, sem presumir que a Android Management API autorize uso interno dedicado exclusivamente a monitoramento.

## 7. Critérios para desarquivar

O plano só volta para execução quando houver, conjuntamente:

- pedido expresso do programador para retomar;
- finalidade e população-alvo aprovadas;
- parecer jurídico/privacidade registrado e pendências críticas resolvidas;
- desenho de acesso, retenção e contestação aprovado;
- plano de piloto físico com responsáveis e critérios de interrupção;
- worktree e chamado próprios, separados da implantação corrente do REP-P.

Até lá, preservar o código existente sem expandi-lo e manter o gate desligado.

## 8. Alternativa futura — Coala Ponto em tablet ou celular da unidade

Em 30/10/2026 foi registrada uma alternativa para reduzir a necessidade de usar localização como apoio operacional: disponibilizar um aplicativo dedicado, derivado do Coala Go, em um tablet ou celular empresarial que permaneça fisicamente na unidade. O dispositivo seria previamente vinculado à unidade e habilitado exclusivamente para o registro de ponto.

Essa alternativa deve ser tratada em chamado próprio antes de qualquer implementação. Ela pode reaproveitar o REP-P, a Hora Legal Brasileira, comprovantes, contratos de API, fila offline e componentes do Coala Go, mas deve possuir interface e autenticação específicas para o modo quiosque.

### 8.1. Métodos de identificação decididos para exploração

1. **Reconhecimento facial:** método preferencial no dispositivo da unidade, com prova de vida e confirmação do colaborador antes da batida.
2. **PIN fixo + código rotativo:** alternativa em dois fatores. Cada colaborador possui um PIN pessoal fixo. O Coala Go autenticado no celular pessoal gera um código numérico temporário, individual, válido por 60 segundos e de uso único. No quiosque, o colaborador informa o PIN fixo e o código de validação rotativo.
3. **QR temporário:** pode transportar o mesmo código rotativo para evitar digitação; o código numérico continua disponível como alternativa.

O PIN não é rotativo. Somente seu código de validação muda. O PIN deve ser armazenado exclusivamente como derivação criptográfica adequada, nunca em texto aberto. A exibição do código rotativo no Coala Go pode exigir a biometria nativa do celular pessoal.

### 8.2. Digital nativa — limitação técnica

A digital cadastrada no Android ou iPhone não pode ser exportada pelo Coala Go nem reutilizada para identificar a pessoa em outro tablet. O sistema operacional apenas confirma que alguma biometria autorizada no aparelho foi validada; não entrega a imagem, o molde ou a identidade da digital ao aplicativo.

Identificação individual por digital em um quiosque exigiria leitor biométrico externo compatível, SDK do fabricante e cadastro próprio realizado no mesmo ecossistema do leitor. Essa opção não integra o desenho inicial; facial e PIN fixo com código rotativo são os métodos escolhidos para estudo.

### 8.3. Fluxo facial

1. O colaborador cadastra o rosto pelo próprio Coala Go, em sessão autenticada, com captura orientada e prova de vida.
2. No quiosque, seleciona `Registrar ponto` e realiza nova prova de vida.
3. O sistema identifica o colaborador, apresenta nome e ação sugerida — entrada, intervalo, retorno ou saída — e exige confirmação.
4. O servidor aplica as regras atuais do REP-P, registra a batida pela hora oficial e disponibiliza o comprovante.

### 8.4. Fluxo PIN fixo + código rotativo

1. O colaborador abre o Coala Go no celular pessoal autenticado.
2. O aplicativo pode exigir biometria nativa antes de mostrar o código.
3. O Coala Go apresenta código numérico individual válido por 60 segundos.
4. No quiosque, o colaborador informa o PIN fixo e o código temporário, ou lê o QR equivalente.
5. O servidor valida PIN, validade, vínculo com o colaborador, uso único, dispositivo da unidade, limite de tentativas e hora oficial.
6. Após confirmação da pessoa, a batida é registrada e o código é invalidado contra repetição.

Esse fluxo comprova a combinação de conhecimento do PIN com posse da sessão autenticada no celular. Não deve ser descrito como prova absoluta de presença ou autoria; seus limites e os do reconhecimento facial devem constar da análise de risco.

### 8.5. Contingências a desenhar

- falha do facial: usar PIN fixo + código rotativo;
- ausência do celular pessoal: usar facial;
- falha simultânea dos dois métodos: exceção temporária autorizada por responsável, com motivo e auditoria;
- dispositivo da unidade indisponível: liberação temporária para bater pelo Coala Go pessoal, delimitada por pessoa, unidade e prazo;
- internet indisponível: fila offline assinada, com autorização emitida previamente, proteção contra repetição e sincronização posterior;
- troca ou perda do celular pessoal: revogar o aparelho anterior e vincular outro por fluxo autenticado;
- esquecimento ou comprometimento do PIN: redefinição autenticada, invalidação imediata do anterior e trilha de auditoria.

Nenhuma contingência pode inventar horário, alterar a batida original, impedir o acesso posterior ao comprovante ou misturar dados com outra pessoa.

### 8.6. Proteções mínimas

- provisionamento e vínculo verificável entre quiosque, organização e unidade;
- modo quiosque para reduzir uso indevido do aparelho;
- prova de vida e limites de tentativas no facial;
- PIN com derivação criptográfica, bloqueio progressivo e redefinição auditada;
- código temporário de uso único e proteção contra repetição;
- registro do método utilizado, dispositivo, unidade e eventual contingência;
- confirmação explícita da ação antes da batida;
- fila offline segregada e assinada;
- nenhum efeito automático sobre folha, disciplina ou validade da batida por falha de autenticação acessória;
- validação jurídica e de privacidade pela equipe responsável antes de qualquer piloto real.

### 8.7. Decisões pendentes para retomada

1. Escolher hardware, versão mínima do Android e estratégia de modo quiosque.
2. Definir fornecedor ou tecnologia de reconhecimento facial e prova de vida.
3. Definir quantidade de dígitos, algoritmo, emissão e verificação do código rotativo.
4. Decidir se o PIN identifica previamente a pessoa ou se haverá identificador separado sem matrícula.
5. Definir operação offline de cada método sem armazenar segredos desnecessários no quiosque.
6. Definir quem concede exceções, duração, escopo e relatórios de auditoria.
7. Validar acessibilidade, iluminação, posicionamento da câmera e desempenho em aparelho físico.
8. Submeter o desenho e qualquer mudança de ponto eletrônico à revisão obrigatória do Doc Brown antes de commit.
