# Plano — Localização contínua em celular empresarial

**Estado:** reaberto para implementação e piloto técnico
**Decisão inicial:** 30/10/2026
**Retomada:** 30/10/2026, por decisão expressa do programador
**Prioridade atual:** concluir o Coala Go e o fluxo de rastreio durante jornadas configuradas
**Condição operacional:** gate global autorizado em 30/10/2026; todos os turnos atuais continuam `disabled`, e a coleta só começa após configuração nominal de um turno como `workday`

## 1. Objetivo atual

Concluir no Coala Go o acompanhamento da localização de celulares empresariais durante uma jornada explicitamente configurada como **Entre unidades** + **Durante a jornada**. A finalidade técnica é oferecer suporte operacional e histórico para revisão humana; a localização não valida, autoriza nem impede a batida.

Este plano não autoriza monitoramento permanente, oculto ou fora da jornada. Também não autoriza usar localização para advertência, desconto, falta, folha, decisão disciplinar ou alteração automática do registro de ponto.

## 2. Histórico e retomada

A implantação pontual foi concluída primeiro para separar a localização da batida do acompanhamento contínuo. O plano foi arquivado temporariamente porque o acompanhamento amplia finalidade, volume, retenção, acesso e consumo de bateria. Em 30/10/2026 o programador determinou a retomada no mesmo trabalho do ajuste do Coala Go. Na mesma data, confirmou expressamente que a autorização de LGPD já existe, determinou remover o aviso redundante e autorizou finalizar implementação, commit e rollout. O gate global pode ficar ligado; política nominal, turno elegível, lease curta e aplicativo oficial permanecem cumulativos, e todos os turnos existentes continuam sem coleta.

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

A existência desse código não ativa rastreio por si só. O gate será publicado ligado por autorização expressa, mas nenhum turno atual possui política `workday`; uma ativação futura continua nominal, auditada e versionada.

Na retomada local de 30/10/2026, o primeiro bloco foi implementado: autorização nominal da conta Google empresarial no cadastro, preflight contra e-mail/provedor já usados, vinculação do Google Workspace ao mesmo UID, revogação das sessões anteriores e entrada pelo Credential Manager no Coala Go. O fluxo ainda depende de configurar o mesmo OAuth Web Client ID no build Android e no segredo App Hosting, publicar a candidata e homologar a troca em aparelho real; nenhuma migração foi executada em produção.

## 4. Decisões e gates antes da ativação real

1. Definir finalidade específica e demonstrar por que captura pontual ou declaração de deslocamento não bastam.
2. Delimitar aparelhos, pessoas, funções, turnos e horários elegíveis.
3. Definir se o objetivo é segurança do aparelho, logística entre unidades ou acompanhamento de jornada; não misturar finalidades.
4. Obter análise trabalhista e de LGPD, incluindo necessidade, proporcionalidade, base legal e transparência.
5. Aprovar RIPD, política interna, comunicação aos trabalhadores e eventual instrumento contratual ou coletivo.
6. Definir frequência, precisão, retenção, descarte, acesso pelo titular, perfis internos, auditoria e contestação.
7. Decidir se haverá mapa de percurso, apenas posições isoladas ou alertas operacionais, sem automatizar efeitos disciplinares.
8. Confirmar distribuição do aplicativo e compatibilidade com as políticas vigentes do Android e da Google Play.

Decisões técnicas já adotadas para a candidata:

- alvo operacional: qualquer aparelho com Coala Go oficial e pessoa autenticada pode acompanhar uma jornada cuja política permita rastreio; a classificação empresarial é uma segurança administrativa adicional, não um requisito da coleta;
- somente turno `executionUnitPolicy=free` e `locationTrackingPolicy=workday`;
- todos os turnos existentes permanecem sem coleta até configuração nominal posterior; não há migração que ative localização em massa;
- início após batida classificada como início da jornada;
- pausa no início do intervalo, retomada na volta e encerramento no fim da jornada;
- coleta adaptativa orientada por atividade e movimento, com limites mínimos e máximos definidos pelo servidor;
- serviço foreground com indicador obrigatório e encerramento manual sempre disponível;
- limite automático duas horas após o fim escalado, nunca além da janela aceita pelo servidor;
- falha de permissão, GPS, rede ou rastreio nunca bloqueia nem invalida o ponto;
- nenhuma consequência automática em PTRP, folha, banco, ausência ou disciplina;
- gate global e política nominal da unidade continuam obrigatórios.

Limitações registradas para o piloto:

- revogação remota e kill switch chegam somente quando o aparelho volta a se comunicar. Uma batida preservada offline encerra localmente o acompanhamento para não iniciar ou manter coleta com opções antigas. Antes de ativar, decidir entre uma lease curta renovada pelo servidor ou a aceitação formal da janela residual de um aparelho ativo que perdeu rede sem produzir nova batida;
- atestação do Coala Go não prova que o celular pertence à empresa. Isso não impede o rastreio por jornada: a ativação operacional depende do usuário, do turno e da política nominal. O vínculo empresarial/MDM identifica separadamente os equipamentos corporativos e poderá sustentar uma política futura centrada no aparelho, que não faz parte desta implantação.

Pendências jurídicas nomeadas, sob validação da equipe jurídica do programador e sem automação disciplinar no código:

- registrar no dossiê interno a base legal/RIPD e a ciência geral já aprovada para o acompanhamento durante a jornada;
- ratificar a retenção de 1.825 dias da trilha operacional ou definir prazo menor antes de ativar o primeiro turno;
- ratificar o Google como operador, a eventual transferência internacional e a informação ao trabalhador;
- documentar o canal de acesso/contestação do titular;
- validar contratualmente o cache de endereço do Google por no máximo 30 dias. A implementação usa TTL no banco `coala-rep-p`, cota diária e falha fechada para endereço; coordenada e ponto não dependem da geocodificação.

## 5. Regras funcionais consolidadas

### 5.1. Modos de localização do turno

Cada versão efetiva do turno deve guardar uma das políticas abaixo. A jornada copia a política vigente quando é iniciada; alterações futuras no modelo não reescrevem jornadas abertas ou históricas.

1. **Sem coleta:** o Coala Go não solicita posição para a jornada nem inicia serviço de acompanhamento.
2. **Somente na batida:** faz uma tentativa pontual em cada batida, sem impedir o registro se não houver posição.
3. **Durante a jornada:** habilita a tentativa pontual da batida e o acompanhamento adaptativo somente dentro da janela autorizada.

A política não é inferida pelo nome do turno, unidade ou pessoa. Todos os turnos atuais partem de **Sem coleta** e qualquer ativação futura deve ser explícita, auditada e versionada.

### 5.2. Condições cumulativas do acompanhamento

O rastreamento contínuo somente inicia quando todas as condições forem verdadeiras:

- gate global ativo;
- jornada real e elegível em andamento;
- cópia da política da jornada igual a `workday`;
- Coala Go oficial, íntegro, autenticado pelo mesmo UID e com versão mínima aceita;
- permissão de localização e localização do Android disponíveis;
- lease curta e válida emitida pelo servidor.

O vínculo empresarial não participa dessa decisão. Sem vínculo, o rastreio por jornada funciona normalmente no aparelho em que a pessoa estiver autenticada. Se outra pessoa entrar no mesmo aparelho, passam a valer exclusivamente a jornada e a política dessa nova pessoa. Logout ou troca de usuário encerram a coleta da sessão anterior.

### 5.3. Janela de coleta

- inicia após a batida confirmada como início da jornada;
- pausa no início do intervalo e retoma na volta;
- encerra imediatamente na batida de fim, no encerramento do ciclo, na revogação local ou no limite de segurança;
- nunca coleta antes da jornada, depois dela ou em dias sem jornada elegível;
- turno excepcional usa a política copiada para aquela jornada, sem herdar por semelhança;
- restauração, logout, troca de usuário, revogação e perda da lease interrompem a coleta;
- ponto offline preservado que encerre a jornada também encerra localmente o serviço.

### 5.4. Permissão no Android

O Coala Go pode pedir a permissão persistente de localização na experiência inicial do aplicativo, independentemente do turno daquele dia, para evitar nova preparação no momento do trabalho. A pessoa escolhe a opção oferecida pelo Android; o aplicativo não consegue concedê-la sozinho.

Permissão concedida não equivale a coleta. O Coala Go só acessa a localização quando a política da jornada e os demais gates autorizarem. Não repetir aviso interno com o texto “Ao confirmar, o aplicativo fará uma leitura pontual de localização. O ponto será registrado mesmo sem localização”; a transparência geral já ocorre no fluxo de privacidade aprovado e o diálogo nativo do Android continua obrigatório. Para segundo plano, respeitar o fluxo em etapas exigido pela versão do Android e manter a notificação do serviço foreground.

## 6. Coleta adaptativa e interpretação do deslocamento

### 6.1. Estratégia

Sensores locais decidem quando uma posição GPS agrega informação. O aparelho processa as amostras brutas e envia somente localização, mudança de estado e resumos mínimos; acelerômetro e giroscópio em alta frequência nunca são transmitidos continuamente.

Parâmetros iniciais para medir no piloto, ajustáveis pelo servidor:

- parado: posição aproximadamente a cada 20–30 minutos;
- caminhando: a cada 3–5 minutos ou 100–200 m;
- em veículo: a cada 1–2 minutos ou 300–500 m;
- mudança de atividade, movimento significativo, entrada/saída de área ou desvio relevante: posição imediata, sujeita a antirruído;
- intervalo máximo de segurança: nenhuma sessão ativa fica indefinidamente sem tentar uma posição;
- deduplicação local: não enviar pontos equivalentes dentro da tolerância de precisão, tempo e deslocamento;
- lote idempotente e fila offline limitada, cifrada e com descarte conforme retenção.

### 6.2. Sinais candidatos

O inventário de sensores do aparelho define o que pode ser usado. A candidata pode combinar:

- posição, precisão, velocidade, direção, altitude e idade da leitura;
- distância, velocidade e aceleração derivadas entre pontos;
- entrada, saída e permanência em geofence;
- atividade reconhecida: parado, caminhando, correndo, bicicleta e veículo, com confiança e transições;
- aceleração linear, gravidade, vetor de rotação e giroscópio quando disponíveis;
- intensidade, variância, frequência de movimento, solavanco e possível impacto;
- orientação do aparelho: vertical/horizontal, inclinação e tela para cima/baixo;
- passos, cadência e movimento significativo;
- estado de bateria, carregamento, economia de energia, rede e qualidade da localização;
- indicação de localização simulada e sinais de integridade.

Orientação é do aparelho, não da pessoa: “aparelho deitado” nunca pode ser convertido em “colaborador deitado”. Sensores servem para economia, qualidade do trajeto e contexto operacional; não geram conclusão disciplinar ou biométrica.

## 7. Geocodificação e orçamento operacional

### 7.1. Política

As coordenadas são a fonte do trajeto. Conversão em endereço ocorre somente para eventos relevantes:

- início e fim de deslocamento;
- entrada e saída de unidade;
- parada relevante fora das unidades;
- ocorrência excepcional;
- ponto que um gestor autorizado efetivamente abrir e que ainda não possua endereço válido em cache.

Não geocodificar cada amostra, não consultar o Google novamente a cada abertura e não armazenar além do permitido pelo contrato aplicável. Aplicar cache permitido, cota diária, teto mensal, telemetria e circuit breaker. A ausência de endereço não remove a coordenada nem impede o ponto.

### 7.2. Estimativa-base por aparelho

Hipótese de planejamento: 8 horas por dia, 22 dias trabalhados e todos esses turnos configurados para coleta contínua.

- aproximadamente 1.700–2.100 tentativas úteis de localização por mês;
- meta de até 5 geocodificações por dia trabalhado, cerca de 110 por mês;
- perfil quase sempre parado: 25–45 posições por dia;
- perfil moderado: 70–130 posições por dia;
- perfil muito móvel: 180–300 posições por dia;
- referência antiga fixa a cada 2 minutos: 240 posições por jornada de 8 horas, 5.280 por mês.

Sensores processados localmente não têm cobrança por leitura. Custos diretos surgem em gravações, leituras, armazenamento, tráfego, mapa e geocodificação. A expectativa incremental de um aparelho permanece próxima de zero dentro das franquias atuais; a estimativa deve ser recalculada com o uso global do projeto antes do rollout. Se apenas parte dos turnos usar acompanhamento, o volume cai proporcionalmente.

Preflight Firestore: no perfil moderado, 70–130 eventos gravados por jornada × 22 dias = 1.540–2.860 escritas mensais por aparelho rastreado. A consulta não usa polling nem listener global: cada abertura explícita lê no máximo 21 documentos (20 exibidos + cursor) e grava uma auditoria. Com duas aberturas por jornada, a referência é até 924 leituras e 44 auditorias por mês/aparelho. A geocodificação seleciona até 5 marcos por abertura, mas a cota global de produção limita novas chamadas a 100/dia e o cache válido evita repetição.

## 8. Aparelho empresarial e MDM

### 8.1. Administração do Android

O Google Workspace Business Plus com gerenciamento avançado e Managed Google Play é a camada administrativa escolhida para os aparelhos da empresa. O Coala Go privado é distribuído pelo Managed Google Play e pode ser instalado/atualizado conforme a política da unidade organizacional.

O MDM e o Coala One têm papéis distintos:

- Google Workspace: inventário corporativo, política Android, instalação do aplicativo, bloqueio e estado gerenciado;
- Coala One: relação operacional entre instalação do Coala Go e usuário, elegibilidade da jornada, lease, auditoria e visualização do rastreio.

Não haverá vínculo obrigatório entre rastreamento e patrimônio `PAT-000008`. Patrimônio e aparelho rastreador podem coexistir, mas são cadastros independentes.

### 8.2. Vínculo no Coala Go

1. O Google instala o Coala Go no aparelho gerenciado.
2. A pessoa entra com sua conta autorizada.
3. O aplicativo oferece `Vincular este aparelho empresarial`.
4. Uma solicitação com identidade da instalação, atestação e dados técnicos mínimos chega ao Coala One.
5. Um administrador autorizado aprova, rejeita, suspende ou substitui o aparelho.
6. O servidor relaciona usuário, instalação e status empresarial e registra ator/data. A lease de rastreio é emitida separadamente quando a jornada da pessoa autenticada exigir, com ou sem classificação empresarial.

Login sozinho nunca classifica um telefone como empresarial. Limpar dados, reinstalar ou restaurar o aparelho elimina a chave privada local; o vínculo anterior fica sem comunicação/revogado e uma nova identidade precisa ser aprovada. Managed configuration e atestação podem reduzir trabalho futuro, mas não devem reativar silenciosamente uma chave nova.

### 8.3. Registro e auditoria

Guardar somente identificadores necessários:

- UID do usuário;
- ID interno aleatório da instalação e chave pública;
- status `pending`, `active`, `suspended`, `revoked` ou `replaced`;
- versão do app, plataforma, integridade/gerenciamento disponíveis e última comunicação;
- criação, aprovação, suspensão, substituição e respectivos atores;
- nunca IMEI, número de série ou telefone como chave operacional quando não forem indispensáveis.

## 9. Migração do acesso da Heucilene para Google empresarial

### 9.1. Estado verificado

- UID atual: preservar sem alteração;
- login principal atual: `heucillennysantos@gmail.com`;
- provedor atual: e-mail e senha, conta ativa e e-mail verificado;
- conta empresarial pretendida: `heucilene@coalashakes.com`;
- objetivo: vincular Google Workspace ao usuário existente, sem criar outro cadastro e sem mover documentos ou registros.

### 9.2. Fluxo de migração

1. Heucilene entra pelo login atual.
2. O Coala Go apresenta `Migrar acesso para conta empresarial` somente para uma migração previamente autorizada.
3. Ela confirma novamente a sessão atual e escolhe `Continuar com Google`.
4. O Google devolve uma identidade verificada; o backend exige o e-mail empresarial esperado e o domínio `coalashakes.com`.
5. Preflight recusa se o provedor Google ou o e-mail corporativo já pertencerem a outro UID.
6. A credencial Google é vinculada ao mesmo UID; o e-mail principal passa a ser o corporativo.
7. Tokens anteriores são revogados e o aplicativo exige uma entrada nova pelo Google.
8. O login por senha permanece como contingência por até sete dias, somente se essa janela for aprovada no momento do rollout.
9. Após uma entrada Google confirmada, remover o provedor por senha e registrar conclusão auditada.

Decisão adicional de 30/10/2026:

- qualquer pessoa ainda autenticada por senha poderá usar, no Perfil, `Vincular minha conta Google`; uma conta pessoal escolhida livremente exige sessão de senha recente, e o servidor impede e-mail ou provedor já usado por outro UID;
- uma conta Workspace previamente autorizada no cadastro continua nominal e exata;
- para Heucilene, `heucilene@coalashakes.com` será marcada como migração obrigatória. Após atualizar o aplicativo, ela verá uma tela guiada antes da navegação, com três etapas, barra de progresso determinada e mensagens de espera; a migração preserva o UID e não cria outro usuário;
- indisponibilidade de rede não bloqueia o ponto offline: a obrigatoriedade só é aplicada depois que o servidor confirma o estado de migração.

O botão Google geral não pode criar automaticamente uma conta de colaborador. Para usuários existentes, deve vincular ou resolver uma autorização nominal; para novos usuários, o backend precisa de convite/cadastro prévio. Erros ou cancelamento deixam a conta original intacta.

### 9.3. Trabalho de autenticação

- habilitar provedor Google no Firebase Authentication e configurar OAuth/SHA-256 dos builds oficiais;
- usar Credential Manager/Google ID no Android e vinculação suportada pelo Firebase;
- criar contrato server-authoritative de preflight, autorização nominal, conclusão e auditoria;
- registrar no cadastro do colaborador o login corporativo aprovado sem expor tokens;
- tratar `credential-already-in-use`, `email-already-exists`, sessão antiga, cancelamento e rollback;
- testar preservação do UID, permissões, documentos, ponto, notificações, desbloqueio local e fila offline;
- oferecer recuperação administrativa sem permitir troca arbitrária de e-mail pelo usuário.

## 10. Acesso aos dados, retenção e visualização

- localização aparece somente no detalhe do dia/turno cuja política autorizou coleta;
- dias e turnos sem coleta não exibem painel vazio nem sugerem ausência indevida;
- acesso restrito por permissão, finalidade e organização, com auditoria de quem visualizou;
- visualização deve distinguir posição medida, precisão, endereço derivado e atividade inferida;
- trajetos não aparecem em listagens gerais, notificações, exportações comuns ou logs;
- retenção detalhada, agregação posterior, descarte e `legalHold` ainda precisam de prazo aprovado antes da ativação;
- titular deve ter canal de acesso e contestação definido pela política interna;
- falha, lacuna ou aparelho desligado aparecem como indisponibilidade técnica, nunca como ausência do trabalhador.

## 11. Trabalho técnico da retomada

1. Revisar o código existente contra as versões atuais do Android e das políticas da loja.
2. Testar em aparelhos empresariais reais, especialmente Samsung, com tela apagada, Doze, economia de bateria, reinício e perda de rede.
3. Medir consumo de bateria, dados e taxa real de amostras antes de escolher a frequência.
4. Finalizar uma consulta restrita e auditada, com minimização de coordenadas e sem exposição em listas ou logs genéricos.
5. Implementar retenção e eliminação verificáveis, inclusive exceção formal de `legalHold`.
6. Preparar piloto nominal pequeno, reversível e com botão de encerramento sempre disponível.
7. Validar kill switch, revogação de política e exclusão de eventos posteriores à interrupção.
8. Submeter toda mudança de ponto eletrônico à revisão obrigatória do Doc Brown antes de commit.

9. Implementar política de turno versionada e preservar todos os turnos atuais como `none`.
10. Implementar vínculo empresarial e aprovação como classificação independente; implementar lease curta e revogação vinculadas à sessão, à pessoa e à jornada.
11. Implementar coleta adaptativa, deduplicação e telemetria de bateria/qualidade/custo.
12. Implementar geocodificação seletiva com cache, cotas e circuit breaker.
13. Implementar migração nominal do login da Heucilene e, depois de homologada, fluxo reutilizável por convite.
14. Atualizar detalhes do dia para exibir localização somente nos turnos autorizados.
15. Validar distribuição e atualização pelo Managed Google Play.

## 12. Verificações e critérios de aceite

- turno `none`: zero acesso à localização durante toda a jornada;
- turno pontual: tentativa somente nas batidas;
- turno contínuo em aparelho pessoal ou empresarial: coleta apenas entre início/retorno e intervalo/fim;
- troca de usuário no mesmo aparelho aplica somente a política da nova pessoa e jamais reaproveita a autorização operacional da sessão anterior;
- aprovação empresarial, isoladamente, não inicia nem prolonga rastreio;
- encerramento offline, revogação, logout e troca de usuário param o serviço;
- sensores reduzem pontos redundantes sem criar lacunas além do intervalo máximo;
- nenhuma amostra bruta de movimento é enviada ao servidor;
- geocodificações ficam dentro do teto e ausência de endereço não quebra a tela;
- detalhe do dia oculta localização de turnos não autorizados e audita visualizações autorizadas;
- migração Google mantém exatamente o mesmo UID e todo o histórico;
- tentativa de usar a conta Google em outro UID é bloqueada sem mesclar dados;
- restauração do aparelho não reaproveita a chave antiga;
- testes físicos cobrem Samsung, tela apagada, Doze, economia de bateria, reinício, GPS desligado e perda de rede;
- revisão de segurança, privacidade, custo e Doc Brown concluída antes do commit/ativação conforme o estágio aplicável.

## 13. Custos a reavaliar

O GPS do aparelho e o armazenamento básico não exigem uma chave específica do Google Maps. O custo variável depende de volume de eventos, leituras, armazenamento, tráfego, mapas exibidos e eventual geocodificação. Coordenadas não devem ser convertidas em endereço a cada amostra; essa escolha multiplicaria custo e compartilhamento de dados com terceiros.

Uma futura análise deve usar quantidade real de aparelhos, duração diária e frequência desejada. Também deve comparar desenvolvimento próprio com uma solução MDM adequada, sem presumir que a Android Management API autorize uso interno dedicado exclusivamente a monitoramento.

## 14. Ordem de implantação

1. Consolidar contratos e plano, mantendo o gate desligado.
2. Implementar e testar migração Google preservando UID.
3. Implementar vínculo empresarial e aprovação no Coala One.
4. Versionar política dos turnos e confirmar baseline `none`.
5. Implementar coleta adaptativa e geocodificação seletiva.
6. Concluir detalhe do dia, auditoria, retenção e controles de acesso.
7. Distribuir build privado de teste pelo Managed Google Play.
8. Homologar primeiro com Heucilene e um aparelho empresarial, sem efeito em ponto/folha.
9. Medir bateria, amostras, geocodificações, custo, falhas e encerramento.
10. Obter validações restantes e autorização específica para ativar o gate nominal.
11. Expandir por turno e aparelho, nunca por ativação global automática.

## 15. Critérios para ativar

O gate global só pode ser ligado quando houver, conjuntamente:

- pedido expresso do programador para ativar a coleta real, além desta retomada técnica;
- finalidade e população-alvo aprovadas;
- parecer jurídico/privacidade registrado e pendências críticas resolvidas;
- desenho de acesso, retenção e contestação aprovado;
- plano de piloto físico com responsáveis e critérios de interrupção;
- candidata Android distribuída e ensaiada nos aparelhos empresariais definidos.

Até lá, concluir e validar o código, mas manter o gate desligado.

## 16. Alternativa futura — Coala Ponto em tablet ou celular da unidade

Em 30/10/2026 foi registrada uma alternativa para reduzir a necessidade de usar localização como apoio operacional: disponibilizar um aplicativo dedicado, derivado do Coala Go, em um tablet ou celular empresarial que permaneça fisicamente na unidade. O dispositivo seria previamente vinculado à unidade e habilitado exclusivamente para o registro de ponto.

Essa alternativa deve ser tratada em chamado próprio antes de qualquer implementação. Ela pode reaproveitar o REP-P, a Hora Legal Brasileira, comprovantes, contratos de API, fila offline e componentes do Coala Go, mas deve possuir interface e autenticação específicas para o modo quiosque.

### 16.1. Métodos de identificação decididos para exploração

1. **Reconhecimento facial:** método preferencial no dispositivo da unidade, com prova de vida e confirmação do colaborador antes da batida.
2. **PIN fixo + código rotativo:** alternativa em dois fatores. Cada colaborador possui um PIN pessoal fixo. O Coala Go autenticado no celular pessoal gera um código numérico temporário, individual, válido por 60 segundos e de uso único. No quiosque, o colaborador informa o PIN fixo e o código de validação rotativo.
3. **QR temporário:** pode transportar o mesmo código rotativo para evitar digitação; o código numérico continua disponível como alternativa.

O PIN não é rotativo. Somente seu código de validação muda. O PIN deve ser armazenado exclusivamente como derivação criptográfica adequada, nunca em texto aberto. A exibição do código rotativo no Coala Go pode exigir a biometria nativa do celular pessoal.

### 16.2. Digital nativa — limitação técnica

A digital cadastrada no Android ou iPhone não pode ser exportada pelo Coala Go nem reutilizada para identificar a pessoa em outro tablet. O sistema operacional apenas confirma que alguma biometria autorizada no aparelho foi validada; não entrega a imagem, o molde ou a identidade da digital ao aplicativo.

Identificação individual por digital em um quiosque exigiria leitor biométrico externo compatível, SDK do fabricante e cadastro próprio realizado no mesmo ecossistema do leitor. Essa opção não integra o desenho inicial; facial e PIN fixo com código rotativo são os métodos escolhidos para estudo.

### 16.3. Fluxo facial

1. O colaborador cadastra o rosto pelo próprio Coala Go, em sessão autenticada, com captura orientada e prova de vida.
2. No quiosque, seleciona `Registrar ponto` e realiza nova prova de vida.
3. O sistema identifica o colaborador, apresenta nome e ação sugerida — entrada, intervalo, retorno ou saída — e exige confirmação.
4. O servidor aplica as regras atuais do REP-P, registra a batida pela hora oficial e disponibiliza o comprovante.

### 16.4. Fluxo PIN fixo + código rotativo

1. O colaborador abre o Coala Go no celular pessoal autenticado.
2. O aplicativo pode exigir biometria nativa antes de mostrar o código.
3. O Coala Go apresenta código numérico individual válido por 60 segundos.
4. No quiosque, o colaborador informa o PIN fixo e o código temporário, ou lê o QR equivalente.
5. O servidor valida PIN, validade, vínculo com o colaborador, uso único, dispositivo da unidade, limite de tentativas e hora oficial.
6. Após confirmação da pessoa, a batida é registrada e o código é invalidado contra repetição.

Esse fluxo comprova a combinação de conhecimento do PIN com posse da sessão autenticada no celular. Não deve ser descrito como prova absoluta de presença ou autoria; seus limites e os do reconhecimento facial devem constar da análise de risco.

### 16.5. Contingências a desenhar

- falha do facial: usar PIN fixo + código rotativo;
- ausência do celular pessoal: usar facial;
- falha simultânea dos dois métodos: exceção temporária autorizada por responsável, com motivo e auditoria;
- dispositivo da unidade indisponível: liberação temporária para bater pelo Coala Go pessoal, delimitada por pessoa, unidade e prazo;
- internet indisponível: fila offline assinada, com autorização emitida previamente, proteção contra repetição e sincronização posterior;
- troca ou perda do celular pessoal: revogar o aparelho anterior e vincular outro por fluxo autenticado;
- esquecimento ou comprometimento do PIN: redefinição autenticada, invalidação imediata do anterior e trilha de auditoria.

Nenhuma contingência pode inventar horário, alterar a batida original, impedir o acesso posterior ao comprovante ou misturar dados com outra pessoa.

### 16.6. Proteções mínimas

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

### 16.7. Decisões pendentes para retomada

1. Escolher hardware, versão mínima do Android e estratégia de modo quiosque.
2. Definir fornecedor ou tecnologia de reconhecimento facial e prova de vida.
3. Definir quantidade de dígitos, algoritmo, emissão e verificação do código rotativo.
4. Decidir se o PIN identifica previamente a pessoa ou se haverá identificador separado sem matrícula.
5. Definir operação offline de cada método sem armazenar segredos desnecessários no quiosque.
6. Definir quem concede exceções, duração, escopo e relatórios de auditoria.
7. Validar acessibilidade, iluminação, posicionamento da câmera e desempenho em aparelho físico.
8. Submeter o desenho e qualquer mudança de ponto eletrônico à revisão obrigatória do Doc Brown antes de commit.
