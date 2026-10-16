# Plano — Controle de Ponto (REP-P)

**Produto:** Coala OP
**Status:** Planejamento inicial — nenhuma implementação iniciada
**Última atualização:** 14/10/2026
**Responsável funcional:** RH / Administração
**Base legal:** Portaria MTP nº 671/2021 (registro eletrônico de ponto)

## 1. Objetivo

Criar no Coala uma aplicação própria de **Controle de Ponto**, enquadrada como **REP-P — Registrador Eletrônico de Ponto via Programa**, para registrar a jornada dos colaboradores da própria Coala Shakes, e ligá-la ao tratamento de jornada já planejado em [plano-jornada-fechamento-rh.md](plano-jornada-fechamento-rh.md), que passa a fazer o papel de **PTRP — Programa de Tratamento de Registro de Ponto**.

## 2. Escopo e decisões tomadas

| Decisão | Situação |
| --- | --- |
| Uso | **Somente interno**, para os colaboradores da Coala Shakes. Não haverá comercialização nesta fase. |
| Titular e desenvolvedora do REP-P | **Coala Shakes** (CNPJ da empresa). |
| CNAE | **Não precisa mudar** para registrar no INPI e usar internamente. O INPI não exige CNAE do titular, e usar um sistema próprio para controlar o ponto dos próprios funcionários não é atividade econômica nova. Só entraria em discussão se o sistema passasse a ser vendido ou licenciado; confirmar o enquadramento com o contador. |
| Homologação no MTE | REP-P **não** passa por homologação; exige registro do programa no INPI e cumprimento dos requisitos técnicos da Portaria. |
| Plataforma | Um único app (Coala Go) e um único login. O ponto é um módulo do Coala, mas com **fronteira técnica própria** no backend (seção 4). |
| Comercialização futura | Fora do escopo. A ARP grava o identificador da empresa em cada registro desde o início, para não exigir reescrita caso isso mude. Se um dia houver venda, a titularidade (Coala Shakes ou empresa nova de software) deve ser decidida **antes** do registro no INPI, porque o número do registro e o certificado aparecem em todo comprovante e todo AFD. |

## 3. O que já existe e o que falta

**Já existe e será reaproveitado:**

- cadastro de colaboradores com CPF e situação (RH/DP);
- unidades (`src/components/dp/units/`), que passam a ser os **estabelecimentos**, cada um com sua sequência de NSR;
- escalas e turnos;
- o app Android **Coala Go** (`apps/coala-one-android`), candidato a coletor;
- precedente de bancos Firestore separados (`src/lib/firebase-checklist-admin.ts`, `src/lib/firebase-financial-admin.ts`), base para isolar a ARP;
- o plano da Jornada V2, que já prevê apuração, ajustes sem apagar a batida original, reprocessamento e fechamento.

**Não existe:** batida, NSR, ARP, comprovante, AFD, AEJ, espelho de ponto, assinatura PAdES/CAdES nem sincronização com a Hora Legal Brasileira.

**Impacto no plano da Jornada V2:** a seção 2.1 daquele plano trata as batidas como vindas de um **sistema externo de ponto**. Com este plano, a fonte das batidas passa a ser a ARP do REP-P do Coala. O restante da Jornada V2 continua válido. Durante a transição, o sistema externo atual continua sendo a fonte oficial até a promoção controlada (fase 5).

## 4. Arquitetura

```text
COALA
│
├── Core geral: usuários, unidades, colaboradores, permissões, autenticação
│
├── RH / DP / Escalas / Documentos / Férias / demais módulos
│
──────────── FRONTEIRA REGULATÓRIA REP-P ────────────
│
└── CONTROLE DE PONTO
    │
    ├── REP-P (núcleo regulado — praticamente intocável)
    │   ├── coleta da marcação
    │   ├── hora oficial (HLB)
    │   ├── NSR por estabelecimento
    │   ├── ARP (registros originais, só acréscimo)
    │   ├── hash SHA-256
    │   ├── comprovante (PDF + PAdES)
    │   └── AFD (+ .p7s CAdES)
    │
    └── PTRP (= Jornada V2)
        ├── jornada, escalas, tolerâncias
        ├── ajustes e aprovações
        ├── banco de horas, horas extras, adicional noturno
        ├── AEJ (+ .p7s CAdES)
        └── espelho de ponto
```

Regras da fronteira:

**Persistência decidida em 14/10/2026:** configurações de Tempo, pedidos/ocorrências de ausência e tratamento/apuração (PTRP) serão organizados em coleções próprias no banco existente `coala-rh`. O cadastro hoje em `coala` será movido por migração controlada, sem duas fontes editáveis. O banco exclusivo da ARP continua separado do RH; ele não recebe regras de ausência, documentos médicos ou resultados de apuração.

1. **O REP-P registra o que aconteceu; o PTRP interpreta.** Se o colaborador bateu 08:07, a ARP guarda 08:07 para sempre, mesmo que a regra considere 08:00.
2. Nenhum módulo fora do REP-P escreve na ARP. O PTRP só lê.
3. Mudanças em RH, escalas, dashboard ou outros módulos não alteram o código do núcleo. Toda alteração no núcleo gera nova versão do REP-P (o Atestado Técnico identifica programa e versão).
4. O código do núcleo fica em pasta própria (por exemplo, `src/features/ponto/rep/` e `functions/src/ponto/`), com testes próprios.

## 5. Requisitos do REP-P

### 5.1. Cadastro do empregador e dos estabelecimentos

- Razão social, CNPJ, estabelecimentos (unidades), endereço/local de trabalho, CNO/CAEPF quando aplicável e responsáveis.
- Toda inclusão ou alteração gera **evento na ARP**, com autor, data e hora.

### 5.2. Cadastro do trabalhador

- Nome, CPF, matrícula, empresa, estabelecimento e situação (ativo/inativo).
- Inclusão, alteração e exclusão geram **evento na ARP**, com autor, data e hora. Nenhum cadastro histórico é sobrescrito sem rastro.
- A fonte continua sendo o cadastro de colaboradores do RH; o REP-P registra cada mudança relevante como evento.

### 5.3. Coletor

Dois coletores previstos:

| Coletor | Uso |
| --- | --- |
| Coala Go (Android), modo pessoal | colaborador bate pelo próprio celular, autenticado |
| Coala Go em tablet no quiosque, modo terminal | colaborador se identifica no tablet da unidade |

No momento da marcação, o coletor deve:

- identificar o colaborador de forma inequívoca;
- mostrar relógio digital com **hora, minuto e segundo**, baseado na hora do servidor, e não só no relógio do aparelho;
- registrar a marcação e enviá-la ao REP-P;
- exibir em seguida o acesso ao comprovante.

Reconhecimento facial e biometria **não** entram no núcleo (dado pessoal sensível na LGPD; ver seção 9). Geolocalização é opcional e nunca impede a marcação: a batida fora da área é preservada e sinalizada para análise.

### 5.4. Hora oficial

- Servidor sincronizado com a **Hora Legal Brasileira**, com diferença máxima de **30 segundos**.
- O servidor confere periodicamente a diferença em relação ao Observatório Nacional (`ntp.on.br`) e grava cada verificação. Uma diferença acima do limite gera alerta e evento na ARP.
- O app calcula a diferença entre o relógio do servidor e o do aparelho a cada sincronização. Offline, conta o tempo decorrido pelo relógio monotônico do aparelho (`SystemClock.elapsedRealtime`), que não muda se o usuário alterar a hora do celular.
- Ajustes de relógio geram evento na ARP com horário anterior, horário novo e responsável.

### 5.5. Marcação online e offline

- O caminho normal é online.
- Offline é exceção: a marcação fica em armazenamento local protegido e é enviada automaticamente quando a conexão volta.
- A marcação preserva a data e a hora originais. A data e a hora de **gravação** são as do recebimento pelo servidor.
- Cada marcação recebe no aparelho um identificador único, e o servidor rejeita reenvios com o mesmo identificador, para não duplicar batidas na sincronização.

### 5.6. NSR — Número Sequencial de Registro

- Toda operação gravada na ARP recebe NSR.
- A sequência é **por estabelecimento**, começa em 1 e avança de 1 em 1, sem buracos.
- O NSR é atribuído **no servidor, no recebimento**, por transação num contador do estabelecimento. A batida offline recebe o NSR quando sincroniza.

### 5.7. ARP — Armazenamento de Registro de Ponto

- **Banco Firestore separado**, exclusivo da ARP, com redundância, alta disponibilidade e backup.
- **Somente acréscimo.** Registros não são alterados nem apagados. As regras do Firestore não bastam, porque o Admin SDK as ignora; por isso:
  - uma única Cloud Function grava na ARP;
  - nenhum outro código tem rota de escrita para esse banco;
  - cada registro leva o hash do registro anterior (cadeia de hashes), o que torna visível qualquer adulteração;
  - uma exportação diária vai para um bucket do Cloud Storage com **trava de retenção** (Bucket Lock), que impede a exclusão.
- Tipos de registro:
  - alterações do empregador e dos estabelecimentos;
  - ajustes do relógio;
  - inclusão, alteração e exclusão de trabalhador;
  - eventos sensíveis do REP-P;
  - marcações de ponto.
- Separada da base de tratamento da jornada (PTRP).

### 5.8. Conteúdo de cada marcação

- NSR;
- CPF do trabalhador;
- data e horário da marcação;
- fuso horário;
- data e horário de gravação;
- identificação do coletor/dispositivo;
- hash **SHA-256**;
- identificador da empresa (para a seção 2);
- indicação de marcação feita offline.

O formato e a ordem exatos seguem o leiaute oficial do AFD (5.10).

### 5.9. Comprovante de Registro de Ponto do Trabalhador

- Gerado para cada marcação, contendo, entre outros:
  - título do documento;
  - NSR;
  - empregador e CNPJ;
  - trabalhador e CPF;
  - data e horário;
  - local, quando exigível;
  - número do registro do REP-P no INPI;
  - hash SHA-256.
- PDF assinado em **PAdES** com o **e-CNPJ da Coala Shakes** (desenvolvedora).
- Disponível eletronicamente no app. Pela informação reunida até aqui, não precisa ser impresso nem baixado na hora, desde que o colaborador consiga obter pelo menos os das últimas **48 horas** — **confirmar na Portaria** (seção 12).

### 5.10. AFD — Arquivo Fonte de Dados

- Gerado por intervalo de datas, a partir da ARP.
- Segue **exatamente** o leiaute oficial vigente do MTE, inclusive o número do registro no INPI.
- Assinado em **CAdES**, com arquivo `.p7s` destacado, usando o e-CNPJ da Coala Shakes.
- O leiaute é baixado e versionado no repositório antes de começar o código. Exemplos encontrados na internet não servem de especificação.

### 5.11. Eventos sensíveis e auditoria do núcleo

Ficam registrados com usuário, data, hora, IP, evento, valor anterior e valor posterior:

- exportação de AFD;
- ajuste de relógio;
- alteração de empregador, estabelecimento ou trabalhador;
- falhas de verificação de hora;
- falhas na cadeia de hashes.

## 6. Requisitos do PTRP (Jornada V2)

**Alinhamento de 14/10/2026:** pedidos e ocorrências seguem o contrato de [Ausências do DP](engineering/flows/dp-absences.md). A ocorrência aprovada é insumo do PTRP, nunca uma marcação original nem autorização de escrita na ARP. Justificativa, abono/crédito, débito de banco e efeito de folha permanecem distinguíveis e vinculados à regra/decisão aplicada. Correções e reversões acrescentam histórico e reprocessam apenas o período afetado, respeitando fechamento versionado. Uma ausência aprovada não impede a coleta de uma batida real.

O acesso temporário dos aprovadores ao comprovante de ausência termina na aprovação final; o arquivo continua restrito ao titular e ao DP responsável. Os anexos não entram no AFD, AEJ ou projeções da escala. Sua retenção de 20 anos após o desligamento e eliminação mediante autorização são políticas desse fluxo, não o prazo geral dos registros da ARP. Conferir os leiautes oficiais vigentes do MTE antes de implementar cada exportação.

Ficam detalhados em [plano-jornada-fechamento-rh.md](plano-jornada-fechamento-rh.md). O que este plano acrescenta:

- **Fonte das batidas:** leitura da ARP, em vez do sistema externo.
- **Solicitações de ajuste**, em módulo separado e sem alterar a marcação original. Tipos: esqueci de bater, falha no sistema, marcação indevida, intervalo não registrado e saída não registrada. Cada solicitação guarda justificativa, anexo opcional, horário solicitado, solicitante e data da solicitação, além da decisão: quem decidiu, quando e por quê.
- **Fluxo de aprovação** configurável: só gestor, só RH, gestor e depois RH, ou aprovação automática para tipos definidos.
- **Regras de jornada por parâmetro**, nunca fixas no código: jornada diária, semanal e mensal; escala; tolerância; percentuais de hora extra; banco de horas e período de compensação; adicional noturno; intervalo; feriados; regras da CCT.
- **AEJ — Arquivo Eletrônico de Jornada**, no leiaute oficial, com marcações originais e tratadas, assinado em CAdES com `.p7s` destacado.
- **Espelho de ponto** mensal, com marcações originais e tratadas, ocorrências, jornada e horas extras, acessível ao colaborador.

## 7. Certificados ICP-Brasil

### 7.1. Quais são necessários

| Para quê | Certificado | Titular |
| --- | --- | --- |
| Assinar comprovantes (PAdES) e AFD/AEJ (`.p7s` CAdES) | **e-CNPJ A1** | Coala Shakes |
| Declaração de Veracidade no pedido ao INPI | assinatura qualificada ICP-Brasil | representante da titular (e-CPF do sócio) |
| Atestado Técnico e Termo de Responsabilidade | **e-CPF** | responsável legal (sócio-administrador) e responsável técnico |

- O **e-CNPJ deve ser A1** (arquivo `.pfx`, válido por 1 ano), porque o servidor assina cada comprovante sozinho. O A3 de token ou cartão exige alguém presente na hora de assinar; o A3 "em nuvem" com API também funcionaria.
- O **e-CPF** pode ser A1 ou A3: o atestado é assinado uma vez, à mão.
- **A assinatura gratuita do gov.br não serve**: ela é "avançada", e a Portaria e o INPI exigem a assinatura **qualificada ICP-Brasil**.

### 7.2. Onde e como emitir

- **Onde:** em uma Autoridade Certificadora credenciada na ICP-Brasil. A lista oficial fica no site do ITI (gov.br/iti, em "Autoridades Certificadoras"). Entre as conhecidas: Certisign, Serasa Experian, Soluti, Valid e Safeweb. Vale perguntar ao contador se ele tem parceria.
- **Como:**
  1. compra pelo site, escolhendo o modelo;
  2. validação da identidade por videoconferência (em geral, para quem tem CNH ou biometria cadastrada) ou presencialmente;
  3. emissão, normalmente no mesmo dia; o A1 é baixado como `.pfx` protegido por senha.
- **Documentos usuais:**
  - e-CNPJ: contrato social ou última alteração consolidada, cartão CNPJ e documento com foto do representante legal;
  - e-CPF: documento com foto e CPF, às vezes comprovante de endereço.
- **Custo:** de algumas dezenas a poucas centenas de reais por certificado por ano. Comparar no momento da compra.

### 7.3. Quando comprar

- **e-CPF:** na fase 2 (pedido ao INPI).
- **e-CNPJ:** no fim da fase 1, quando comprovante e AFD estiverem prontos para assinar. Como o A1 vale 1 ano a partir da emissão, comprar antes desperdiça validade.

### 7.4. Guarda da chave

- O `.pfx` do e-CNPJ assina em nome da empresa. Não pode ser enviado por WhatsApp, e-mail ou chat (inclusive para agentes de IA) nem versionado no repositório.
- O próprio responsável grava o arquivo e a senha no **Secret Manager** do projeto. Só a função de assinatura tem permissão de leitura.
- Manter uma cópia de segurança offline, sob guarda do responsável legal.
- Renovação anual com alerta 30 dias antes do vencimento. A troca de certificado gera evento na ARP.

## 8. Registro no INPI e Atestado Técnico

### 8.1. Registro do programa

- **Nome sugerido:** "Coala Ponto — Registrador Eletrônico de Ponto via Programa (REP-P)". Registrar o **módulo de ponto com identidade própria**, e não o Coala inteiro, porque o número do INPI vai no comprovante e no AFD.
- **Titular:** Coala Shakes. Se houver código feito por terceiros (freelancers, outras empresas), é preciso um contrato de **cessão dos direitos patrimoniais** à Coala Shakes antes do pedido.
- **Passos:**
  1. gerar o pacote do código e da documentação da versão a registrar e calcular o resumo digital (hash) exigido pelo INPI;
  2. **guardar esse pacote** (é a prova do que foi registrado);
  3. pagar a GRU;
  4. fazer o pedido com a Declaração de Veracidade assinada com certificado qualificado;
  5. receber o certificado de registro.
- O código da GRU e o valor citados nas pesquisas iniciais (código 730, R$ 210,00) devem ser **conferidos** no site do INPI no momento do pedido.

### 8.2. Atestado Técnico e Termo de Responsabilidade

- Emitido pela Coala Shakes (desenvolvedora) para a Coala Shakes (empregadora), no **modelo oficial do MTE**.
- Contém: identificação da desenvolvedora, do sistema e da versão; empregador e CNPJ; responsável técnico; responsável legal; e declaração de conformidade com a Portaria 671.
- PDF assinado em PAdES pelos **e-CPFs** do responsável legal e do responsável técnico.
- Um atestado para o CNPJ da matriz cobre os estabelecimentos (filiais) — **confirmar** com o modelo oficial.
- Cada nova versão do núcleo REP-P exige revisar se o atestado precisa ser reemitido.

## 9. Segurança, acesso e LGPD

- **Perfis:** colaborador, supervisor, gestor, RH, administrador e auditor (somente leitura). Os perfis aproveitam as permissões existentes do Coala; o acesso ao AFD e à ARP fica restrito a RH, administração e auditor.
- **Segurança:**
  - HTTPS;
  - MFA para administradores;
  - rotas novas protegidas por `secureRoute` (ver `docs/engineering/security-contract.md`);
  - limite de requisições na rota de marcação;
  - backups e monitoramento, com alerta de falha na sincronização de hora e na cadeia de hashes.
- **LGPD:** o sistema trata nome, CPF, jornada, dispositivo e, se ativada, localização. É preciso:
  - atualizar o aviso de privacidade para colaboradores;
  - definir a base legal (obrigação legal de controle de jornada);
  - definir a retenção e controlar o acesso;
  - manter um canal para os direitos do titular;
  - ter um procedimento de incidente.
- Biometria e reconhecimento facial ficam fora desta fase.

## 10. Fases

### Fase 0 — Base legal e especificação (responsável: Tiago)

- [ ] Confirmar o titular (Coala Shakes) e o nome do módulo.
- [ ] Levantar se alguma parte do código foi escrita por terceiros e, se for o caso, providenciar a cessão de direitos.
- [ ] Baixar da página oficial do MTE os **leiautes vigentes de AFD e AEJ**, o **modelo do Atestado Técnico** e a **Portaria 671 compilada**; versionar em `docs/rep-p/referencias/`.
- [ ] Conferir os pontos da seção 12.
- [ ] Validar o plano com advogado trabalhista e com o contador (CNAE e enquadramento).

**Pronto quando:** leiautes e modelo estão no repositório, e os pontos da seção 12 foram respondidos.

### Fase 1 — Núcleo REP-P em teste (responsável: desenvolvimento)

- [ ] Banco Firestore da ARP, função única de gravação, NSR por estabelecimento, cadeia de hashes e exportação diária para bucket com trava de retenção.
- [ ] Eventos de empregador, estabelecimento e trabalhador.
- [ ] Verificação periódica da hora contra o Observatório Nacional.
- [ ] Coletor no Coala Go (pessoal e terminal), com relógio do servidor, modo offline e reenvio sem duplicar.
- [ ] Comprovante em PDF; AFD no leiaute oficial.
- [ ] Assinaturas PAdES e CAdES, primeiro com certificado de teste e depois com o e-CNPJ real.
- [ ] Testes: marcação online e offline; queda da internet; aparelho com relógio errado; marcações simultâneas; duplicidade; queda do servidor e recuperação; NSR sem buracos; validação da cadeia de hashes; AFD conferido contra o leiaute; assinaturas verificadas em validador ICP-Brasil (por exemplo, o Verificador do ITI); carga.
- [ ] Uso apenas com um **colaborador fictício** marcado como teste, como já previsto na Jornada V2.

**Pronto quando:** todos os testes acima passam e um AFD assinado de um período de teste é aprovado na validação.

### Fase 2 — Registro e atestado (responsável: Tiago, com material preparado pelo desenvolvimento)

- [ ] Emitir os e-CPFs.
- [ ] Gerar o pacote da versão e o hash, e guardar o pacote.
- [ ] Pedir o registro no INPI e receber o número.
- [ ] Inserir o número do INPI no comprovante e no AFD (nova versão do núcleo).
- [ ] Emitir e assinar o Atestado Técnico.

**Pronto quando:** o certificado do INPI e o atestado assinado estão arquivados.

### Fase 3 — PTRP sobre a ARP (responsável: desenvolvimento)

- [ ] Jornada V2 lendo as batidas da ARP.
- [ ] Solicitações de ajuste e fluxo de aprovação.
- [ ] AEJ assinado e espelho de ponto no app.

### Fase 4 — Modo sombra e piloto

- [ ] Uma unidade bate ponto no REP-P **em paralelo** ao sistema externo atual, e as batidas e apurações são comparadas.
- [ ] As divergências são analisadas até zerar as que têm causa no REP-P.

### Fase 5 — Promoção

- [ ] O REP-P passa a ser o ponto oficial, unidade por unidade.
- [ ] O sistema externo é desligado só depois de todas as unidades migrarem e de os registros antigos estarem preservados pelo prazo legal.

## 11. Riscos

| Risco | Mitigação |
| --- | --- |
| Leiaute de AFD/AEJ interpretado errado | Especificação a partir do leiaute oficial versionado; validação na fase 1 antes de qualquer uso real |
| Escrita indevida na ARP por código de outro módulo | Banco separado, função única, cadeia de hashes, bucket com trava de retenção |
| Buraco ou repetição de NSR | Atribuição só no servidor, por transação; teste de concorrência |
| Aparelho com hora errada | Relógio do servidor e relógio monotônico offline; a hora do aparelho nunca é a fonte |
| Vazamento do e-CNPJ | Secret Manager, acesso só da função de assinatura, nenhum envio por canal de mensagem |
| Certificado vencido trava comprovantes | Alerta 30 dias antes; renovação anual |
| Mudança no núcleo sem nova versão | Pasta própria, revisão obrigatória e versão incrementada em toda mudança do núcleo |
| Troca de titular no futuro (venda) | Decidir a titularidade antes do registro, se a venda voltar a ser considerada |

## 12. Pontos a confirmar na fase 0

Vieram de pesquisa inicial e **ainda não foram conferidos** na fonte oficial:

1. Data e conteúdo dos leiautes vigentes de AFD e AEJ (a pesquisa citou publicação atualizada em 31/07/2026).
2. Código e valor da GRU do INPI (citados: código 730, R$ 210,00).
3. Prazo mínimo de acesso aos comprovantes (citado: últimas 48 horas) e se a disponibilização apenas eletrônica é aceita.
4. Lista exata dos campos obrigatórios do comprovante.
5. Se um atestado para a matriz cobre todos os estabelecimentos.
6. Quem deve assinar o comprovante e o AFD quando empregador e desenvolvedor são a mesma empresa (esperado: o e-CNPJ da Coala Shakes).
7. Prazo legal de guarda dos registros do REP-P e do sistema externo atual.

## 13. Decisões em aberto

1. Identificação do colaborador no tablet do quiosque: PIN, crachá com QR code ou login.
2. Geolocalização: ativar ou não na fase 1.
3. Fluxo de aprovação padrão dos ajustes na Coala (só gestor, só RH ou os dois).
4. Quem será o responsável técnico no atestado.
