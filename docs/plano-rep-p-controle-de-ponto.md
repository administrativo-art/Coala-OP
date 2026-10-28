# Plano — REP-P, Documentos e Conformidade

**Produto:** Coala OP / Coala Go

**Status:** Fases técnicas 1–6 publicadas com a coleta oficial desligada; ensaio nominal segregado em validação; conformidade formal e lançamento pendentes

**Última atualização:** 25/10/2026

**Titular do sistema:** CT Sorvetes LTDA — CNPJ 14.276.603/0001-25, informado pelo proprietário em 17/10/2026. O e-CNPJ é o dessa pessoa jurídica; “Coala” identifica o sistema/marca neste plano.

> O [plano mestre](plano-jornada-fechamento-rh.md#6-fases) define a execução. CT Sorvetes LTDA usa seu e-CNPJ e está definida como titular e desenvolvedora; no uso próprio, também é a empregadora destinatária. Desenvolvimento e validação integrada usam dados sintéticos. As assinaturas de amostra foram validadas no ITI; INPI e atestados definitivos antecedem o piloto com empregados reais. O [estado documental canônico](rep-p/homologacao/README.md#fonte-canônica-do-estado-documental) prevalece sobre anotações históricas deste plano. Esta especificação não é certificado de conformidade.

## 1. Escopo

REP-P próprio para registrar jornada dos empregados, conectado ao PTRP Coala. Uso interno; comercialização fora do escopo.

REP-P preserva originais e gera comprovante/AFD. PTRP trata, apura e gera AEJ/espelho. Ajustes, ausências, banco e eventos de folha não escrevem na ARP.

Bizneo permanece oficial até a promoção por estabelecimento. Não haverá conector de batidas nesta implementação; comparação por exportação/relatório.

## 2. Base normativa e evidências

Fontes consultadas na revisão de 17/10/2026:

| ID | Fonte oficial | Uso |
| --- | --- | --- |
| L1 | [CLT compilada](https://www.planalto.gov.br/ccivil_03/decreto-lei/del5452compilado.htm) | Jornada, compensação, descansos, noturno, registro e negociação coletiva |
| L2 | [Decreto 10.854/2021](https://www.planalto.gov.br/ccivil_03/_ato2019-2022/2021/decreto/d10854.htm) | Princípios do registro eletrônico |
| L3 | [Portaria 671 compilada em 21/07/2026](https://www.gov.br/trabalho-e-emprego/pt-br/assuntos/legislacao/portarias-1/portarias-vigentes-3/WORDPortarian671de8denovembrode2021compilada21.07.2026.pdf) (a de 07/01/2026 retorna 404; ver [registro de normas](rep-p/referencias/README.md)) | Requisitos REP-P/PTRP; conferência integral pendente |
| L4 | [Portal REP do MTE](https://www.gov.br/trabalho-e-emprego/pt-br/assuntos/inspecao-do-trabalho/fiscalizacao-do-trabalho/rep) | Publicações, leiautes e modelo oficial |
| L5 | [Perguntas e respostas do MTE](https://www.gov.br/trabalho-e-emprego/pt-br/assuntos/inspecao-do-trabalho/fiscalizacao-do-trabalho/Perguntas%20e%20Respostas%20REP) | Esclarecimentos sobre assinatura, NSR, documentos e offline |
| L6 | [Leiaute AFD](https://www.gov.br/trabalho-e-emprego/pt-br/assuntos/inspecao-do-trabalho/fiscalizacao-do-trabalho/leiaute-do-arquivo-fonte-de-dados-afd.pdf) | Estrutura do arquivo original |
| L7 | [Leiaute AEJ](https://www.gov.br/trabalho-e-emprego/pt-br/assuntos/inspecao-do-trabalho/fiscalizacao-do-trabalho/leiaute-do-arquivo-eletronico-de-jornada-aej.pdf) | Estrutura do arquivo tratado |
| L8 | [Modelo do atestado](https://www.gov.br/trabalho-e-emprego/pt-br/assuntos/inspecao-do-trabalho/fiscalizacao-do-trabalho/modelo-do-atestado-tecnico-e-termo-de-responsabilidade.pdf) | Identificação REP/PTRP, versão e responsáveis |
| L9 | [INPI — perguntas frequentes](https://www.gov.br/inpi/pt-br/acesso-a-informacao/perguntas-frequentes/programas-de-computador) | Titularidade, pacote/hash e assinatura da DV |
| L10 | [LGPD](https://www.planalto.gov.br/ccivil_03/_ato2015-2018/2018/lei/l13709.htm) | Finalidade, bases legais, segurança, direitos e retenção |
| L11 | [ANPD — comunicação de incidentes](https://www.gov.br/anpd/pt-br/canais_atendimento/agente-de-tratamento/comunicado-de-incidente-de-seguranca-cis) | Procedimento e prazos aplicáveis |
| L12 | [Constituição Federal](https://www.planalto.gov.br/ccivil_03/constituicao/constituicao.htm) | Limites constitucionais e prescrição |

O portal do MTE apresenta AFD/AEJ com atualização em 31/07/2026. Na Fase 0, baixar versões vigentes, guardar data, URL, hash e cópia em `docs/rep-p/referencias/`; conferir conteúdo e eventuais regras de transição.

**Limite da pesquisa:** em 18/10/2026, a compilação da Portaria 671 de 07/01/2026, o leiaute AFD 004 e as perguntas e respostas do MTE foram obtidos de fontes oficiais e usados neste corte. A Fase 0 ainda precisa transformar a norma inteira em matriz atômica revisada; fonte conferida não equivale a conformidade do software.

CCT/ACT não é requisito autorizador do REP-P (L5, distinção REP-A/REP-P). Não exigir criação de instrumento coletivo nem bloquear o núcleo técnico por sua ausência. Para apuração, verificar os instrumentos existentes e aplicáveis, inclusive referências já cadastradas, e vincular suas regras quando pertinentes. Não inferir enquadramento pela marca da empresa.

## 3. Identidade, titularidade e estabelecimentos

- A titular e desenvolvedora definida é CT Sorvetes LTDA, CNPJ 14.276.603/0001-25; usar essa identidade no registro, no e-CNPJ, no INPI e nos atestados. Tiago Francisco Brasil Batista é o responsável técnico; o campo de responsável legal do atestado recebe a pessoa física com poderes para representar a empresa.
- Reaproveitar `dp_units.cnpj/address`, dados municipais/empresariais em `entities` e configurações de Tempo existentes. Consulta real em 17/10/2026 confirmou 4 unidades ativas com CNPJ/endereço, 1 jornada publicada, 13 turnos, 1 política publicada com referência à CCT e 2 calendários com município/UF; detalhes no [inventário do plano mestre](plano-jornada-fechamento-rh.md#5-estado-de-partida). O conteúdo de `entities` e os vínculos individuais dos empregados não foram inventariados nessa consulta.
- Distinguir desenvolvedora, empregador, estabelecimento fiscal e unidade operacional.
- Usar `users.employerUnitId` e seus dados fiscais vigentes para resolver o empregador; `unitId` é lotação e `unitIds` é abrangência operacional, não vínculo jurídico. Conferir consistência de `employerCnpj` e preservar histórico desde os testes. Cobertura excepcional em outra unidade mantém empregador e consolida horas uma única vez, com local de prestação separado; contrato e aceites na seção 3.11 do plano mestre. Pendência fiscal não autoriza atribuir CNPJ/NSR por suposição nem descartar tentativa.
- Mapear estabelecimentos por CNPJ completo ou identificador legal aplicável. Duas unidades internas não geram necessariamente dois estabelecimentos.
- Sequência NSR por estabelecimento; não usar automaticamente o identificador de unidade.
- Preservar mudanças cadastrais, vínculos e transferências sem alterar documentos históricos.
- Confirmar CNAE e uso interno com contador; comercialização exige novo escopo.
- Avaliar contratos/licenças de código; cessão quando necessária. Bibliotecas de terceiros exigem cumprimento de licença, não uma cessão genérica.

## 4. Fronteiras técnicas

- REP-P em módulo próprio, com versão, dependências, testes e procedimento de mudança.
- ARP em banco exclusivo; serviço dedicado é o único escritor operacional.
- PTRP em `coala-rh`, com leitura controlada dos originais e nenhuma permissão de alterá-los.
- Core/RH fornecem cadastro; cada mudança relevante mantém a história exigida no núcleo.
- Regras Firestore não protegem contra todo acesso administrativo. Inventariar identidades, permissões privilegiadas, deploy, restauração e exportação.
- Integridade requer prevenção e detecção: registro só por acréscimo, evidência independente e recuperação verificável.
- Cadeia de hashes e exportação diária com retenção são camadas adicionais. Não provam, sozinhas, impossibilidade de adulteração antes do backup.
- Projeto concreto de preservação, retenção e eventual trava irreversível será revisto antes da configuração real.

## 5. Requisitos do REP-P

### 5.1. Cadastros

Empregador/estabelecimento, endereço/local de prestação, trabalhador, CPF, vínculo e identificadores exigidos pelo leiaute. Eventos cadastrais preservam antes/depois, responsável e instante conforme especificação oficial.

Inativação não apaga identidade histórica nem documentos. Definir canal de consulta após desligamento.

### 5.2. Coletores

Coala Go existente como canal preferencial, Coala One web como alternativa pessoal e tablet compartilhado, todos com identificação individual e o mesmo backend REP-P. Não criar outro aplicativo ou registros independentes por canal. Escolher login/PIN/crachá com análise de atribuição, compartilhamento e recuperação. Fornecer alternativa para quem não possui celular.

Mostrar hora, minuto e segundo conforme requisito aplicável. Não bloquear por escala, atraso, folga, ausência aprovada, local ou falta de autorização de extra. Segurança contra abuso não pode descartar silenciosamente uma tentativa legítima.

### 5.3. Hora e contingência

Sincronização com Hora Legal Brasileira e limite de diferença de 30 segundos são requisitos a conferir integralmente no Anexo IX na Fase 0. Servidor e coletor devem ter responsabilidade explícita sobre o instante registrado.

Testar desvio, correção, indisponibilidade da referência, fuso e retorno ao funcionamento. Alerta isolado não resolve a falha. Definir como preservar tentativas, identificar registros afetados e ativar contingência sem fabricar horários.

Fonte temporal do aparelho não deve ser aceita sem verificação. Preservar instantes originais, de recepção e contexto local quando aplicáveis.

### 5.4. Online e contingência offline no aplicativo

O portal web permanece on-line. O Coala Go preserva marcações sem rede somente após pré-autorização on-line: a versão legada v1 conserva até 12 horas; a candidata local v2 permite iniciar em até 24 horas do preparo e preserva o ciclo por 24 horas da primeira batida, sem prorrogação por reconexão. Ver [validação do ciclo](rep-p/homologacao/ciclo-offline-24h.md). Distinguir sempre marcação apenas guardada no aparelho, registro persistido, comprovante pendente e comprovante disponível.

Requisição tem identificador idempotente. Reenvio da mesma tentativa não duplica; duas marcações distintas não podem ser eliminadas por terem horários próximos.

Offline é facultativo (L5, item 52). O incremento local de 21/10/2026 implementa no Coala Go fila cifrada por conta, chave P-256 em TEE/StrongBox, âncora da Hora Legal + relógio monotônico, cadeia e assinatura locais, limite de 20 pendentes, bloqueio após reinício, sincronização ordenada e modo `1` no registro 7 do AFD. NSR e comprovante só nascem no servidor. Ainda são gates do piloto: teste em aparelho físico e perda/retorno de rede, verificação de hardware e assinatura do APK direto em modo `enforce`, revisão jurídica/Doc Brown, operação dos casos bloqueados e todas as pendências gerais do REP-P.

### 5.5. NSR e ARP

Sequência por estabelecimento, iniciada em 1, incrementos unitários; atribuição transacional no servidor, coordenada com persistência do evento. Testar concorrência, repetição, falha parcial e restauração sem repetição/reinício.

Tipos de eventos, relação com NSR e representação no AFD devem ser definidos pelo Anexo IX/leiaute antes do código. Não converter automaticamente todo log operacional em registro fiscal.

ARP preserva originais. Ajuste posterior pertence ao PTRP. Restauração deve demonstrar continuidade, integridade, contagem e ausência de duplicação.

**Incremento local de 18/10/2026, substituído em 24/10/2026:** a primeira implementação colocou `repP_*` no `coala-rh`. A decisão posterior separou a ARP oficial no banco `coala-rep-p`; piloto e PTRP continuam no RH. Tentativa, NSR, original tipo 7 e cabeçalho permanecem atômicos dentro da ARP dedicada, e reenvio/concorrência seguem cobertos pelos ensaios.

### 5.6. Hash e evidência

Implementar o hash fiscal exatamente conforme especificação vigente. Definir separadamente a eventual cadeia interna de auditoria. Hash do comprovante e registro correspondente devem ser coerentes.

Testar alteração de conteúdo, substituição de sequência e tentativa de reescrita privilegiada. Preservar evidência fora do domínio de escrita normal, conforme projeto aprovado.

O tipo 7 implementa e testa o SHA-256 do leiaute AFD 004, inclusive campos fixos e a marcação anterior. Eventos 2/5 podem ocupar NSRs intermediários sem romper a cadeia de marcações. O candidato puro ainda declara `synthetic_only`/`not_persisted`; o serviço o envolve como original persistido apenas após commit atômico na ARP. Isso não afirma proteção contra acesso administrativo privilegiado.

### 5.7. Comprovante

PDF PAdES assinado com e-CNPJ da CT Sorvetes LTDA, prevista como desenvolvedora. Acesso após cada marcação, sem solicitação/autorização prévia, com extração de pelo menos últimas 48 horas.

Campos mínimos a conferir contra art. 79/leiaute: título, NSR, empregador/identificadores, local/endereço aplicável, trabalhador/CPF, data/hora, registro INPI e hash. Checklist campo a campo na Fase 0.

Geração assíncrona só é aceitável com acesso e recuperação definidos; não permite espera indeterminada. Guardar bytes efetivamente emitidos, assinatura e vínculo à marcação. Não regenerar silenciosamente um documento diferente.

Após registrar no app/web, exibir a batida e ação para abrir/baixar seu PDF, distinguindo persistência de emissão do comprovante. Histórico permite hoje, dia escolhido e período. Cada batida tem seu comprovante; relatório que reúne um dia não substitui os originais. Estados pendente/erro exigem recuperação monitorada sem duplicar marcação; indisponibilidade de assinatura deve seguir contingência definida.

No Coala Go, compartilhar os arquivos pela folha nativa do Android (WhatsApp, e-mail ou demais aplicativos disponíveis), com escolha e confirmação pelo usuário. No Coala One, download e compartilhamento quando suportado. Nunca presumir destinatário nem envio bem-sucedido; ausência de app compatível oferece download. Preservar bytes assinados: lote em ZIP com índice e PDFs originais, sem fundir/reimprimir como substituição. Especificação funcional e critérios de aceite no plano mestre, seção 3.9.

**Incremento local de 18/10/2026 (etapa 5):** cada marcação cria na mesma transação um comprovante pendente com snapshot congelado; o PDF determinístico é assinado depois do commit por contrato PAdES incremental e gravado uma única vez. A API devolve `receiptStatus: available|pending`; GET do próprio colaborador baixa os bytes emitidos e POST reemite pendente sem nova batida. Sem e-CNPJ, o assinador padrão recusa e o comprovante permanece pendente — nenhum documento válido é emitido. Checklist art. 79, monitoração e telas continuam abertos. Detalhes no [guia do fluxo](engineering/flows/dp-time-recording.md#etapa-5--comprovante-pdfpades).

### 5.8. AFD

Gerado pelo REP-P a partir dos originais, prontamente extraível para fiscalização. Seguir versão oficial quanto a registros, campos, codificação, CRC/hash, datas, nomenclatura e assinatura.

Assinatura CAdES destacada, arquivo `.p7s`, com certificado da CT Sorvetes LTDA, prevista como desenvolvedora. Exportação registra período, estabelecimento, versão, responsável e integridade dos arquivos.

Pendência de ajuste, aprovação de espelho ou fechamento não impede acesso ao AFD. Simulação fiscal deve testar extração e verificação independente.

**Incremento local de 18/10/2026:** gerador AFD 004 cobre cabeçalho, tipos 2/4/5/6/7, trailer, CRC-16/KERMIT, SHA-256, ISO-8859-1, CRLF, nomenclatura e linha indicadora do `.p7s`. A rota administrativa entrega o AFD e a assinatura destacada produzidos sobre os mesmos bytes. O contrato recusa certificado de CNPJ diferente da CT Sorvetes. O provedor real não está configurado: sem CAdES ICP-Brasil, a exportação falha fechada; a assinatura sintética do teste não tem valor jurídico.

### 5.9. Operação e segurança

Monitorar falha de gravação, comprovante, hora, integridade, exportação, certificado e recuperação. Definir responsável, resposta e escalonamento.

Rotas seguem contrato de segurança do projeto; MFA para administradores; menor privilégio, consultas limitadas e auditoria de configuração. Não registrar segredos. Testar contingência e restauração antes do piloto.

### 5.10. Contingência operacional — contrato a homologar antes da coleta real

Responsável funcional: RH responsável; execução técnica: responsável técnico de operação; apoio local: gestor da unidade. A Administração deve nomear titulares/substitutos e canal de acionamento antes do piloto. Os papéis abaixo não equivalem a pessoas já designadas.

| Falha | Resposta e recuperação | Aceite / responsável |
| --- | --- | --- |
| Sem rede/serviço antes de persistir | Não mostrar sucesso. Orientar canal alternativo previamente homologado; no piloto, manter Bizneo oficial. Preservar evidência da tentativa quando possível, sem fabricar marcação original retroativa | Simulação de perda de conexão; operação técnica e gestor local |
| Resposta perdida após envio | Consultar tentativa pelo ID; repetir com a mesma chave. Distinguir desconhecida de rejeitada; não pedir nova batida como se a anterior não existisse | Falha após commit recupera a mesma marcação; desenvolvimento |
| PDF/assinatura indisponível | Se já persistiu, manter original, mostrar emissão pendente e acionar incidente; recuperar o mesmo documento vinculado. Se não há capacidade de cumprir emissão, ativar alternativa homologada; espera indefinida não é contingência | Ensaio de indisponibilidade/certificado e acesso recuperado; operação técnica |
| Hora ou identidade fiscal não confiável | Não inventar instante/empregador; preservar tentativa como evidência separada e encaminhar à alternativa. Tratamento posterior identificado no PTRP, não inserção simulando batida original | Testar desvio e identidade ambígua; técnico + RH |
| Restauração | Reconciliar originais, sequência, comprovantes e fila; liberar serviço após validação técnica e RH | Ensaio sem perda/duplicação e checklist de retorno |

Antes da Fase 8, registrar alternativa válida por estabelecimento também para quando Coala for oficial, responsáveis nominais, tempos de detecção/resposta/recuperação e critérios de escalonamento. Esses tempos são metas operacionais a aprovar, não prazos legais presumidos. Ausência desse procedimento impede promoção. Nenhuma falha pode ser silenciosamente convertida em falta do empregado.

## 6. PTRP e documentos

Detalhes funcionais no [plano mestre](plano-jornada-fechamento-rh.md).

- Originais preservados; inclusão, desconsideração e pré-assinalação identificadas.
- Ajustes guardam motivo, evidência, autoria, decisão e reversões.
- Não completar horários automaticamente apenas para produzir pares.
- Jornadas atravessando meia-noite permanecem coerentes no pareamento.
- AEJ conforme L7, CAdES destacado, assinado pela CT Sorvetes LTDA, prevista como desenvolvedora do PTRP.
- Espelho acessível mensalmente ou em período menor, com identificação, período, horário contratual e marcações/tratamentos exigidos.
- Conferir pré-assinalação e campos contratuais antes da geração.
- Ocorrência não resolvida impede declarar documento conforme; não autoriza ocultar fatos ou reter originais.
- Assinatura/ciência do empregado não substitui conformidade técnica nem quita direitos. Prever contestação.
- Ausências seguem [contrato do DP](engineering/flows/dp-absences.md); anexos médicos não entram em AFD, AEJ ou projeção de escala.
- **Documento de fechamento declara todos os tratamentos e pedidos do período (decisão do programador, 19/10/2026).** O espelho/documento de fechamento da competência lista, por pessoa e dia, todo pedido que afetou a jornada: ajustes de ponto (original × novo, tipo inclusão/desconsideração, justificativa, solicitante, decisor, instantes e situação, inclusive recusados e revertidos), ausências (tipo, período, situação e forma de aprovação, inclusive **aprovada por decurso de prazo**) e demais tratamentos (troca de unidade, pré-assinalação). Nada que alterou ou justificou a jornada fica fora do documento; o detalhe sigiloso (anexo médico, motivo longo) é referenciado, não reproduzido. Detalhes no [plano mestre, seção 10](plano-jornada-fechamento-rh.md).
- Documentos gerados entram no catálogo oficial, com política de acesso/publicação explícita.

### 6.1. Tipos, localização e distribuição

“Documentos fiscais” não é nome genérico da tela pessoal. A interface deve distinguir:

| Documento | Finalidade | Acesso e armazenamento lógico |
| --- | --- | --- |
| Comprovante por marcação | Evidência de cada batida, PDF assinado | Meu ponto no app/web e referência na pasta do próprio colaborador; abrir, baixar e compartilhar |
| Resumo diário ou por período | Consulta das marcações e apuração, parcial quando aplicável | App/web e exportação pessoal identificada como relatório, sem substituir comprovantes/espelho |
| Espelho de ponto | Originais e tratamentos do período | Pasta do colaborador e app/web, com período, estado e versão de fechamento; baixar/compartilhar |
| Escala planejada | Previsão de trabalho | Módulo de escala; documento distinto do registro efetivo |
| AFD e AEJ, com respectivas assinaturas `.p7s` | Extração fiscal de originais/tratamentos | Área administrativa restrita por estabelecimento/período; não liberar arquivo multiempregado na pasta pessoal |

Catálogo referencia um único original protegido e seus metadados, evitando cópias divergentes entre app, web e pasta. Autorizações no servidor por pessoa, estabelecimento e função; links temporários não podem permitir descoberta de documentos alheios. Exportação paginada/limitada e retomável, com indicação de falhas e itens faltantes. Preservar versões anteriores de espelhos após reabertura, identificando qual é vigente; comprovantes originais não são reescritos pelo fechamento.

Testar integridade dos bytes após download/compartilhamento, isolamento entre pessoas, virada de dia/fuso, períodos parciais, recuperação de emissão e cancelamento de compartilhamento. Abertura do seletor externo não é confirmação de entrega; logs não devem capturar conteúdo de mensagens ou destinatários de apps externos.

## 7. Certificados e assinaturas

| Finalidade | Titular/assinatura |
| --- | --- |
| Comprovante PAdES | e-CNPJ da CT Sorvetes LTDA, prevista como desenvolvedora |
| AFD CAdES destacado | e-CNPJ da CT Sorvetes LTDA, prevista como desenvolvedora do REP-P |
| AEJ CAdES destacado | e-CNPJ da CT Sorvetes LTDA, prevista como desenvolvedora do PTRP |
| DV no depósito direto ao INPI, titular pessoa jurídica | e-CNPJ da CT Sorvetes LTDA |
| DV por procurador | Seguir L9: procuração do titular e DV pelo procurador com e-CPF |
| Atestados REP-P/PTRP | Certificados pessoais ICP-Brasil dos responsáveis legal e técnico |

A1 é opção técnica de automação, não requisito legal exclusivo. Serviço remoto/HSM pode ser avaliado se atender os padrões e controles. Não presumir que todo A3 exige presença a cada assinatura.

Certificado de teste serve apenas às fases sintéticas. Assinatura gov.br avançada não substitui assinatura qualificada quando esta for exigida.

Responsável provisiona chave/senha diretamente no mecanismo seguro escolhido; agentes não recebem nem leem o material. Se A1 em Secret Manager, somente serviço de assinatura tem acesso. Preservar continuidade, revogação, renovação e evidências das assinaturas antigas. Alertas antecedem o vencimento real do certificado, sem presumir prazo universal.

## 8. INPI e atestados

### 8.1. Registro

Identificar o módulo REP-P e a titular CT Sorvetes LTDA — CNPJ 14.276.603/0001-25. Preservar pacote e hash exatos da versão registrada, com rastreabilidade da compilação/configuração.

Conferir código/valor de serviço no momento do pedido; não fixar tarifa neste plano. Obter certificado antes do piloto real. Registro protege a identificação/titularidade, não comprova aderência trabalhista do cálculo.

Número INPI é configuração controlada; sua inserção não deve exigir mudança de código. Alterações na versão candidata exigem reconciliar registro, documentação e testes.

### 8.2. Atestados REP-P e PTRP

Produzir documentação que contemple expressamente os dois componentes, suas versões, desenvolvedora, destinatários e responsáveis, no modelo oficial. Planejar atestados específicos de cada componente.

Assinaturas pessoais dos responsáveis legal/técnico em PDF no padrão aplicável. Atestado da matriz pode abranger filiais; outras matrizes do grupo exigem documentação própria (L5, item 43).

Cada mudança deve ter análise de impacto sobre versão/atestados/registro. Não afirmar que atestado se assina “uma única vez” independentemente das mudanças.

## 9. Privacidade e guarda

Obrigatório desde a primeira coleta real, inclusive piloto:

- Inventário de nome, CPF, jornada, dispositivo, documentos e eventuais dados adicionais.
- Base legal e finalidade por tratamento; obrigação de ponto não autoriza automaticamente localização ou tratamento irrestrito de saúde.
- Avisos claros, direitos do titular, acesso após desligamento e canal de contestação.
- Segregação de anexos sensíveis, minimização e registro de acessos.
- Avaliação de fornecedores, localização do tratamento e transferência internacional quando aplicável.
- Resposta a incidentes conforme LGPD/ANPD, com responsáveis e prazos vigentes.
- Retenção por classe documental e finalidade, aprovada antes de configurar descarte/travas.

48 horas é mínimo de acesso aos comprovantes, não prazo de guarda. Prescrição não vira descarte automático. Considerar litígios, fiscalização, interrupções/suspensões e obrigações específicas.

A política existente de 20 anos para anexos de ausências deve ter fundamento revisado separadamente; não se presume prazo legal geral de atestados médicos, ARP ou registros Bizneo.

## 10. Execução e gates

Ordem canônica no [plano mestre](plano-jornada-fechamento-rh.md#6-fases):

- Fase 0: conferir fontes, matriz, regras, privacidade e retenção.
- Fase 1: identidade fiscal e jornada histórica.
- Fase 2: REP-P sintético, comprovante/AFD e contingência.
- Fases 3/4: PTRP, AEJ/espelho e simulação fiscal.
- Fases 5/6: fechamento/contador e validação integrada sintética.
- Fase 7: INPI, atestados definitivos e teste da configuração final. As amostras com e-CNPJ/e-CPF já foram validadas no ITI.
- Fase 8: piloto técnico com um usuário, antecipado por decisão do programador (19/10/2026); comprovantes sem validade até o lançamento total; sem paralelo com o Bizneo.
- Fases 9/10: lançamento total por estabelecimento, depois das Fases 3 a 7; saída do Bizneo simplificada, sem importação.

Sequência vigente e estado de cada fase: [plano mestre, seção 6](plano-jornada-fechamento-rh.md#sequência-vigente-19102026).

Nenhum dado sintético vira registro oficial. Registro de piloto real é preservado como tal, pode produzir prova e exige apuração de divergências.

## 10-A. Revisão normativa de 18/10/2026 (Doc Brown)

Revisão orientativa, sem valor de parecer, sobre o código local das etapas 1–6. As fontes estão no [registro de normas](rep-p/referencias/README.md). Três defeitos bloquearam o commit e foram corrigidos:

- **INPI:** o comprovante passou a aceitar só dígitos, com até 17 posições. O número real tem 13 dígitos (P&R 49).
- **Comprovante impossível:** a batida passou a ser recusada antes de consumir NSR quando falta cadastro fixo do comprovante (local, INPI, razão social ou nome). Falha só do assinador continua gravando a batida, com o comprovante pendente.
- **Relógio do coletor:** a tela passou a exibir a hora oficial com horas, minutos e segundos, no fuso do estabelecimento, e bloqueia o botão quando a hora oficial está indisponível (Anexo IX, item 3).

**Configuração atualizada em 25/10/2026:** `coala-rep-p` guarda a ARP oficial com backup diário de 14 semanas, PITR e proteção contra exclusão. O teste `dp-rep-p-arp-deletion-guard` impede exclusões e enumeração; regras dedicadas negam clientes. A deny policy condicionada à tag nega escrita às contas genéricas, e a restauração do primeiro backup dedicado terminou com comparação idêntica e remoção do banco descartável.

Pendências nomeadas, mantidas por decisão do programador. `REP_P_MARKING_ENABLED=false` bloqueia toda batida real antes de tocar a ARP, mesmo com Hora Legal saudável; além disso, quando o gate vier a ser liberado, cada batida continuará falhando fechada se a Hora Legal pública não for atestada:

| Pendência | Origem | Gate |
| --- | --- | --- |
| Eventos tipo 6 (indisponibilidade/retorno) e decisão sobre tipo 4 gravados na ARP | Anexo IX 6.2 e 6.4 | Candidata tipo 6 implementada em 25/10 com sonda externa, Cloud Monitoring, Pub/Sub, replay idempotente e gate oficial; falta publicar/ensaiar. Tipo 4 só será necessário se houver ajuste do relógio gravado pelo REP |
| Reemissão, `/M`/`signingTime` pela hora legal e fila de pendentes permanentes | Art. 80 II | **Decisão de 23/10/2026:** falha do assinador não elimina nem altera a batida. NSR e instante original são preservados; o comprovante fica visivelmente pendente e é assinado depois. Feito em 18/10/2026: reemissão automática a cada 15 minutos sem tocar a ARP, AFD paginado em fotografia única, fila ordenada pela próxima tentativa (espera de 15 e depois 30 min) e `/M`/`signingTime` pela hora legal, com testes. Em 24/10/2026, o índice `nextAttemptAt` e os demais índices do `coala-rep-p` foram publicados e confirmados `READY`; como a coleta segue desligada, não há comprovantes reais. Repetir a consulta de pendentes sem `nextAttemptAt` imediatamente antes de ligar a flag |
| Política de assinatura ICP-Brasil: AFD/CAdES, comprovante/PAdES e e-CPF aprovados no VALIDAR/ITI em 25/10/2026, inclusive cadeia, estrutura, resumo criptográfico e atributos, sem alertas | Art. 88; DOC-ICP-15.03 | **Concluído.** Evidências e hashes no [estado documental canônico](rep-p/homologacao/README.md#fonte-canônica-do-estado-documental). O AEJ/CAdES foi declarado validado pelo responsável; falta somente anexar seu relatório específico ao dossiê atual |
| Carimbo de tempo emitido por ACT | DOC-ICP-11 e política aplicável | **Decisão de 23/10/2026:** não é gate. Preservar bytes, certificado e cadeia; monitorar e renovar e-CNPJ/e-CPFs antes do vencimento; impedir novas assinaturas com certificado vencido |
| Preenchimento dos campos numéricos do AFD | Leiaute AFD, regra 7 | **Resolvido:** conteúdo à esquerda e espaços à direita; conferir somente a amostra final e o hash do tipo 7 |
| ARP imutável (backup agendado, PITR e proteção contra exclusão no `coala-rep-p`; cópia longa trancada), retenção e contingência | Anexo IX 7; plano 5.10 | Piloto |
| Batida recusada quando a data do aparelho diverge da hora oficial (virada de dia, celular desregulado) | Art. 74 | Decidir antes do piloto |
| NTP público do ON no runtime, INPI, atestados, simulação fiscal | Arts. 89 e 91; Anexo IX | Publicar e homologar antes do piloto |
| Volume do AFD: teto de 50 mil eventos por exportação (medição em 18/10/2026; um estabelecimento de ~40 pessoas passa disso em cerca de um ano). Duas exportações simultâneas dobram o pico de memória (instância única de 1 GiB). A recusa acima do teto não grava auditoria. Gerar em fatias/streaming ou limitar uma exportação por vez | Art. 81 §2º | Antes de fiscalização real. **Pergunta ao advogado:** entregar o AFD em partes por período cumpre o art. 81 §2º, e a fiscalização pode exigir arquivo único? |
| Atalho **Bater ponto** na barra superior (18/10/2026): aparece só com a coleta ligada, vínculo elegível e unidade; não fecha com a batida em andamento e oferece o comprovante quando emitido. Se a leitura das opções falhar, o botão some. Caminho fixo resolvido em 19/10/2026: item **Registro de ponto** na barra lateral (Gestão do colaborador). Comprovante pendente é disponibilizado nessa tela quando a assinatura posterior termina | Art. 80; Anexo IX 3 | Resolvido pela decisão de contingência de 23/10/2026; ensaiar o acesso às últimas 48 h antes de ligar `REP_P_MARKING_ENABLED` |
| ReSinc/HLB certificada | Anexo IX item 2; serviço do ON | **Pendência:** serviço pago; não se concluiu que seja necessário para REP-P virtual |
| Perguntas da maquete do Registro de ponto (19/10/2026) | Arts. 74, 80, 82, 84; CLT arts. 58 §1º e 71 | **Perguntas ao advogado:** (1) registrar troca de unidade para conferência do DP, sem bloquear a batida, é adequado? (2) Fuso: **decidido pelo programador em 19/10/2026** que a batida usa o fuso da unidade de execução (sem cadastro, o do estabelecimento); confirmar com o advogado que o AFD com fusos diferentes por marcação no mesmo estabelecimento é aceito. Confirmar também se o cabeçalho do AFD continua no fuso do estabelecimento. Risco técnico registrado: o filtro por data civil (`recordedDate`, no fuso da unidade) pode deixar NSR consecutivos em dias diferentes na borda de um período exportado, criando lacuna aparente de NSR; tratar junto com o fatiamento do art. 81 §2º antes de fiscalização. (3) A tolerância de 5 min do art. 58 §1º vale para o intervalo? (4) Aprovação de ausência por decurso de prazo (3 dias) é aceitável, inclusive com atestado não conferido? Pode ser revertida e com que justificativa? |
| Tela Registro de ponto, etapa 1 (19/10/2026) | Art. 74; art. 80; Anexo IX 3 | Saldo e itens "a conferir" são prévia, não apuração; a tela não usa a palavra "abono". **Decisão jurídica/DP:** ausência aprovada abona a jornada ou só justifica (depende de CCT e banco de horas)? Hoje a ausência aprovada ou em análise apenas cobre o dia na prévia, sem gerar crédito. Avisos de intervalo (±5 min) e de desvio (10 min) são de conferência, não a tolerância do art. 58 §1º CLT. Jornada que atravessa a meia-noite fica sem avisos até o PTRP. |
| Ajuste de ponto pedido pelo colaborador (orientação Doc Brown, 19/10/2026) | Art. 74 IV; art. 82 p.ú.; art. 84 V; leiaute AEJ registro 05 | Original nunca é alterada; "substituir" = desconsideração (`tpMarc` D) + inclusão (`fonteMarc` I) atômicas no PTRP, com `motivo` ≤150 caracteres (obrigatório para D e I). Colaborador solicita; gestor/DP decide; solicitante nunca aprova o próprio pedido; nenhuma hora é preenchida pelo sistema. Autoria por ato (UID, papel, instante pela Hora Legal, canal, hash encadeado), reversão cria registro novo. **Pendências:** arquivar leiaute AEJ com hash; conferir `fonteMarc` "I " com espaço e a representação da linha D. **Perguntas ao advogado:** colaborador pode executar sem decisão? AEJ precisa identificar autor/decisor? Pedido após fechamento exige reabertura e quem autoriza? Ciência do espelho exige assinatura e o que fazer na discordância? Inclusão sem evidência vale como prova? Retenção do histórico e de IP/dispositivo? |
| Georreferenciamento local e acompanhamento de jornada (22–24/10/2026; implementados e desligados) | Art. 74; LGPD arts. 6º, 7º, 9º, 37, 38 e 46; orientação laboral CNPD | A [implementação técnica](engineering/time-recording-geolocation.md) separa localização da ARP, coleta pontualmente na confirmação e, nos turnos configurados como `Entre unidades` + `Durante a jornada`, acompanha a jornada com pausa, retomada, encerramento e kill switch. Nunca bloqueia a marcação nem cria efeito automático em PTRP, folha ou disciplina. A evidência tem TTL de 1.825 dias. **Gates restantes:** cláusula/aditivo, RIPD, aviso HTTPS, parâmetros físicos, configuração dos turnos reais, publicação e ensaio da consulta autorizada/auditada já implementada localmente e ensaio em aparelho antes de ligar `DP_JOURNEY_LOCATION_ENABLED`. |

### 10-B. Decisões do programador sobre as perguntas jurídicas (19/10/2026)

Decisões de produto registradas a partir da lista consolidada de perguntas; não substituem o parecer do advogado nos pontos marcados "confirmar".

| Tema | Decisão do programador | Efeito no sistema |
| --- | --- | --- |
| Ajuste de ponto: quem decide | O ajuste sempre precisa de aprovação; o fluxo de aprovação exige justificativa | Colaborador solicita; gestor/DP aprova com justificativa obrigatória; solicitante nunca aprova o próprio pedido |
| Ajuste no AEJ | O arquivo do fechamento identifica quem pediu e quem decidiu | Autor e decisor por ato, além de tipo e motivo |
| Pedido depois do fechamento | Não existe: período fechado não aceita pedido | Pedido de ajuste ou ausência para competência fechada é recusado no servidor |
| Ciência do espelho | Assinatura do pacote individual na Autentique; sem assinatura, o individual e o fechamento geral ficam pendentes, inclusive depois de 24 horas | Lista da versão congelada, individual pendente/fechado e geral somente depois da assinatura de todos |
| Inclusão sem evidência | Vale como prova: a cadeia de autoria comprova que foi o titular quem pediu | Evidência opcional; justificativa, aprovação e trilha de autoria obrigatórias |
| Ausência abona ou justifica | Depende do efeito cadastrado no tipo (`workdayEffect`) | Fechamento aplica o efeito do tipo; a tela mostra a prévia conforme o efeito |
| Reversão de ausência aprovada por decurso | Só com fraude comprovada; implementação futura | Sem reversão comum; pendência de fluxo de fraude |
| Ajuste de ponto — pendências da revisão (Doc Brown, 19/10/2026) | Art. 82; leiaute AEJ registro 05 | **Gate de piloto:** o bloqueio de competência fechada depende de a etapa 6 gravar `ptrp_competenceClosures/{workspace}_{AAAA-MM}`; o fechamento deve impedir fechar com pedido pendente ou cancelá-lo com ato registrado. **Perguntas ao advogado:** instante do ato pela Hora Legal com reserva do relógio do servidor (`clockSource` gravado) basta, ou o ato deve ser recusado sem Hora Legal? O AEJ tem campo para solicitante e decisor, ou ficam no dossiê com a justificativa do decisor no motivo? Inclusão sem evidência como prova unilateral (Súmula 338 TST). **Falta para o AEJ:** leiaute arquivado com hash, gerador do registro 05 (D/I, motivo, NSR), vetores de teste e mapa de `codHorario`. |
| Decurso em tipo com atestado obrigatório (orientação Doc Brown, 19/10/2026) | Pendente de confirmação: o decurso aprova também tipos com anexo obrigatório ainda não conferido? Alternativa: aprovar a ocorrência sem efeito de abono até o DP conferir | Hoje aprova com o efeito do tipo; aprovação depois do fechamento deve ser tratada no reprocessamento sem alterar espelho assinado; alerta ao DP para pedido vencido que não pode ser aprovado sozinho |
| Tolerância | Uma só, na jornada (até 10 min por dia, art. 58 §1º); vale para saldo, banco e avisos de entrada, saída e intervalo | `toleranceMinutes` da jornada (plano mestre 3.6); turno e política de extra sem tolerância |
| Fracionamento do intervalo | Respondido pelo planejamento das modalidades (plano mestre 3.6.1) | Modalidades fixas/flexíveis conforme cadastro |
| Retenção | Decisão operacional: mínimo de 20 anos para ARP, AFD, comprovantes, histórico de ajustes, trocas e evidências, sem TTL nos documentos centrais; confirmar por classe com o advogado se o prazo uniforme preserva a finalidade sem retenção excessiva pela LGPD | Política de retenção de 20 anos; validação jurídica pendente |
| Atestado assinado pela empregadora | Sim: a CT Sorvetes assina como desenvolvedora sendo também a empregadora | Confirmar com o advogado (pergunta mantida) |
| Comprovante com atraso | Sem aviso ao sindicato; os registros de contingência (motivo, tentativas, horário de emissão) ajudam na fiscalização e ficam guardados | Mantidos `lastIssue`, `attempts` e instante de emissão |
| Comprovante disponível depois | Basta o aviso de indisponibilidade; quando emitido, a pessoa baixa o comprovante, sem notificação no sino | Janela e dia mostram "comprovante em emissão" e liberam o download depois |
| Unidade e fuso da batida | A unidade vem da escala, com o fuso dela; troca de unidade é registrada sem bloqueio e conferida pelo DP | Implementado na etapa 2 |
| Fusos no AFD | Unidade em outra cidade/fuso terá CNPJ próprio (estabelecimento e AFD próprios); o que importa é a carga horária. Fuso em cada linha de batida; o cabeçalho segue o leiaute | Pergunta retirada; caso residual: empregado de um CNPJ cobrindo unidade em outro fuso grava o fuso da unidade na linha da batida |
| Formato dos campos do AFD | Leiaute 004 item 7: conteúdo à esquerda e espaços à direita, inclusive numéricos; exceções literais (`004`, `01`/`02`, zeros do cabeçalho). CPF de 12 posições com espaço à direita (FAQ MTE 50 aceita também zero à esquerda; padronizado espaço). CRC-16/KERMIT com vetor oficial `123456789` → `2189`. Não há validador oficial público do AFD; o VALIDAR do ITI confere só a assinatura | Já implementado assim (`core.ts` `numericField`/`nsrField`/`cpfField`, `afd.ts`; teste do vetor CRC). Resta sem vetor oficial a serialização exata do SHA-256 do tipo 7: manter teste próprio e, se houver dúvida, consulta técnica à SIT |
| Carimbo do tempo para a guarda | Pergunta retirada pelo programador | Mantida a assinatura com a hora oficial registrada; sem ACT |
| Certificado do INPI no atestado | O atestado sai com o registro completo quando o INPI concluir | Sem "N/A" |
| Validade dos comprovantes no ensaio | O ensaio segregado não tem validade REP-P; a coleta oficial só nasce após a ativação fiscal e seus gates | Assinatura de amostra aprovada no ITI em 25/10/2026; isso não promove nem converte documentos do ensaio |
| AFD fracionado | Questão jurídica encerrada: o FAQ MTE 39 autoriza fracionar o AFD do REP-P; o teto de 50 mil eventos por arquivo pode ficar | Antes da produção, conferir tecnicamente: (1) cada parte é AFD válido com cabeçalho e trailer — atende; (2) cada parte tem seu `.p7s` CAdES — atende; (3) NSR original sem reinício — atende; (4) partes sem omissão nem duplicação na fronteira de datas — falta teste de fronteira; (5) exportar o período inteiro — hoje acima de 50 mil a exportação recusa e pede dividir o período manualmente; falta gerar as partes automaticamente e auditar a recusa |
| Feriados no comércio (MTE 1.316/2026) | Fora do escopo do ponto por ora | Pergunta retirada |
| Piloto | Piloto geral liberado pelo programador; primeiro teste com um usuário | Ligar `REP_P_MARKING_ENABLED` continua sendo ação de produção com autorização própria e gates do item 10-A |
| Registro oficial x Bizneo | Irrelevante: nada é importado do Bizneo | Pergunta retirada |
| Duas assinaturas no atestado | Responsáveis legal e técnico diferentes assinam o mesmo PDF, cada um com seu e-CPF | Fluxo de assinatura com dois PAdES no mesmo documento |
| LGPD da geolocalização | Decisões de produto: cláusula LGPD da empresa, comunicação complementar para atuais, aviso contextual, acesso pelo titular e DP/diretoria expressamente autorizados, guarda operacional de1.825dias | Termo v5 e minutas de política/comunicação/RIPD preparados; consulta auditada implementada localmente. Falta aprovação de base/necessidade/retenção por modalidade e publicação/ensaio; ver docs/rep-p/privacidade e guia REP |
| Atestado técnico | Um atestado quando o sistema estiver validado; a necessidade de novo atestado a cada alteração será analisada depois da liberação total | Atestado único na liberação; reavaliar por versão depois |

## 11. Matriz de requisitos legais

**Tipos:** O = obrigação; C = controle técnico escolhido; D = decisão de produto.

**Fonte:** referências L1–L12 da seção 2. “Conferir” indica pendência documental, não autorização para implementar com suposição. Nenhuma linha está implementada/verificada apenas por constar desta matriz.

Na Fase 0, desdobrar itens em requisitos atômicos com artigo/item exato, versão, abrangência, responsável e evidência de aceite. Antes do piloto, nenhuma obrigação aplicável pode continuar sem fundamento ou evidência.

**Situação documental explícita por ID:** não confundir referência consultada com verificação integral do requisito ou implantação.

| Estado | IDs | Próxima evidência necessária |
| --- | --- | --- |
| Pendente de conferência normativa integral | R1, R2, R6, R7 | Artigos/anexos e campos/vetores exatos; responsável técnico + jurídico, Fase 0 |
| Parcial: há orientação/fonte consultada, falta completar redação, campos ou abrangência | R3, R4, R10, P1, P2, P4, D1, D4 | Requisito atômico e aplicabilidade; jurídico + técnico, Fase 0 |
| Orientação específica consultada; validação integral de vigência/aplicabilidade pendente | R5, R11, R12, R13, P3, D2, D3 | Preservar evidência oficial e confirmar versão aplicável; técnico + jurídico, Fases 0/7 |
| Aplicação concreta pendente | P5 | Instrumentos e cenários por vínculo; DP/jurídico, Fases 0/3 |
| Decisão de produto registrada, sem aceite de implementação | R14, R15 | Ensaios e inspeção dos dados coletados; desenvolvimento, Fases 2/6 |
| Controle técnico/governança planejado, não verificado | R8, R9, P6, D5, D6 | Projeto, responsáveis e teste/evidência por fase indicada |

Todos os IDs permanecem com implementação/eficácia **não verificadas**. Uma fonte já consultada não é apagada pelo acesso incompleto a L3; também não transforma a linha em conformidade aprovada. Revisão da matriz exige data, responsável e evidência por requisito.

| ID | Tipo | Requisito/controle | Fonte e situação documental | Fase / evidência de aceite |
| --- | --- | --- | --- | --- |
| R1 | O | Identificação de empregado/empregador | L3 arts. 78–80/Anexo IX; conferir integralmente | 2: impedir atribuição ambígua |
| R2 | O | Hora legal, limite e relógio do coletor | L3 Anexo IX; conferir integralmente | 2: desvio, fuso e contingência |
| R3 | O | Registro fiel sem bloqueio por horário/autorização de extra | L2 arts. 31–32; L3 art. 74, conferir redação | 2: aceitar fora da escala/ausência |
| R4 | O | Preservar originais | L2/L3; L5 item 55 | 2/3: tratamento não altera ARP |
| R5 | O | NSR por estabelecimento fiscal | L5 item 41 | 2: concorrência/reenvio/restauração |
| R6 | O | Eventos e estrutura ARP exigidos | L3 Anexo IX e L6; conferir mapeamento integral | 2: cada evento exigido representado. **Lacuna aberta (10-A):** tipos 6 e 4 são serializados, mas ainda não são gravados na ARP; ausência de pulso do Scheduler não será convertida em indisponibilidade fiscal sem evidência externa do coletor |
| R7 | O | Hash fiscal da marcação | L6; L3 art. 79 | 2: vetores e coerência comprovante/AFD |
| R8 | C | Escritor dedicado, privilégio mínimo e evidência independente | Projeto de proteção, não tecnologia imposta por lei | 2: tentativa de reescrita detectada/impedida |
| R9 | C | Backup/restauração e preservação independente | Projeto a aprovar; L3 Anexo IX a conferir | 2/6: recuperação íntegra e continuidade |
| R10 | O | Comprovante PDF assinado e acesso após marcação | L5 itens 30/40; L3 arts. 79–80 | 2/7: campos, PAdES e acesso. Campos/INPI e pré-requisitos corrigidos em 10-A; reemissão automática a cada 15 min com fila justa e `/M` pela hora legal publicada em 21/10/2026. **Política ICP-Brasil concluída:** amostra PAdES aprovada no VALIDAR/ITI em 25/10/2026. **Lacuna operacional restante:** ensaiar no ambiente publicado o acesso quando o comprovante estiver pendente e sua disponibilização posterior, cobrindo ao menos 48 h |
| R11 | O | Extração mínima das últimas 48 h | L5 item 40 | 2: download independente do RH |
| R12 | O | AFD oficial extraível pelo REP-P | L6; L5 itens 38/39 | 2/4: formato e simulação fiscal |
| R13 | O | AFD CAdES destacado pelo desenvolvedor | L5 itens 28/33 | 2/7: assinatura real e arquivo verificados |
| R14 | O por decisão de produto | Web on-line; contingência implementada no Coala Go para falta de rede ou indisponibilidade explícita da HLB, pré-autorizada por 12 h, fila cifrada/assinada e sincronização modo 1. O ensaio usa autorização e domínio criptográfico segregados, sem NSR/ARP/AFD/AEJ | L5 item 52; AFD 004 registro 7 | Embora facultativa na Portaria, é requisito do Coala para prontidão; fluxo automatizado do ensaio passou, faltam aparelho físico e atestação do APK direto `enforce` |
| R15 | D | Sem localização/biometria no MVP | Escopo e L10 | Antes do piloto: conferir dados coletados |
| P1 | O | Tratamentos identificados e originais preservados | L3 art. 82; L5 itens 55/56 | 3: inclusão/desconsideração/reversão |
| P2 | O | AEJ no leiaute e pares por jornada | L7; L5 itens 51/56–59 | 4: casos inclusive virada de dia |
| P3 | O | AEJ CAdES pelo desenvolvedor PTRP | L5 itens 29/34 | 4/7: assinatura verificada |
| P4 | O | Espelho, acesso periódico e pré-assinalação | L3 arts. 83–84; L5 item 54; conferir campos | 4: conteúdo e acesso |
| P5 | O | Regras de jornada efetivamente legais | L1 e instrumentos reais ainda pendentes | 0/3: cenários validados |
| P6 | C | Histórico, explicação e reprocessamento por dependências | Arquitetura do plano mestre | 3/5: dia/semana/banco/competência |
| D1 | O | Registro REP-P no INPI | L3 art. 91, conferência integral pendente; L9 | 7: certificado e pacote preservados |
| D2 | O | Atestados REP-P/PTRP | L8; L5 itens 36/37/43/45 | 7: componentes/versões/destinatários |
| D3 | O | Assinaturas qualificadas pertinentes | L5 itens 33/34/44/45; L9 | 7: titularidade e validação real |
| D4 | O | LGPD aplicável ao tratamento | L10/L11 | 0/7: controles prontos antes da coleta real |
| D5 | C | Revisão jurídica e contábil inicial/final | Gate de governança do projeto | 0/7: validações arquivadas |
| D6 | C | Consulta histórica independente do Bizneo | Política de custódia fundamentada em L1/L10/L12 | 10: exportação e recuperação testadas |

## 12. Riscos e testes prioritários

| Risco | Verificação/ação |
| --- | --- |
| Unidade interna confundida com estabelecimento | Conferir CNPJ completo e chave de NSR |
| Original adulterável antes do backup | Revisão de privilégio e evidência independente desde a persistência |
| Falha entre gravação e comprovante | Recuperação idempotente e estados explícitos |
| Certificado vencido/serviço indisponível | Alertas, contingência e recuperação sem adulterar original |
| Hash interno confundido com fiscal | Vetores separados contra leiaute |
| Fechamento mascarando não conformidade | Estados administrativo e conformidade independentes |
| Ajuste fabricado para completar pares | Evidência/motivo e revisão; não gerar hora presumida |
| Sombra interpretada como sem valor probatório | Orientação e investigação de divergências reais |
| Reprocessamento limitado ao dia | Testes de semana, descanso, banco e competência seguinte |
| Histórico indisponível após Bizneo/desligamento | Consulta independente e recuperação exercitadas |

## 13. Pendências da Fase 0

A [análise de lacunas do plano mestre](plano-jornada-fechamento-rh.md#5-estado-de-partida), concluída em 17/10/2026, distingue reaproveitamento, adaptação e construção (G01–G12), com código e parâmetros reais. Ela substitui um levantamento do zero, mas não encerra as pendências jurídicas abaixo.

1. Conferência integral de vigência da Portaria e anexos; especificação exata de hora, ARP, hash e eventos.
2. Congelamento das versões oficiais de AFD/AEJ, formato e transições.
3. Conferir o mapeamento fiscal a partir da titular CT Sorvetes já informada e dos CNPJs já cadastrados; identificar apenas lacunas.
4. Confrontar a referência existente “CCT Comerciários 2026/2027 - São Luís/MA” com o instrumento e regras por vínculo; verificar acordos individuais aplicáveis, sem exigir ACT para adotar REP-P.
5. Retenção e suspensão de descarte por classe, inclusive revisão dos anexos médicos.
6. Pessoas responsáveis, contratos de código e licenças.
7. Serviço de assinatura, contingência e controles independentes da ARP.

## 14. Decisões operacionais pendentes

- Identificação no tablet: login, PIN ou crachá, com atribuição individual verificável.
- Aprovação de ajustes por tipo e tratamento de conflito de interesses.
- Procedimento de contingência online e acesso pós-desligamento.
- Eventos/unidades exigidos pelo contador.
- Estabelecimento piloto, janela de corte e retorno.
- Validação física e operacional do offline do Coala Go; geolocalização pontual e acompanhamento durante a jornada estão implementados, mas continuam desativados até os gates descritos na [especificação técnica](engineering/time-recording-geolocation.md).

## 15. Etapa atual de implantação — ponto pronto, salvo INPI

A execução vigente segue a lista operacional consolidada em
[`docs/rep-p/homologacao/README.md`](rep-p/homologacao/README.md#pendências-para-considerar-o-ponto-pronto-salvo-inpi).
O registro no INPI permanece uma dependência externa separada e não mascara pendências técnicas do produto.

### Rodada autorizada em 24/10/2026

1. **Assinaturas e arquivos fiscais:** gerar e verificar amostras PAdES/CAdES com o e-CNPJ, preparar a amostra de e-CPF para validação pessoal no ITI e conferir AFD, SHA-256 e encadeamento do registro tipo 7.
2. **Infraestrutura fiscal:** bucket imutável, banco dedicado, deny policy e restaurações de `coala-rh` e `coala-rep-p` concluídos; falta repetir perda/retomada da Hora Legal no ambiente publicado.
3. **Eventos e contingência do REP-P:** falha, reemissão sem alterar NSR/batida e acesso posterior passaram no emulador. A candidata dos registros tipo 6 está implementada com monitoração externa; faltam rollout e ensaio controlado.

**Andamento consolidado em 26/10/2026:** no item 3, falha de assinatura com reemissão sem nova batida e comprovante ainda acessível após 72 horas passaram no emulador. O pulso fiscal `07 → 08 → 07` foi retirado da candidata: a falta de uma chamada do Scheduler não comprova indisponibilidade do coletor; os eventos tipo 6 dependem da monitoração externa que diferencia falha da sonda de falha real. No item 1, AFD/CAdES, comprovante/PAdES e e-CPF foram aprovados no VALIDAR/ITI em 25/10/2026; o AEJ/CAdES foi declarado validado pelo responsável e falta somente anexar sua evidência específica ao dossiê atual. No item 2, o bucket fiscal dedicado foi criado e a retenção por objeto foi reconferida ao vivo em 26/10, com amostra sintética `Locked` até 25/10/2046; o runtime recebeu papel mínimo de escrita. Restaurações reais do `coala-rh` e do `coala-rep-p` terminaram com comparação idêntica e remoção dos bancos descartáveis. A ARP usa o banco `coala-rep-p`, com PITR, proteção contra exclusão, backup diário de 98 dias, tag e deny policy contra contas genéricas. O código separa ARP oficial, PTRP e piloto; reclassificar não altera a ARP. Uma trava transacional na própria ARP coordena o fechamento do PTRP com marcações retroativas/offline. A perda/retomada da Hora Legal passou no emulador e ainda deve ser ensaiada no ambiente publicado antes da ativação. O rollout publicado permanece com `REP_P_MARKING_ENABLED=false`, impedindo batidas oficiais. O [estado documental canônico](rep-p/homologacao/README.md#fonte-canônica-do-estado-documental) prevalece sobre registros históricos desta seção.

**Andamento em 25/10/2026:** a deny policy `rep-p-arp-write-guard` foi criada com papel temporário e este foi removido; App Hosting e o agente do Firestore são as únicas exceções. O primeiro backup do `coala-rep-p` foi restaurado, treze coleções fechadas e cabeçalhos foram comparados com resultado idêntico (todos vazios antes da coleta oficial), e o banco descartável foi removido no mesmo dia. O PAdES ganhou DocMDP `P=1`; novas amostras e hashes foram gerados e CAdES/PAdES passaram novamente nas verificações locais. A submissão ao ITI e a assinatura pessoal com e-CPF continuam sendo atos manuais. A candidata do tipo 6 usa sonda externa do banco + Hora Legal, Cloud Monitoring, Pub/Sub e relay idempotente sem acesso à ARP; a flag oficial continua desligada.

### Rodada física seguinte

4. **Coala Go online e offline:** usar primeiro o usuário de teste **Luis**, com vínculo, turno e escala já existentes ajustados para o dia do ensaio. Registrar por ato: aparelho e versão do app; pessoa, unidade, turno e data; estado da rede; estado da Hora Legal antes da ação; finalidade escolhida; instante original; resposta do app; sequência/comprovante do ensaio ou NSR/comprovante oficial depois da sincronização; tamanho/ordem da fila; e capturas de tela de qualquer divergência. No rollout de ensaio, cobrir autorização local `scope=pilot`, queda de rede, HLB explicitamente indisponível com internet, duas ou mais batidas preservadas, retorno, sincronização ordenada, reinício e bateria, confirmando que nada aparece na ARP/AFD/AEJ. No piloto oficial, repetir com `scope=official` e recebimento posterior de NSR/comprovante. Heucilene participa somente depois que o roteiro passar com Luis.
