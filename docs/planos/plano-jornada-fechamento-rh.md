# Plano — Ponto, Jornada e Fechamento da Competência

**Produto:** Coala OP / Coala Go

**Status:** fases técnicas 1–6 publicadas; ensaio nominal segregado em validação; coleta oficial, conformidade formal, lançamento total e saída do Bizneo continuam bloqueados

**Última atualização:** 23/10/2026

**Responsável funcional:** RH / Administração

**Titular do sistema:** CT Sorvetes LTDA — CNPJ 14.276.603/0001-25, informado pelo proprietário em 17/10/2026. O e-CNPJ utilizado é o dessa pessoa jurídica; “Coala” identifica o sistema/marca neste plano.

> CT Sorvetes LTDA usa seu e-CNPJ como titular e desenvolvedora do sistema; Coala é a marca/produto. No uso próprio, a CT Sorvetes também é a empregadora destinatária. As amostras criptográficas foram aprovadas no VALIDAR/ITI em 25/10/2026; INPI e atestados definitivos antecedem o piloto com empregados reais. O [estado documental canônico](../rep-p/homologacao/README.md#fonte-canônica-do-estado-documental) prevalece sobre registros históricos deste plano. Este documento não declara conformidade fiscal já alcançada.

## Documentos deste plano

| Documento | Papel |
| --- | --- |
| Este plano mestre | Decisões, fases, PTRP, fechamento, contador e critérios de promoção |
| [REP-P e conformidade](plano-rep-p-controle-de-ponto.md) | Registro original, documentos fiscais, assinaturas e matriz jurídica |
| [Ausências do DP](../engineering/flows/dp-absences.md) | Ausências, efeitos na escala e integração futura com ponto/folha |
| [Escalas do DP](../engineering/flows/dp-schedules.md) | Escala atual, turnos, folgas e validações |
| [Férias](../engineering/flows/vacation-scheduling.md) e [desligamento](../termination-effects-map.md) | Entradas da competência e efeitos sobre vínculos/acessos |

A especificação jurídica e do REP-P fica no documento complementar; PTRP e fechamento ficam neste plano, sem fontes normativas paralelas.

## 1. Objetivo

Construir o ciclo interno completo:

```text
Contrato/regras vigentes + escala histórica + férias/ausências/feriados
                                 +
Coala Go → REP-P → registro original preservado → comprovante / AFD
                                 ↓
PTRP → apuração → ocorrências → tratamento → AEJ / espelho
                                 ↓
Eventos → fechamento versionado → contador → conciliação
```

O sistema registra a jornada real, explica cálculos e preserva evidências. INPI não certifica cálculo trabalhista; validade probatória depende também da configuração, integridade e operação.

## 2. Postura jurídica e responsabilidades

- Aplicar CLT, regulamentação do ponto e instrumentos coletivos efetivamente aplicáveis, por estabelecimento, categoria e vigência.
- CCT/ACT não é autorização necessária para adotar REP-P e não bloqueia o início do núcleo técnico. Consultar instrumentos existentes quando aplicáveis à apuração; não exigir a criação de um acordo coletivo apenas para implementar o ponto.
- REP-P próprio, sem presumir homologação geral pelo MTE. A documentação de conformidade contempla REP-P e PTRP.
- CT Sorvetes LTDA — CNPJ 14.276.603/0001-25 é a titular e desenvolvedora definida para os dois componentes; seu e-CNPJ assina os documentos da desenvolvedora e a empresa será titular no depósito direto ao INPI. Não usar a marca Coala no lugar da razão social.
- Tiago Francisco Brasil Batista é o responsável técnico. O responsável legal que assina o atestado deve ser uma pessoa física com poderes para representar a CT Sorvetes; ambos os campos aplicáveis usam certificados pessoais ICP-Brasil.
- Advogado trabalhista valida enquadramento, regras e instrumentos no início; contador valida eventos, unidades e efeitos de folha. A Fase 7 confirma a implementação final.
- Separar obrigação legal, interpretação pendente e controle técnico escolhido. Fonte e evidência acompanham a obrigação; teste de eficácia acompanha o controle.
- Conferir CNAE/enquadramento com o contador. Uso interno não autoriza comercialização.
- Verificar titularidade e licenças do código; obter cessões quando necessárias, sem presumir cessão de toda dependência de terceiros.
- Este plano não autoriza deploy, migração real, compra de certificados, pagamento de GRU ou publicação.

## 3. Decisões fundamentais

### 3.1. Ponto próprio e transição

Bizneo permanece oficial por estabelecimento até a promoção do Coala. Não haverá conector de batidas para o PTRP nesta implementação; comparação por relatório/exportação. A exportação atual de escala ao Bizneo permanece enquanto necessária.

Preferir mudança oficial na fronteira de competência. Troca ou retorno no meio do período exige consolidação rastreável das duas origens, sem recriar batidas antigas na ARP Coala.

### 3.2. REP-P registra; PTRP trata

Ajuste, abono, pré-assinalação e decisão de folha não reescrevem originais. Ausência aprovada, falta de escala ou de autorização de extra não bloqueiam a coleta. A hora registrada não pode ser substituída pela hora contratual.

### 3.3. Escala atual com memória histórica

Não haverá Escala V2. Distinguir jornada contratual, escala planejada, alterações por férias/ausências/desligamento e trabalho registrado. Retirar pessoa de um turno por ausência não pode apagar a referência necessária para explicar abono, débito ou falta. PTRP lê; não reescreve escala.

### 3.4. Regras por matéria e vigência

Não há precedência universal “contrato → lei → CCT → empresa”. Resolver cada matéria conforme limites legais, instrumento aplicável, condições contratuais e validação jurídica.

Guardar assunto, valor/unidade, fonte, artigo/cláusula, abrangência, vigência e responsável pela validação. Mudança cria versão; não altera silenciosamente períodos anteriores.

### 3.5. Quantidades, não valores

O motor de ponto produz quantidades e natureza dos eventos; contador calcula sua remuneração, incidências e reflexos. Isso não elimina valores monetários já apurados por outros módulos, como metas: estes são integrados com origem, moeda e versão, sem conversão em horas ou recálculo pelo ponto. O contrato de integração distingue horas extras, noturno, intervalo suprimido, ausências, banco e benefícios.

### 3.6. Tolerância

Separar alerta operacional e apuração remuneratória. Respeitar limites aplicáveis por marcação e por dia, sem arredondar originais. Tempo à disposição e atividades particulares exigem regra validada; não são inferidos apenas da presença.

**Decisão do programador (20/10/2026): uma só tolerância, na jornada** (`toleranceMinutes`, 0 a 10 min). Diferença do dia dentro dela não gera débito nem crédito; acima, conta inteira (Súmula 366 do TST). Vale também para os avisos de entrada, saída e intervalo. Saíram a tolerância geral da política de hora extra (`dailyToleranceMinutes`, que fica só nos documentos antigos, sem uso) e as do intervalo no turno. Jornada sem o campo = sem tolerância. **Pendências do Doc Brown (20/10/2026, conforme com ressalvas):** (a) **pergunta ao advogado:** a empresa pode zerar até 10 min diários concentrados numa única marcação, ou cada marcação precisa respeitar 5 min? Até a resposta, o apurador do fechamento deve aplicar |entrada| ≤ 5, |saída| ≤ 5 e soma ≤ tolerância da jornada; hoje a margem única vale só na prévia do Registro de ponto. (b) Na apuração, redução de intervalo (art. 71, Súmula 437) não herda a tolerância do art. 58 §1º; a margem fica só no aviso. (c) Cadastrar o valor em cada jornada antes do uso. (d) Antes do apurador, ler a tolerância congelada na referência do turno e usar a jornada só para turnos antigos.

### 3.6.1. Modalidades de intervalo e avisos na batida (decidido e implementado em 19/10/2026)

Decisão do programador sobre o cadastro do turno; implementação depende das decisões abertas abaixo e de revisão do Doc Brown, porque turno alimenta escala e PTRP.

| Grupo | Modalidade | Regra | Hoje no cadastro |
| --- | --- | --- | --- |
| — | Sem intervalo | — | `none` |
| Fixo | Fixo único | Um horário definido (início e fim) | `fixed` ("Único pré-definido") |
| Fixo | Fixo intercalado | Vários horários definidos | novo |
| Flexível | Livre | Duração total em uma pausa, a qualquer momento do turno | `flexible` |
| Flexível | Intercalado livre | Duração total em 2+ pausas; quantidade definida ou em aberto | novo |
| Flexível | Janela livre | Uma pausa dentro de um período definido | `staggered` ("Intercalado") |
| Flexível | Janela intercalada livre | Duração total dentro do período, em várias pausas (quantidade definida ou em aberto) | novo |

Turnos existentes caem no tipo equivalente sem migração; campos novos: lista de horários (fixo intercalado), quantidade de pausas (número ou em aberto) e tolerância para mais/para menos. Conferir se o export Bizneo aceita mais de dois blocos para o fixo intercalado.

**Avisos na faixa de registro e no painel do dia** (calculados na tela com a hora oficial e o turno escalado do dia; sem leitura recorrente; nunca bloqueiam a batida — art. 74):

- **Fixo:** proximidade do início e do fim de cada horário; durante a pausa, "volte às HH:MM"; após o fim sem retorno, alerta.
- **Livre e intercalado livre:** limite para iniciar = fim do turno − tempo de intervalo que ainda falta. Ex.: turno até 14:00 e 15 min → iniciar até 13:45.
- **Janela livre e janela intercalada:** antes da janela, quando ela abre; dentro, enquanto o intervalo não começou, o **limite para iniciar = fim da janela − tempo de intervalo que ainda falta** (janela até 14:00 e 15 min → até 13:45). A duração vem da jornada/turno de cada pessoa, nunca de valor fixo.
- **Intercalados:** tempo usado × total, pausas feitas × previstas e limite recalculado com o que falta.
- Níveis: informativo (azul) até 15 min antes; atenção (mostarda) a 10 min do limite ou 2 min do fim da pausa; problema (rosado) quando passa do limite sem intervalo, excede total + tolerância ou fica abaixo do mínimo.
- Batidas esperadas = 2 + 2 × pausas; estado (trabalhando/em pausa) pela ordem das batidas do dia.

**Notas explicativas do cadastro** (substituem o texto atual do tooltip "Tipos de intervalo" em `dp-settings-shifts.tsx`, junto com o guia `docs/engineering/flows/dp-configuration.md`):

- **Sem intervalo:** o turno não prevê pausa.
- **Fixo único:** um horário definido de início e fim (ex.: 13:00–13:15). A batida avisa a proximidade do início e do fim.
- **Fixo intercalado:** vários horários definidos (ex.: 11:00–11:10 e 15:00–15:10). Cada pausa tem seu aviso.
- **Livre:** só a duração; a pessoa escolhe quando. A batida mostra até que horas o intervalo precisa começar para caber antes do fim do turno.
- **Intercalado livre:** a duração total pode ser dividida em duas ou mais pausas, em número definido ou em aberto. A batida mostra o tempo usado, o que falta e o limite para iniciar.
- **Janela livre:** uma pausa dentro de um período (ex.: entre 14:00 e 16:00). Enquanto o intervalo não começa, a batida mostra o limite para iniciar dentro da janela (fim da janela menos a duração).
- **Janela intercalada livre:** a duração total dentro do período, em várias pausas (número definido ou em aberto), com o mesmo limite calculado sobre o que falta.
- **Tolerância:** não fica no turno; vale a tolerância única da jornada (seção 3.6). O mínimo legal continua valendo.

**Implementação (19/10/2026):** cadastro com as sete modalidades, tolerância do intervalo (substituída em 20/10/2026 pela tolerância única da jornada, seção 3.6), pausa mínima opcional e quantidade de pausas definida ou em aberto (até 10); avisos na faixa do Registro de ponto. **Limites conhecidos:** a prévia do Registro de ponto lê o cadastro vivo do turno (alterar tolerância ou horários muda o "a conferir" de dias passados); o PTRP/AEJ deve usar o turno congelado ou versionado com modalidade, horários, tolerâncias, quantidade e pausa mínima. Fixo intercalado não aceita pausa depois da meia-noite em turno noturno. O aviso de horário fixo existe sempre (proximidade e pausa não feita), independentemente de tolerância cadastrada. **Ainda em aberto:** horário mínimo para iniciar no livre, antecedência definitiva dos avisos (provisória 15/10 min) e aviso ao gestor (não implementado). **Pergunta ao Doc Brown/advogado:** fracionar o intervalo legal (arts. 71 e 611-A da CLT) em várias pausas é válido fora dos casos previstos, ou o turno deve ter um intervalo legal único e pausas adicionais separadas?

### 3.7. Coleta inicial

Canal preferencial: **Coala Go existente**, Android nativo; canal alternativo: **Coala One web**, com a mesma coleta REP-P e os mesmos controles no servidor. Não criar aplicativo paralelo nem um motor de ponto separado por canal. Registrar origem da marcação, sem mudar sua validade ou cálculo por ter vindo do app ou da web.

O portal web permanece on-line. A contingência foi implementada somente no Coala Go: pré-autorização on-line por até 12 horas, Hora Legal ancorada ao relógio monotônico, preservação local tanto sem rede quanto após indisponibilidade explícita da HLB, bloqueio após reinício, fila cifrada e assinada e envio ordenado. No escopo oficial, o NSR só nasce no servidor; no ensaio, autorização, assinatura e coleções são segregadas e nunca produzem NSR/ARP/AFD/AEJ. Ainda depende de Play Integrity `enforce` e teste físico antes do piloto oficial. Geolocalização foi implementada localmente como extensão do piloto na [especificação técnica](../engineering/time-recording-geolocation.md): coleta somente na batida on-line, sem bloqueio, lista nominal por unidade, evidência separada da ARP e guarda fixa de cinco anos. A fila local não aceita coordenadas. Publicação, cláusula/aditivo, parâmetros reais e teste físico continuam pendentes. Biometria/reconhecimento facial ficam fora do escopo.

### 3.8. Estágios

| Estágio | Dados/coleta | Referência operacional |
| --- | --- | --- |
| Desligado | Sem coleta Coala | Bizneo |
| Teste | Pessoas/jornadas sintéticas, ambiente isolado, certificado de teste | Nenhum efeito oficial |
| Piloto paralelo | Empregados reais, após conformidade formal | Bizneo; Coala comparativo |
| Oficial | Coala promovido por estabelecimento | REP-P/PTRP Coala |

Backend valida estágio/origem antes de folha, benefícios, indicadores e comunicação externa. Teste e piloto não produzem esses efeitos automaticamente.

Piloto real produz dados pessoais e pode produzir prova. Divergência que indique trabalho real deve ser apurada e encaminhada ao processo oficial quando cabível; a classificação “piloto” não permite ignorá-la.

### 3.9. Experiência de ponto e documentos no aplicativo e na web

Ampliar o Coala Go nativo em `apps/coala-one-android`, reutilizando autenticação, navegação e componentes existentes, conforme [guia do app](../design/app.md). Entrada **Ponto**, com as seguintes entregas. Estado em 22/10/2026 (sem teste em aparelho): itens 1 e 2 implementados para o mês corrente e anteriores; item 3 inclui comprovante individual, espelho e ZIP limitado do mês selecionado com índice de completude; item 4 implementado para comprovante, espelho e ZIP; item 5 implementado com saldo provisório/fechado, ciclo e extrato. A pasta de documentos pessoais permanece exclusivamente no Coala One. Solicitações (ausência, vale-transporte e troca de turno) ficaram nativas:

1. **Hoje / bater ponto:** identidade do colaborador, estabelecimento, data/hora e ação de registro; mostrar confirmação somente após persistência. Exibir marcação registrada e acesso ao respectivo comprovante. Distinguir falha de registro, registro persistido com comprovante pendente e comprovante disponível; recuperação não pode duplicar batida nem aguardar indefinidamente sem alerta/contingência.
2. **Histórico:** linha do tempo de hoje, seleção de outro dia e intervalo de datas, com marcações originais, origem app/web/terminal e tratamentos identificados separadamente. Turno planejado, jornada de referência e trabalho apurado aparecem com rótulos distintos; dia em andamento é parcial, não fechamento definitivo. Considerar fuso do estabelecimento e jornadas que atravessam meia-noite.
3. **Documentos:** abrir, visualizar e baixar comprovante PDF de cada batida; selecionar dia ou período para consultar e exportar os comprovantes disponíveis. Resumo diário/período é relatório de consulta, não substitui os comprovantes individuais assinados nem o espelho. Mostrar tipo, período, versão e estado de emissão/fechamento.
4. **Compartilhar:** selecionar comprovante, espelho ou conjunto; usar compartilhamento nativo do Android para WhatsApp, e-mail e demais apps instalados. Usuário escolhe destino e destinatário e confirma no aplicativo escolhido; não há envio automático nem garantia de entrega. Sem aplicativo compatível, oferecer salvar/baixar. Cancelar o compartilhamento não altera ponto nem documento.
5. **Banco de horas:** saldo, extrato, memória do débito/crédito, ciclo vigente, data prevista de encerramento e ciclos anteriores, vinculados ao dia e à versão da apuração. Separar saldo provisório de fechado e permitir contestação pelos fluxos existentes/planejados.

No **Coala One web**, prever “Meu ponto” para registro e consulta pessoal equivalente; painel DP com filtros autorizados por colaborador, unidade/estabelecimento, período e pendência. Ambas as interfaces consultam as mesmas fontes. Web oferece download e compartilhamento quando suportado pelo navegador, com download como alternativa; o link de consulta nunca contorna autenticação/permissões.

Documentos pessoais ficam acessíveis pela **pasta do colaborador no Coala One**, mediante referências ao catálogo e aos mesmos arquivos originais, sem cópias divergentes. O Coala Go não consulta essa pasta. AFD/AEJ são exportações restritas do REP-P/PTRP por estabelecimento/período, não documentos gerais liberados na pasta pessoal. Escala planejada é outro documento, claramente separado dos registros de ponto.

Exportação em lote entrega os PDFs originais em pacote ZIP com índice; não fundir ou reimprimir PDFs assinados como se fossem novos originais. Consultas paginadas e geração de lotes limitados/retomáveis; informar filtros, arquivos indisponíveis e erros, sem apresentar lote incompleto como completo. Arquivos temporários e links devem ter acesso controlado e validade limitada; compartilhar arquivo pessoal não expõe arquivos de outros empregados. Abrir o seletor de compartilhamento não comprova envio/recebimento.

### 3.10. Jornada de referência, turno aplicado e banco de horas

**Decisão de negócio confirmada em 17/10/2026:** jornada de referência de 7h20 e turno aplicado de 6h líquidas são parâmetros distintos. Cumpridas as 6h, sem outras ocorrências, o resultado é **−1h20 no banco**. Não reduzir automaticamente a referência para 6h por haver turno menor; não lançar a mesma diferença novamente como falta/atraso. O ponto registra os horários reais; escala não substitui batidas.

Implementar memória de cálculo com referência, turno, trabalho apurado, abonos/ajustes e destino de cada diferença, sem dupla contagem. Validar também os turnos existentes de 5h45 e 8h, ausências, tolerâncias e extras, respeitando destinação configurada (banco ou folha). A decisão sobre saldo negativo está encerrada para este escopo; resta implementar e testar sua aplicação.

“Movimentação de banco” significa **extrato rastreável do banco de horas**: crédito, débito, compensação, ajuste, estorno e encerramento/liquidação. Cada lançamento identifica pessoa, data, ciclo, origem, regra, versão e responsável quando manual. Reprocessamento é idempotente; correção preserva trilha, não duplica saldo.

**Pendências do Doc Brown sobre o pacote do fechamento (20/10/2026):** (a) **perguntas ao advogado:** a assinatura do trabalhador no espelho é exigida pela Portaria 671 ou escolha da empresa, e a recusa tem efeito? Recibo de salário (art. 464) e espelho no mesmo documento: a recusa do pacote vale só como divergência do espelho (o depósito em conta segue como prova do pagamento)? Prazo de guarda do pacote assinado e se o e-CNPJ destacado basta sem carimbo do tempo. (b) Conferir se `signPtrpDetached` gera CAdES com carimbo do tempo (CAdES-T ou superior) para valer em 20 anos. (c) Empresa como signatária também na Autentique, ou entrega do `.p7s` ao trabalhador. (d) Retenção: `retentionUntil` e trava contra exclusão no documento arquivado; versionamento/retenção do bucket. (e) LGPD: contrato de operador com a Autentique (art. 39); quem fecha o mês passa a acionar a leitura do contracheque (finalidade: entrega ao titular); tirar o tipo de ausência do PDF do espelho. (f) Buscar o PDF assinado pela API da Autentique (`providerDocumentId`) em vez da URL do evento. (g) Contracheque retificado depois do envio não marca o pacote como desatualizado.

**Pendências do Doc Brown sobre o banco (20/10/2026; decisões jurídicas, nada suposto no código):** (1) **Decidido pelo programador (20/10/2026):** falta é ato discricionário do operador. Dia sem batida fica "a tratar"; o DP lança a ausência e o tipo decide (injustificada desconta na folha e vai ao AEJ como "2"; "débito no banco" vai ao banco). O tamanho do ciclo é configurado por quem conhece o acordo; segue a **pergunta ao advogado** sobre o instrumento do banco. (2) Base legal na política (`timeBank.legalBasis`) para limitar o ciclo: mesmo mês, até 6 meses/180 dias (individual) ou até 12 meses/365 dias (coletivo); hoje o ciclo vai até 12 meses ou 366 dias, e o "transportar" pode envelhecer crédito além do prazo legal. (3) Natureza do débito por atraso no AEJ como "3"/"2" (compensação), a confirmar com o MTE e o atestado técnico. (4) **Decidido pelo programador (20/10/2026):** toda folga da escala, inclusive a prevista, é DSR; outro abono é ausência. Falta na escala: clicar no dia e escolher turno, DSR ou ausência. (5) Compensação, ajuste manual, estorno e lançamento da liquidação no extrato. (6) Apurar no fechamento ou congelar as entradas (escala, jornada, política, feriados), em vez da primeira leitura. (7) Vencimento individual do crédito (`expirationDays`) e limites positivo/negativo só como aviso. (8) Feriado por unidade quando a pessoa trabalha em locais com calendários diferentes. (9) Domingo escalado: só o excedente segue a faixa de domingo; confirmar na CCT.

**Correção de liquidação (pendência operacional, 21/10/2026):** a liquidação criada pelo encerramento é imutável e não pode ser estornada isoladamente, para não recolocar no banco um valor já enviado à folha. Ainda falta definir e implementar o procedimento de correção conjunta entre o encerramento, o evento substitutivo de folha e a trilha do banco; até lá, divergência exige ajuste auditável do DP e não apaga o lançamento original.

Configurar ciclos mensais, de 15 dias, de seis meses ou de 180 dias, além de outros intervalos suportados explicitamente. **Implementado em 20/10/2026** em `timeBank.cycle` da política (unidade mês ou dia, tamanho, marco, destino do residual: transportar, folha, revisão ou zerar); extrato em `docs/engineering/flows/dp-time-recording.md`. Guardar marco inicial, unidade de duração, limites do período e vigência; seis meses de calendário não equivalem automaticamente a 180 dias. O vencimento individual usa lotes FIFO por data e `expirationDays`; folha retira o crédito vencido do saldo e cria evento, revisão conserva o valor para decisão humana, e `forfeit` de crédito positivo também vira revisão. “Resetar” encerra um ciclo e abre outro, **sem apagar extrato**; destino do residual é configurado e a liquidação na folha cria movimento auditável.

Histórico obrigatório **a partir do início dos testes**, com regras fiéis à operação pretendida e versionamento de jornada, turno, cargo, unidade e política. Ensaios sintéticos continuam isolados; coleta com empregados reais segue os gates do piloto. Não haverá recálculo/backfill obrigatório de períodos anteriores; comparação histórica com Bizneo é auditoria opcional. Alterações futuras de jornada/escala, inclusive eventual mudança de regime semanal, entram por vigência, sem pressupor mudança legislativa ou data de aplicação.

**Decisão de 21/10/2026:** testar primeiro com algumas colaboradoras e só depois migrar toda a equipe. Para cada participante, o DP publica uma fotografia inicial na data de entrada no piloto; não se importa o histórico de batidas do Bizneo. Toda alteração posterior passa pelo contrato central de vigências, preserva a anterior e exige nova versão. No cadastro de unidades, CNPJ e endereço identificam o estabelecimento fiscal quando a unidade for selecionada como empregadora. A flag global da coleta nunca libera a equipe inteira sozinha: o servidor também exige `app.timeRecording.mark=true` no perfil efetivo da participante.

### 3.11. Empregador, lotação e trabalho em outra unidade

Reaproveitar os campos existentes de `users`, definidos em [tipos do colaborador](../../src/types/index.ts). Não criar outro cadastro de empregador:

| Campo existente | Papel no ponto e fechamento |
| --- | --- |
| `employerUnitId` | Referência à unidade jurídica responsável pelo vínculo; resolver identificação fiscal vigente para agrupamento do empregado na folha |
| `employerCnpj`, `employerUnitName`, `employerAddress` | Dados registrados do empregador; conferir consistência com a referência e preservar snapshot por vigência |
| `unitId` | Lotação principal/referência financeira; não substitui empregador |
| `unitIds` | Unidades onde pode ser escalado/atuar; não cria vínculos jurídicos adicionais |
| `employmentRelationshipType` | Natureza do vínculo; não identifica o CNPJ empregador |

Para cada jornada, preservar separadamente vínculo/ciclo de admissão, empregador fiscal, lotação, unidade planejada e unidade efetiva de prestação, com fonte e vigência. A unidade da ocorrência de escala é previsão, não prova automática do local efetivamente trabalhado. Divergência ou unidade desconhecida gera ocorrência para tratamento; nunca inventar local nem bloquear coleta apenas por estar fora de `unitIds`. Não ampliar automaticamente permissões ou unidades cadastradas por uma batida excepcional.

**Cobertura excepcional:** empregado vinculado ao empregador A e lotado no Tirirical cumpre seis horas no João Paulo. As seis horas entram uma única vez na apuração do mesmo vínculo/competência, identificadas com a unidade de prestação. Se a referência do dia é 7h20 e não há outras ocorrências, o débito é de 1h20 no mesmo banco, não uma falta de 7h20 na origem mais seis horas extras no destino. A cobertura não troca `employerUnitId`, não cria admissão/transferência jurídica e não usa automaticamente o CNPJ do local como empregador.

Consolidar o trabalho do vínculo antes de apurar limites diários/semanais; jornadas repartidas entre unidades não duplicam referência, tolerância, débito ou extra. Regras territoriais e de cobertura usam o contexto vigente e a política aprovada; não aplicar toda a política da unidade de destino por simples localização. Rateio de custos é dimensão separada do empregador e não altera horas nem saldo; automatização de rateio depende de contrato financeiro próprio.

Ausência/conflito de identificação jurídica impede finalizar documentos/folha como conformes, mas não autoriza perder tentativas de marcação. Aplicar contingência sem atribuir NSR/CNPJ por suposição. Transferência jurídica real requer alteração explícita com vigência; não reler documentos anteriores pelo cadastro atual. O mapeamento fiscal da ARP segue o vínculo validado, nunca a troca operacional de unidade isoladamente.

**Aceite:** testar cobertura em outra unidade, divisão do mesmo dia entre duas unidades, unidade fora de `unitIds`, vínculo fiscal ausente/divergente, transferência com vigência e mudança posterior de lotação. Conferir horas consolidadas, empregador nos documentos, saldo único, rastreabilidade do local e ausência de ampliação de acesso. Verificar preenchimento individual antes do piloto; a existência dos campos no código não comprova sua completude real.

## 4. Arquitetura

- **REP-P:** código e versão próprios; coleta, hora, NSR, ARP, comprovante e AFD.
- **ARP:** banco exclusivo e escrita por serviço dedicado, com acessos mínimos. Demonstrar proteção contra escrita privilegiada; cadeia de hashes e backup diário isoladamente não bastam.
- **PTRP/Tempo:** coleções próprias em `coala-rh`. Migrações necessárias seguem transição controlada, sem duas fontes editáveis.
- **Escala:** permanece em `coala`, preservando proteção de ocupação e histórico.
- **Documentos:** identidade, versão, origem e assinatura quando exigida; registrar geradores em `SYSTEM_DOCUMENT_TEMPLATES`, conforme [catálogo oficial](../engineering/generated-documents-registry.md).
- **Operação:** filas idempotentes, consultas limitadas, índices e custos dimensionados antes da implantação.

## 5. Estado de partida

O estado funcional abaixo vem do registro anterior. Após a correção do usuário, foi feita consulta real somente de leitura ao banco `coala`, projeto `smart-converter-752gf`, em 17/10/2026. Essa leitura confirma os cadastros listados, não sua conformidade jurídica nem todos os vínculos dos empregados.

### Inventário real confirmado em 17/10/2026

| Cadastro | Resultado |
| --- | --- |
| Unidades | 4 ativas, todas com CNPJ e endereço; 1 arquivada (Administrativo/CTA) |
| Quiosque Tirirical | CNPJ 14.276.603/0001-25 |
| Quiosque João Paulo | CNPJ 14.276.603/0002-06 |
| Centro de distribuição - Matriz | CNPJ 14.276.603/0003-97; “Matriz” é o nome operacional cadastrado, não classificação fiscal inferida |
| Quiosque Shopping do Automóvel | CNPJ 14.276.603/0004-78 |
| Municípios | Endereços das 4 unidades ativas indicam São Luís/MA; preservar suporte a vários municípios |
| Jornadas | 1 publicada: “Jornada 44h — 7h20 diárias”, versão 2, vigência inicial 01/10/2026; 1 versão arquivada |
| Turnos | 13 definições cadastradas, nenhuma marcada como arquivada na consulta |
| Horas extras | 1 política publicada, versão 1: “CCT — 2026 - São Luís/MA”; referência “CCT Comerciários 2026/2027 - São Luís/MA” |
| Calendários | 2025 e 2026, com cidade São Luís e UF MA |

O município em `dp_units` está no endereço textual; calendários e cadastro empresarial oferecem campos estruturados. A fonte e o vínculo municipal do REP-P devem ser definidos sem duplicar cadastro. A referência textual à CCT já existe; falta confrontar seu conteúdo e abrangência com as regras configuradas. Não pedir novamente CNPJs, jornadas e turnos já disponíveis.

### Estado funcional registrado

| Bloco | Situação registrada |
| --- | --- |
| Jornadas e políticas de extras | Em produção, versionadas, ainda em `coala` |
| Turnos | Em produção; falta versionamento histórico |
| Escala, folgas, calendários | Em produção; preservar referências anteriores às alterações |
| Ausências | Etapas 1–3 em produção; homologação funcional DP pendente conforme guia |
| Férias, desligamento e metas | Fluxos existentes a integrar à competência |
| REP-P | Núcleo sintético local de NSR/hash/idempotência; sem serviço, ARP, coleta ou documento válido |
| PTRP, documentos assinados e fechamento integrado | Não iniciados |

### Análise de lacunas — primeiro passo concluído em 17/10/2026

Escopo: comparação do código com cadastros reais e requisitos planejados. Bases, comandos e resultados da investigação ficam no registro da tarefa `2026-10-17-plano-ponto-fechamento`, no arquivo local canônico `.ai-work-archive/development-technology/`, fora do repositório. O diagnóstico abaixo orienta implementação; não comprova conformidade operacional.

Consulta adicional, limitada e com projeção de campos, confirmou os parâmetros abaixo. Não foram consultados empregados, contratos individuais, anexos médicos nem escalas individuais. Portanto, não se declara cobertura de todos os vínculos ou correção da jornada efetivamente praticada.

#### Configuração real e implicações

| Tema | Observado | Implicação para o novo ponto |
| --- | --- | --- |
| Jornada publicada | 2.640 minutos semanais; ciclo de 7 dias, seis de 440 minutos; folga definida pela escala; máximo de 6 dias consecutivos; domingo a cada 3 semanas | Reaproveitar regra e resolução; verificar efetiva aplicação de todos os parâmetros |
| Abrangência | Jornada restrita a organização, cargo e três funções; política de extras restrita à organização | Não assumir que uma única jornada atende todos os empregados; testar resolução por vínculo antes do piloto |
| Turnos | 11 definições com 6h líquidas, uma com 5h45 e uma de liderança com 8h; todas vinculadas à jornada publicada | Aplicar decisão da seção 3.10: 6h cumpridas frente a 7h20 geram −1h20 no banco; testar demais durações e ocorrências |
| Prevalência de turno menor | `useDefinedShiftWhenShorter` ausente na jornada publicada; o validador bloqueia turno menor somente quando o campo é explicitamente `false` | Comportamento atual permite passar sem esse bloqueio; isso não é regra suficiente de remuneração/compensação |
| Intervalos | 12 turnos com intervalo fixo de 15min; liderança com duração flexível de 60min | Usar previsão para comparação, sem converter intervalo esperado em intervalo efetivamente gozado |
| Tolerância | `dailyToleranceMinutes = 5` na política (legado) | Substituída em 20/10/2026 pela tolerância única da jornada (seção 3.6); cadastrar o valor em cada jornada antes do uso |
| Extras | 50% em dia de trabalho com aprovação; 100% em domingo/feriado sem aprovação; destino folha | Parametrização existente; não há apurador de batidas identificado nesses consumidores. Aprovação não pode suprimir coleta nem resolver automaticamente direito ao pagamento |
| Banco | Habilitado, saldo negativo permitido, vencimento em 180 dias, vencido para revisão; categorias atuais destinam extras à folha | Definir quais eventos creditam/debitam o banco, instrumento autorizador e liquidação; habilitar cadastro não significa possuir razão de movimentos |
| Vigência | Jornada publicada começa 01/10/2026; política começa 13/10/2026; versão antiga da jornada está arquivada sem `validTo` | Resolver períodos sem política e política de histórico. Não inferir irregularidade de folha: não foram consultados registros oficiais históricos |
| Referência coletiva | Texto “CCT Comerciários 2026/2027 - São Luís/MA” | Já existe insumo. Ainda não foram conferidos documento, cláusulas e abrangência; não exigir novo ACT para construir REP-P |

Os limites de tolerância precisam ser modelados conforme [CLT, art. 58, §1º](https://www.planalto.gov.br/ccivil_03/decreto-lei/del5452compilado.htm). Para banco, definir unidade de prazo e instrumento aplicável: 180 dias e seis meses de calendário não devem ser tratados como equivalentes automáticos. Esta análise não aprovou juridicamente os valores cadastrados.

#### Reaproveitar, adaptar e construir

| ID | Bloco | Diagnóstico com evidência | Trabalho necessário / aceite |
| --- | --- | --- | --- |
| G01 | Identificação fiscal e territorial | CNPJs/endereço em `dp_units`; município estruturado em calendários/cadastro empresarial; [tipos](../../src/types/index.ts) | **Adaptar:** mapear unidade → estabelecimento → empregador, município/UF/fuso com fonte explícita; aceitar múltiplos municípios; não duplicar cadastro |
| G02 | Jornadas e políticas | [Serviço Tempo](../../src/features/dp/time-config/service.server.ts) mantém rascunho/publicação, versão e vigência; bloqueia edição de publicado | **Reaproveitar:** serviço e catálogo; ampliar regras jurídicas específicas, sem refazer CRUD |
| G03 | Histórico de turnos | `updateShiftDefinition` atualiza o mesmo documento; ocorrência grava início/fim e referência de jornada, mas não a definição completa do intervalo | **Adaptar:** versão/snapshot imutável do turno e intervalo; alteração futura não muda a leitura de dia passado |
| G04 | Vínculo histórico | [Validação de escala](../../src/features/dp/journey-validation/service.server.ts) lê cargo, funções e unidade atuais de `users` para resolver datas passadas | **Adaptar:** resolver vínculo por vigência e preservar decisão aplicada. Não reconstruir passado exclusivamente com cadastro atual |
| G05 | Resolução e validação | [Resolvedor](../../src/lib/dp-journey-resolution.ts) distingue ausência/ambiguidade e vigência; [núcleo de escala](../../src/features/dp/journey-validation/core.ts) verifica dias consecutivos e compatibilidade | **Reaproveitar/adaptar:** resolvedor; complementar totais diário/semanal, intervalos, interjornada e domingos no motor próprio |
| G06 | Cadência de domingos | Campo existe e tem valor 3; núcleo de validação da escala não o usa. Há consumidor no [solver consultivo Natasha](../../src/lib/natasha-roster-solver.ts) | **Adaptar:** enforcement no fluxo autoritativo e no PTRP; não confundir sugestão do solver com validação operacional |
| G07 | Jornada contratual versus turno | [Duração de turno](../../src/lib/dp-shift-duration.ts) calcula duração prevista e saída esperada; não apura batidas reais | **Implementar decisão confirmada:** seção 3.10; 7h20 de referência e 6h cumpridas resultam em −1h20 no banco, sem dupla contagem; cobrir demais turnos e ocorrências |
| G08 | Ausências e escala original | [Protocolo](../../src/features/dp/absences/operational/protocol.server.ts) já arquiva `shift.data()` em `dp_absenceDisplacedShifts` antes de remover a ocorrência | **Reaproveitar/adaptar:** consumir arquivo existente e ocorrência aprovada. Não criar segundo arquivo de ausências; complementar histórico das demais alterações de escala |
| G09 | Banco, tolerância, noturno e extras | [Schemas](../../src/features/dp/time-config/schemas.ts) oferecem parâmetros; não há razão de banco nem motor remuneratório identificado no percurso examinado | **Construir:** motor, movimentos reversíveis, vigência, critérios de classificação e eventos; ampliar schema onde insuficiente |
| G10 | REP-P | Não identificado núcleo de coleta regulada, ARP, NSR, hora legal ou serviço PAdES/CAdES no inventário/busca dirigida | **Construir:** fronteira REP-P, identidade, persistência original, comprovante, AFD, contingência e testes de integridade |
| G11 | PTRP e fiscalização | Fluxos de ausência são insumos; AEJ/espelho regulados não identificados | **Construir:** ajuste com proveniência, AEJ, espelho e atendimento fiscal, reutilizando catálogo de documentos/acessos |
| G12 | Competência e contador | Há processos de férias/desligamento; não foi identificado fechamento integrado da jornada descrito neste plano | **Construir:** eventos, snapshots, reabertura, envio/retorno e conciliação. Reutilizar canais existentes sem confundir provisão financeira com apuração de ponto |

“Não identificado” registra o limite da busca dirigida no código e mapa; não é alegação de inventário integral de todos os sistemas externos.

#### Primeiro incremento de implementação recomendado

**Histórico confiável da jornada esperada**, dentro da escala atual, antes do cálculo oficial:

1. Definir um contrato de leitura por pessoa/data que devolva vínculo vigente, regra/versionamento, turno e intervalo, alterações/ausências e referências das fontes.
2. Versionar definições de turno e preservar snapshot necessário na ocorrência, aproveitando a referência `journeyResolution` já gravada.
3. Consumir o arquivo `dp_absenceDisplacedShifts` e definir histórico para alterações/remoções que não sejam ausência.
4. Tratar data sem regra ou histórico insuficiente como pendência explícita; não preencher com o estado atual silenciosamente.
5. Demonstrar que uma mudança futura de turno/cargo/unidade não altera a reconstrução anterior; desfazer ausência mantém a trilha.

Sem migração real nesta análise. Preservação começa no início dos testes; backfill anterior não é requisito e auditoria histórica Bizneo é opcional. Ausência de evidência não autoriza fabricar versões passadas. A migração entre bancos pode ser planejada separadamente; não é pré-requisito para especificar esse contrato.

Em paralelo, a especificação técnica REP-P pode avançar sem depender da obtenção de novo ACT. G07 foi definida pelo usuário na seção 3.10; implementar casos de referência e conferir a aplicação dos parâmetros existentes. Antes do piloto, completar os gates legais do plano.

#### Limites e tratamento das lacunas

Não foram auditados todos os contratos, atribuições de empregados, eventos de folha, CCT integral ou anexos da Portaria. A Fase 0 jurídica completa permanece pendente. Evidências de execução ficam no registro da tarefa, não como aceite de implementação deste plano.

| Lacuna | Responsável funcional / execução | Entrega e aceite |
| --- | --- | --- |
| Tolerância única na jornada | DP/jurídico / desenvolvimento | Decidido em 20/10/2026: campo único diário na jornada (seção 3.6). Falta o jurídico confirmar se o limite de 5 min por marcação precisa de conferência separada; casos de fronteira na Fase 3 |
| Aprovação de extra | DP/contador / desenvolvimento | Fase 3: distinguir autorização gerencial de classificação remuneratória; extra não aprovada permanece visível e vai para decisão, nunca some da coleta/cálculo |
| Política começa após jornada | DP / desenvolvimento | Fase 1: cobertura sem lacunas desde o início dos testes; período anterior sem backfill obrigatório. Data sem regra impede finalizar cálculo conforme, não a coleta |
| Domingos e intervalos | DP/jurídico / desenvolvimento | Fases 1/3: aplicar parâmetros validados no caminho autoritativo e testar limites; campo cadastrado não é execução comprovada |
| Empregador e unidade excepcional | DP / desenvolvimento | Fases 1/3/5: contrato da seção 3.11 e seus testes; sem fallback silencioso para lotação |

Nenhum item autoriza alterar parâmetros em produção; novas versões e eventual migração real dependem do fluxo autorizado.

## 6. Fases

Esta numeração substitui a anterior. Fases 0/1 podem avançar em paralelo nas partes independentes; cálculo regulado depende das regras validadas.

Entrega incremental de interface, **sem retirar escopo**: Fase 2 entrega batida app/web, confirmação e PDF individual; Fases 3/4 entregam histórico, espelho, banco e pasta pessoal; Fase 4 completa compartilhamento nativo e exportação em lote; Fase 5 integra versões do fechamento. Testar cada incremento antes do seguinte. Esse sequenciamento não é declaração de “mínimo legal” e não dispensa qualquer gate anterior ao piloto. Todo o escopo da seção 3.9 permanece na candidata à validação integrada.

| Fase | Entrega | Critério de saída |
| --- | --- | --- |
| 0 — Base jurídica | Fontes, enquadramento, instrumentos, matriz, privacidade e retenção | Requisitos do MVP fundamentados; pendências com responsável |
| 1 — Jornada histórica | Contrato, jornada, turno e escala versionados; estabelecimento fiscal | Reconstrução por pessoa/data sem depender do cadastro atual |
| 2 — REP-P | Coleta online, hora, NSR, ARP, comprovante e AFD de teste | Integridade, concorrência, persistência e recuperação demonstradas |
| 3 — PTRP | Apuração, ajustes, ausências, banco e reprocessamento | Resultados explicáveis contra casos aprovados |
| 4 — Documentos e fiscalização | AEJ, espelho e pacote fiscal | Leiautes, assinaturas e rastreabilidade conferidos |
| 5 — Fechamento e contador | Eventos, versões, envio, retorno e conciliação | Competência sintética completa |
| 6 — Validação integrada | Simulação operacional e de falhas | Nenhuma pendência crítica; versão candidata identificada |
| 7 — Conformidade formal | INPI, atestados REP-P/PTRP e conferência dos bytes finais | Documentação e versão final validadas; amostras criptográficas já aprovadas no ITI |
| 8 — Piloto técnico | Batida real para um usuário, antecipada por decisão do programador (19/10/2026), com comprovantes sem validade até o lançamento total; sem comparação com o Bizneo, pois nada é importado de lá | Batidas, comprovantes e AFD do piloto sem perda nem divergência crítica não resolvida |
| 9 — Lançamento total | Promoção por estabelecimento depois das Fases 3 a 7; comprovantes passam a valer | Checklist completo; primeiro fechamento acompanhado |
| 10 — Saída do Bizneo | Histórico independente; encerramento das integrações antigas | Consulta/recuperação verificadas antes do desligamento |

### Sequência vigente (21/10/2026)

Decisões do programador alteraram a ordem original: o piloto técnico (Fase 8) vem antes da conformidade formal (Fase 7), e a interface do colaborador antecipou partes das Fases 3 e 4. Estado e próximos passos:

1. **Fases 1 a 6 — implementação publicada:** jornada, REP-P/PTRP, ausências, ajustes, documentos, fechamento individual/geral, banco de horas, AFD/AEJ e interfaces web/Coala Go estão em produção com a coleta real desligada. Regras e índices do `coala-rh` e as três rotinas agendadas do ponto foram publicados em 21/10/2026.
2. **Fase 0 — validação jurídica pendente:** decisões de produto estão na [seção 10-B do plano REP-P](plano-rep-p-controle-de-ponto.md); permanecem as confirmações formais e a matriz por requisito.
3. **Fase 7 — conformidade formal pendente:** as amostras de comprovante/PAdES, AFD/CAdES e e-CPF já foram aprovadas no ITI. Resta obter número/certificado do INPI, conferir os bytes finais e concluir os atestados assinados com e-CPF fora do sistema; a evidência específica do AEJ/CAdES declarada já validada ainda deve ser anexada ao dossiê.
4. **Fase 8 — piloto controlado pendente:** configurar integralmente Heucilene Ribeiro e Luis, testar em aparelho físico e só então autorizar separadamente a flag e os perfis individuais.
5. **Fase 9 — código publicado, lançamento total não autorizado:** depende do piloto, dos gates fiscais/jurídicos e do primeiro fechamento acompanhado. `REP_P_MARKING_ENABLED=false` continua impedindo qualquer batida real.
6. **Fase 10 — pendente:** saída do Bizneo reduzida, sem importação; exportação, custódia e consulta independente devem ser verificadas antes do desligamento.

**Etapa 7 — Coala Go: Ponto e Solicitações** (incluída em 19/10/2026 e executada antes da Etapa 6). Entradas nativas no app que reaproveitam as rotas web: **Ponto** (hora oficial no fuso da unidade, batida como coletor móvel `01`, sequência de hoje, histórico do mês com tratamentos, comprovante individual e ZIP do mês selecionado para abrir, compartilhar pela folha nativa ou salvar, pedido de ajuste em duas etapas) e **Solicitações** (ausência com anexo, resumo e decurso de prazo; vale-transporte e troca de turno). Aparecem com as permissões `app.timeRecording.mark` e `app.requests.create` do perfil, mais a de colaborador. Banco de horas, espelho e exportação limitada em lote estão no app; a pasta do colaborador permanece, por decisão de produto, somente no Coala One. Falta validar o conjunto em aparelho físico.

**Etapa 6 — fechamento do mês** (publicada em 21/10/2026, com a coleta real desligada): declaração versionada por pessoa, reabertura com motivo e bloqueio transacional de ajustes e ausências em competência fechada. A versão congela toda a equipe e separa fechamento individual e geral: somente a assinatura do pacote espelho + contracheque na Autentique fecha a pessoa; o geral só fecha quando todos assinaram e, após 24 horas sem assinatura, continua pendente com aviso e possibilidade de reenvio. O banco tem prévia do mês aberto, apuração automática da equipe ao fechar, aprovação de extra, limites diário/semanal, vencimento individual, compensação, ajuste, lançamento na folha e estorno auditável; turno noturno é pareado pela virada do dia e preserva minutos noturnos. A tela administrativa exporta AFD e AEJ com as respectivas assinaturas. O Coala Go mostra espelho, extrato do banco e ZIP de comprovantes do mês sob demanda; a pasta publicada permanece no Coala One. **Lacunas restantes:** outros tratamentos fora da declaração, consumidor monetário dos eventos de folha, congelamento completo de versões vivas, provisionamento do bucket fiscal imutável e os gates fiscais/ICP do piloto.

**Troca de turno em Solicitações (21/10/2026, publicada):** proposta entre dois turnos futuros da mesma unidade e data, aceite ou recusa pela outra pessoa, identidade da sessão e declaração preservadas por no mínimo 20 anos, sem TTL de exclusão automática no pedido. O programador confirmou a manifestação autenticada como prova operacional, sem assinatura reconhecida. O aceite revalida o contrato central e inverte somente os ocupantes na escala, com novas referências históricas; a recusa não altera nada. Web e Coala Go usam as mesmas rotas server-authoritative. A declaração do fechamento e o PDF do espelho listam a troca e suas manifestações para as duas pessoas; uma proposta pendente bloqueia o fechamento até receber decisão ou ficar não aplicável. As três consultas têm índices explícitos no banco principal e limites de 100, 20 por turno e 2.001 por competência. Aplicação e índices foram publicados; falta homologar em duas contas reais e testar em aparelho.

### Fase 0 — Base jurídica

- Confirmar razão social/CNPJ da titular/desenvolvedora e empregadores/estabelecimentos atendidos.
- Partir dos cadastros existentes: `dp_units` (CNPJ/endereço), `entities` (dados empresariais e município), `dp_journeys`, `dp_shiftDefinitions` e `dp_overtimePolicies`. Pedir informação ao usuário somente para lacunas encontradas. Tratar municípios por estabelecimento/abrangência, sem presumir um único município para a empresa.
- Conferir categorias e abrangência a partir dos cadastros e da referência já publicada “CCT Comerciários 2026/2027 - São Luís/MA”; localizar o instrumento correspondente e verificar acordos individuais quando aplicáveis. Ausência de um ACT próprio não é impedimento geral ao REP-P.
- Conferir integralmente Portaria vigente, anexos, leiautes, atestado e orientações; arquivar versões/hashes em `docs/rep-p/referencias/` na execução desta fase.
- Completar a [matriz](plano-rep-p-controle-de-ponto.md#11-matriz-de-requisitos-legais), distinguindo conferência documental de implementação.
- Validar jornada, tolerância, intervalos, descansos, noturno, domingos, feriados, compensação e rescisão.
- Definir retenção por classe, privacidade, acesso após desligamento, fornecedores e incidentes.
- Escolher assinatura PAdES/CAdES destacado, testável sem certificado real.
- Identificar responsáveis e direitos sobre código próprio, contratado e dependências.

### Fase 1 — Jornada histórica

Incremento local de simulação, sem conclusão desta fase: `src/features/dp/time-calculation/core.ts` calcula em memória uma pessoa/dia com vigência explícita, referências congeladas e intervalos efetivos normalizados. Para 440 minutos de referência e 360 trabalhados, só propõe −80 ao banco quando vínculo/política são elegíveis; cobertura sequencial em outra unidade consolida as horas sem substituir o empregador. Ausência, falta de batida, extra, sobreposição, ambiguidade ou regra territorial não resolvida exigem revisão. A saída é `simulation_only`, sem ledger, API, UI, documento fiscal, REP-P/PTRP ou efeito em `users`; não valida a identidade jurídica do empregador. O plano continua aberto nas Fases 1, 2 e 3.

Versionar turnos, contratos, escala e regras; preservar planejamento anterior às ausências. Implementar turno ajustado para recomposição por horas conforme escopo já combinado. Mapear unidade operacional para estabelecimento fiscal. Migrar Tempo quando necessário, sem fontes duplicadas. Confirmar dependências de mudanças retroativas.

Incremento local disponível: gravação individual e substituição em lote preservam referências privadas de planejamento em `dp_shiftReferenceHistory`, com revisões anteriores, turno/intervalo e separação empregador/lotação; campos ausentes são pendências. O serviço privado de vínculo resolve pessoa/data e a ficha do colaborador permite consultar e acrescentar vigências sem alterar `users`. Ainda faltam o histórico efetivo dos cadastros reais, o consumo da referência por pessoa/data no PTRP, a cobertura dos demais escritores e eventos de remoção. Nenhum cadastro real foi preenchido automaticamente. Detalhes e limites nos guias de [escalas](../engineering/flows/dp-schedules.md) e [pessoas](../engineering/flows/people-access.md).

### Fase 2 — Núcleo REP-P

Implementar coleta preferencial no Coala Go existente, alternativa pessoal no Coala One web e terminal, identificação, hora, NSR, ARP, comprovante e AFD conforme especificação complementar. Entregar confirmação e acesso ao PDF por batida nas duas interfaces (seção 3.9). Dados exclusivamente sintéticos.

Testar concorrência, repetição, falha após persistência, indisponibilidade de assinatura, desvio de hora e restauração. Definir contingência antes de declarar coleta apta.

Incremento local de 18/10/2026: as etapas técnicas 1–4 foram implementadas com ARP dedicada, API própria autenticada, NSR/original transacional, relógio confiável fail-closed e AFD 004 com contrato de assinatura CAdES. O emulador validou concorrência, replay e unidade excepcional sem trocar empregador. Os provedores padrão de Hora Legal e assinatura recusam operação; portanto não há coleta ou exportação fiscal real. A etapa 5 acrescentou o comprovante PDF/PAdES por batida (snapshot na transação, emissão única, recuperação sem nova batida), também bloqueado pelo assinador padrão. Interfaces, INPI/atestados, IAM/backup/restauração e homologação continuam nesta fase.

### Fase 3 — Tratamento

Motor e ajustes das seções 7/8; banco com extrato, ciclos e decisão de débito da seção 3.10, visível no app/web. Absorve a parte de ponto da antiga Etapa 4 de ausências. Cada ausência distingue justificativa, abono/crédito, débito e efeito de folha. Aplicar no motor tolerância, domingos e demais regras já cadastradas; cadastro existente não dispensa teste do cálculo.

### Fase 4 — Documentos e fiscalização

AEJ/espelho identificam originais e tratamentos. Validar pares por jornada, virada de dia, pré-assinalação e horário contratual. AFD é gerado pelo REP-P.

Entregar histórico por hoje/dia/período, visualização/download, compartilhamento nativo, exportação em lote e referências na pasta do colaborador, conforme seção 3.9. Separar comprovantes, resumo de consulta, espelho, escala e arquivos fiscais restritos.

Exercitar solicitação fiscal simulada: período, assinaturas, metadados e documentação técnica. Pendência no PTRP não impede a extração do AFD.

### Fase 5 — Fechamento e contador

Eventos, fechamento/reabertura, envio versionado, retorno, conciliação e definitivos. Absorve a parte de folha da antiga Etapa 4 de ausências. Destinatários e documentos de teste isolados.

Reaproveitar o fechamento integrado já especificado nas seções 9–11; publicar espelhos e versões correspondentes na pasta do colaborador e nas consultas app/web, preservando versões anteriores identificadas.

### Fase 6 — Validação integrada

Competência sintética completa com casos esperados aprovados pelo DP/contador e revisão jurídica dos casos sensíveis. Incluir falhas, recuperação, mudança contratual, férias, ausência parcial, desligamento e retroatividade.

Congelar versão candidata e evidências. Concordância entre programas não substitui resultados de referência.

### Fase 7 — Conformidade formal

1. Confirmar titularidade/licenças e cessões necessárias.
2. Disponibilizar e-CNPJ da CT Sorvetes LTDA e certificados pessoais dos responsáveis sem transmitir chaves pelo chat.
3. Preservar pacote/hash da versão e obter registro no INPI.
4. Configurar número INPI e certificados por configuração controlada, sem mudar código apenas para inserir valores.
5. Emitir atestados que contemplem expressamente REP-P/PTRP, versões e destinatários.
6. Validar assinaturas reais e repetir verificações afetadas pela configuração final.
7. Confirmar privacidade, retenção, atendimento, contingência e revisão final jurídica/contábil.

Mudança na versão candidata exige reconciliar pacote, atestados e evidências antes do piloto. Certificado de teste não atende este gate.

### Fase 8 — Piloto paralelo

Um estabelecimento, por pelo menos uma competência. Bizneo oficial; Coala comparativo e já formalizado. Orientar empregados sobre acesso, finalidade e divergências.

Classificar diferenças de instante de coleta, regra e defeito. Duas batidas feitas em momentos distintos não precisam ser artificialmente iguais. Resolver causas, repetir verificações afetadas e tratar evidência de trabalho real no processo oficial.

### Fase 9 — Oficial e expansão

Aprovação do RH por estabelecimento, checklist da seção 14 e instante de corte registrado. Acompanhar primeiro fechamento antes de expandir.

Retorno ao Bizneo preserva documentos/proveniência e consolida competência. Nunca apagar coleta do Coala nem apresentá-la como realizada no outro sistema.

### Fase 10 — Saída do Bizneo

Exportar/conferir registros, arquivos fiscais disponíveis, espelhos, tratamentos e demais documentos necessários. Testar consulta sem fornecedor. Só então encerrar serviço/exportação de escala, com custódia, prazos e suspensão de descarte documentados.

## 7. Motor de apuração

Entradas: vínculo/contrato/regras vigentes, escala histórica, feriados, férias, ausências, ARP e tratamentos.

1. Resolver jornada e regra por data/contexto.
2. Parear registros por jornada, inclusive atravessando meia-noite.
3. Calcular trabalho, intervalos e tolerâncias.
4. Apurar excedentes diários/semanais sem duplicidade, noturno, descansos, banco e ausências.
5. Identificar inconsistências sem inventar marcações.
6. Preservar resultado automático/final, entradas, versões e memória de cálculo.

Reprocessamento segue dependências: dia pode afetar semana, descanso, banco e competências posteriores. Fila limitada, idempotente e retomável. Competência fechada recebe alerta e exige reabertura; jobs não a alteram silenciosamente.

### 7.1. Contratos do motor e do banco (requisitos de implementação)

- **Entrada congelada:** pessoa, vínculo/ciclo de admissão, jornada lógica, fuso, empregador, unidades, IDs/versões de regras, escala, originais e tratamentos. Mesmas entradas ordenadas e versão do motor produzem mesmo resultado; entrada ausente/ambígua retorna pendência, não zero horas.
- **Saída:** versão, memória de cálculo, tempo real, tempo considerado, intervalos, abonos, diferenças, destino banco/folha, pendências e referências das fontes. Guardar precisão original; conversão/arredondamento somente por regra explícita. Atribuir jornada noturna, semana, feriado e competência por regra versionada, não por corte arbitrário da meia-noite.
- **Não duplicidade:** cada parcela compensável tem origem e destino exclusivos. Adicionais que possam coexistir são dimensões separadas, com regra explícita; a mesma hora não vira crédito de banco e extra de folha simultaneamente. Débito de 80 minutos não reaparece como falta remuneratória.
- **Banco:** lançamento imutável com ID, vínculo, ciclo, origem/parcela, versão de apuração, minutos com sinal, tipo, motivo e eventual autor. Chave única por origem/parcela/versão/tipo; ajuste por estorno referenciado e substituição, sem edição destrutiva. Saldo projetado deve reconciliar com saldo inicial mais lançamentos.
- **Ciclos:** início inclusivo e fim exclusivo, sem sobreposição por vínculo; política e fuso congelados. Encerrar exige residual destinado explicitamente e reconciliação. Correção de ciclo fechado exige reabertura autorizada/versionada e recálculo dos ciclos dependentes, sem reescrever silenciosamente o saldo seguinte.
- **Concorrência:** publicar resultado somente se versões de entrada continuam atuais; alteração concorrente torna resultado obsoleto e agenda nova execução limitada. Persistência dos efeitos usa transação quando possível ou tarefa durável idempotente com reconciliação entre bancos; falha parcial não pode deixar saldo aceito sem evento de origem.

## 8. Ajustes e ocorrências

Esquecimento, falha, marcação indevida, intervalo/saída ausente e conflito com escala/ausência.

- Solicitante não aprova o próprio ajuste.
- Fluxo por gestor, RH ou ambos; automação somente em casos definidos/validados.
- Guardar evidência, motivo, solicitado/aplicado, autores, decisões, datas e reversões.
- Nunca completar horário por conveniência para “fechar pares”.
- Identificar inclusão, desconsideração e pré-assinalação nos documentos.
- Lote exige compatibilidade, prévia e auditoria.
- Estados: nova → análise → aguardando informação → tratada/desconsiderada → reaberta.
- **Implementado em 19/10/2026 (etapa 5):** pedido, decisão com justificativa, tratamentos D/I e relatório; ver [fluxo do Registro de ponto](../engineering/flows/dp-time-recording.md). Falta gerar o AEJ e o espelho a partir dos tratamentos (fases 4 e 5).
- Pedido do colaborador (orientação Doc Brown, 19/10/2026): batida esquecida = inclusão; errada/duplicada = desconsideração; horário errado = desconsideração + inclusão na mesma transação; unidade errada = tratamento de local, sem tocar a ARP. Justificativa obrigatória; hora sempre informada pela pessoa; evidência opcional (sem dado de saúde). Cada pedido tem um histórico consultável com original × novo, justificativa, autor, decisor, instantes, estado e reversões; se virar PDF persistente, entra em `SYSTEM_DOCUMENT_TEMPLATES`. Detalhes e perguntas ao advogado na [seção 10-A do plano REP-P](plano-rep-p-controle-de-ponto.md).

## 9. Eventos de folha

Código interno/do contador, natureza, unidade, quantidade, percentual quando aplicável, origem, competência, versão e aprovação.

Identidade mínima do evento: ID estável, pessoa/vínculo, empregador vigente, competência, origem/parcela e versão. Distinguir `minutes`, dias, unidades e moeda; valores monetários de metas preservam moeda e aprovação do módulo de origem. Contrato com contador define códigos e conversões; valor desconhecido não vira zero. Não gerar lançamentos financeiros ou pagamentos apenas por fechar ponto.

Automáticos abertos podem ser recalculados; manuais não são apagados; aprovados afetados voltam à revisão. Integrar férias, desligamento, ausências, metas e vale-transporte conforme contrato com contador.

## 10. Fechamento e conformidade

Estados independentes:
- **Administrativo:** preparação → revisão → fechado → enviado → conciliação → concluído.
- **Conformidade:** pendente → conforme / não conforme, com evidências e impedimentos.

Ressalva documenta motivo, responsável, pessoas, impacto e prazo. Não certifica registro, cálculo ou documento irregular.

Falha de integridade, assinatura inválida, falta de documento obrigatório ou cálculo não confiável impede declarar conformidade/promover o sistema. Procedimento acordado com contador permite cumprir obrigações de pagamento tempestivamente, documentando ajustes/retificações.

Congelar entradas, referências a originais, tratamentos, regras, resultados, eventos, documentos e aprovadores. Reabertura cria nova versão e preserva a anterior.

**Declaração obrigatória no documento de fechamento (decisão do programador, 19/10/2026).** O documento de fechamento do ponto de cada pessoa e competência declara todos os pedidos e tratamentos que afetaram ou justificaram a jornada, um a um, ligados ao dia:

- **Ajustes de ponto:** marcação original (NSR, instante) × nova, tipo (inclusão/desconsideração), justificativa, solicitante, decisor, instantes e situação, inclusive recusados, revertidos e reabertos.
- **Ausências:** tipo, período, quantidade, situação e forma de aprovação (análise humana ou **aprovada por decurso de prazo**), com referência ao comprovante sem reproduzir dado de saúde.
- **Outros tratamentos:** troca de unidade conferida, pré-assinalação, abonos e qualquer correção do DP, com autor e motivo.

Fechar a competência sem que todos esses itens estejam declarados é impedimento de conformidade; pedido em aberto aparece como pendente, nunca omitido. A versão reaberta declara o que mudou em relação à anterior.

Chave do fechamento: empregador/estabelecimento fiscal e competência, com pessoas/vínculos incluídos explicitamente. Fechar usa a versão esperada e verifica ausência de entradas alteradas, jobs pendentes e divergências críticas; concorrência rejeita a transição e exige revisão. Se a materialização for em lotes, publicar o manifesto completo somente após verificar todos os itens; pacote parcial não é fechamento concluído.

Reabertura exige permissão, motivo e referência à versão anterior; gera manifesto de diferenças em eventos, banco e documentos. Jobs não modificam pacote fechado/enviado. Correção após remessa requer nova versão e retificação identificada, preservando o envio anterior e reavaliando efeitos em ciclos/competências seguintes.

## 11. Contador e conciliação

Resumo por pessoa/geral; CSV/XLSX estruturado e PDF; leiaute e unidades acordados. Envio registra destinatários, arquivos e versão; e-mail é canal. Retorno vincula prévia/definitivos à versão. Conciliação aponta diferenças de pessoa, quantidade, evento e competência; correção gera nova prévia.

Portal do contador e conciliação automática ficam após o MVP; ciclo básico integra Fase 5.

Remessa contém ID idempotente, empregador, competência/versão, eventos, manifesto de arquivos/hashes, destinatário autorizado e estado (`preparada`, `enviada`, `recebida`, `conciliada` ou `falha`). Envio técnico não significa aceite contábil. Retorno referencia remessa/versão e separa divergência de quantidade, valor e pessoa; retorno antigo não concilia versão atual. Repetir tentativa não duplica evento/remessa lógica; reenvio intencional fica auditado. Dados sintéticos usam destinatários isolados, nunca o canal real automaticamente.

## 12. Acesso, privacidade e retenção

| Perfil | Responsabilidade |
| --- | --- |
| Colaborador | Marcar, consultar documentos, solicitar ajuste e contestar |
| Gestor | Equipe/aprovações configuradas, sem acesso geral a anexos sensíveis |
| RH operacional | Tratamento/reprocessamento autorizado |
| RH responsável | Publicar regras validadas, fechar/reabrir e promover |
| Administrador técnico | Configuração/operação, sem editar originais |
| Auditor | Leitura e exportações autorizadas |
| Contador | Competências/documentos autorizados, sem acesso geral à ARP/anexos médicos |

Definir acesso após desligamento, recuperação de conta e alternativa para empregado sem celular próprio. Consulta ao comprovante não depende de concordância com o espelho.

Privacidade vale desde a primeira coleta real. Retenção por finalidade/classe; 48 horas não é prazo de descarte. Suspender eliminação por litígio/fiscalização quando aplicável. Política anterior de anexos médicos não vira regra legal geral do ponto.

## 13. MVP e verificações

MVP funcional = Fases 0–5 com dados sintéticos; não autoriza coleta real. Operação real exige Fases 6–8 e promoção na 9.

Casos mínimos: jornada regular, tolerâncias, extra diária/semanal, intervalos, noturno, feriado, folga, ausência parcial, batida ímpar, sem escala, alteração contratual, desligamento, retroatividade, concorrência e falha de persistência/assinatura.

Testes significativos por requisito. Verificação documental não comprova implementação; ensaio sintético não comprova produção.

Aceites adicionais: 7h20 versus 6h = −1h20 sem débito duplicado; encerramento de ciclo preserva extrato; seis meses versus 180 dias; alteração futura não muda período anterior ao ajuste; mesma batida consultável app/web; PDF original idêntico no download e compartilhamento; hoje parcial e jornada noturna; intervalo de datas e lote incompleto; assinatura pendente e recuperação sem duplicação; cancelamento do compartilhamento e ausência de WhatsApp/e-mail instalado; isolamento entre colaboradores e bloqueio de AFD/AEJ na consulta pessoal.

## 14. Critérios para uso oficial

Todos necessários:
1. Matriz legal aplicável completa com evidências.
2. INPI e atestados REP-P/PTRP arquivados.
3. Regras de vínculo/instrumento coletivo validadas e vigentes.
4. Assinaturas reais e arquivos fiscais verificados.
5. Integridade e ausência de perda demonstradas em testes/piloto.
6. Contingência e recuperação exercitadas.
7. Acesso e contestação pelo empregado disponíveis.
8. Competência piloto conciliada; diferenças críticas resolvidas.
9. Transição/retorno documentados.
10. Aprovação RH por estabelecimento.

## 15. Pendências

| Insumo/decisão | Responsável | Até |
| --- | --- | --- |
| Conferir cadastros existentes e identificar lacunas de estabelecimento/categoria/instrumento aplicável; titular CT Sorvetes já informada | Desenvolvimento; DP/contador/jurídico apenas nas lacunas | Fase 0 |
| Regras, retenção e instrumentos de banco | Jurídico + DP | Fase 0 |
| Responsáveis técnico/legal | Administração | Fase 0 |
| Identificação no terminal/aprovações | DP + desenvolvimento | Antes das Fases 2/3 |
| Assinatura, proteção ARP e contingência | Desenvolvimento + responsáveis | Fase 2 |
| Eventos, unidades e formatos contábeis | DP + contador | Fase 5 |
| Estabelecimento piloto e critérios de diferença | RH + desenvolvimento | Antes da Fase 8 |
| Parâmetros e validação física da geolocalização | Operação + jurídico + desenvolvimento | Antes do piloto nominal |
