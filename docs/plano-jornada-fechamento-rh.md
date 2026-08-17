# Plano — Jornada e Fechamento de RH

**Produto:** Coala OP  
**Status:** Planejamento revisado  
**Última atualização:** 12/08/2026  
**Responsável funcional:** RH / Administração

## 1. Objetivo

Criar no Coala um subproduto completo de Jornada e Fechamento de RH capaz de:

1. Manter contratos, regras de jornada, turnos, escalas, feriados, folgas, férias e ausências.
2. Receber e armazenar as batidas individuais fornecidas pelo sistema externo de ponto.
3. Associar as batidas aos colaboradores já cadastrados no Coala.
4. Construir a jornada esperada de cada colaborador em cada dia.
5. Interpretar as batidas por meio do Motor de Apuração de Jornada do Coala.
6. Calcular jornada trabalhada, intervalos, atrasos, ausências, excedentes e horas extras.
7. Detectar ocorrências e permitir justificativas, documentos, ajustes e decisões administrativas.
8. Reprocessar apenas os dias ou períodos afetados quando alguma informação relevante mudar.
9. Converter os resultados finais em eventos estruturados de folha.
10. Fechar a competência com histórico, versões, ressalvas e auditoria.
11. Exportar o resumo mensal para a contabilidade.
12. Posteriormente, controlar envio, retorno, conciliação, correções, aprovação e documentos definitivos da folha.

O novo produto nascerá em paralelo ao fluxo atualmente utilizado. Nesta primeira etapa, não substituirá, modificará nem escreverá automaticamente na escala atual do Coala. A primeira validação ocorrerá exclusivamente com um colaborador fictício explicitamente marcado como teste; depois serão utilizados modo sombra, piloto controlado e expansão gradual antes de qualquer migração definitiva.

O núcleo funcional do produto será o seguinte:

```text
CONTRATO / REGRAS DO COLABORADOR
        +
TURNO
        +
ESCALA DO DIA
        +
FERIADO
        +
FOLGA
        +
FÉRIAS
        +
AUSÊNCIAS
        +
OUTRAS EXCEÇÕES
        +
BATIDAS DO SISTEMA EXTERNO
        ↓
MOTOR DE APURAÇÃO DO COALA
        ↓
APURAÇÃO DA JORNADA
        ↓
OCORRÊNCIAS
        ↓
TRATAMENTO DO RH
        ↓
EVENTOS DE FOLHA
```

## 2. Decisões fundamentais

### 2.1. O sistema externo será somente a fonte das batidas

O sistema externo de ponto será responsável por registrar e fornecer as marcações realizadas pelos colaboradores. O contrato de integração deverá obter, sempre que disponível:

- Identificador externo do colaborador.
- Data e hora da batida.
- Identificador estável da batida.
- Origem ou dispositivo.
- Timezone.
- Data de criação e de alteração.
- Estado de cancelamento ou exclusão.
- Indicação de inserção manual na origem.
- Demais metadados técnicos fornecidos pela API.

Exemplo:

```text
Colaborador: Maria Silva
Data: 12/08/2026

Batidas:
09:58
12:31
12:46
16:17
```

O sistema externo não será considerado responsável por calcular atrasos, faltas, horas extras, intervalos ou qualquer interpretação funcional da jornada.

### 2.2. O Coala será o motor oficial de apuração na arquitetura-alvo

O Coala combinará regras internas e batidas externas para produzir a apuração de jornada. Durante `TESTE` e `SHADOW`, esse resultado será experimental ou comparativo; somente nos escopos formalmente promovidos a `PILOTO` ou `PRODUÇÃO` ele se tornará oficial. O motor deverá calcular ou identificar, conforme as regras aplicáveis:

- Jornada prevista.
- Jornada efetivamente trabalhada.
- Entrada antecipada.
- Atraso.
- Saída antecipada.
- Permanência posterior ao horário.
- Intervalo realizado.
- Intervalo menor ou maior que o previsto.
- Ausência parcial.
- Ausência integral.
- Falta de batida.
- Quantidade incompatível de batidas.
- Jornada excedente.
- Hora extra.
- Trabalho em folga.
- Trabalho em feriado.
- Batida em dia sem jornada.
- Escala sem batida.
- Batida sem escala.
- Outras irregularidades configuráveis.

### 2.3. Quatro camadas de informação

O modelo funcional e as telas deverão manter separadas quatro camadas:

#### Jornada esperada

O que deveria acontecer no dia, determinado a partir de contrato, carga horária, turno, escala, folga, férias, feriados, ausências reconhecidas e regras aplicáveis.

#### Registro real

O que foi efetivamente marcado: as batidas recebidas do sistema externo, preservadas com sua origem e metadados.

#### Apuração automática

O resultado calculado pelo Motor de Jornada do Coala, como atraso de 9 minutos, falta de batida de saída, intervalo de 20 minutos, 1h10 de jornada excedente ou trabalho em feriado.

#### Tratamento administrativo

A decisão posterior do RH, com justificativa, documentos e ajustes quando aplicáveis.

Exemplo:

```text
Jornada esperada:
10:00 às 16:15

Batidas originais:
10:00
12:30
12:45
—

Apuração automática:
Batida final ausente

Tratamento do RH:
Saída confirmada administrativamente às 16:15

Motivo:
Colaborador esqueceu de registrar a saída.

Resultado final:
Jornada regular
```

### 2.4. Batidas originais serão armazenadas e preservadas

- O Coala armazenará as batidas necessárias à apuração.
- A batida original recebida não será sobrescrita silenciosamente.
- Uma correção criará um ajuste administrativo associado ao registro original ou ao dia.
- A apuração identificará quais batidas originais e quais ajustes foram utilizados.
- Alterações e cancelamentos recebidos da origem serão versionados ou registrados em histórico.

O sistema deverá permitir sempre distinguir:

```text
Batida original
+ ajuste administrativo
+ motivo
+ responsável
+ data/hora
```

### 2.5. Turnos, escalas e ausências são insumos do cálculo

- O turno define a jornada-base e as regras aplicáveis.
- A escala responde qual jornada o colaborador deveria cumprir em cada data.
- Férias, folgas, licenças e outras ausências podem eliminar ou alterar a jornada esperada antes da apuração.
- Mudanças retroativas nesses dados deverão disparar reprocessamento direcionado.

### 2.6. Tolerância de marcação não é tempo computável

Serão conceitos distintos:

**Tolerância de marcação:** define quando uma batida gera ou não uma irregularidade.

**Regra de apuração do tempo:** define quanto daquele período será considerado jornada, atraso, hora extra, saldo ou outro evento.

Exemplo: uma batida às 09:55 para um turno iniciado às 10:00 pode estar dentro da tolerância e não gerar ocorrência, sem que os cinco minutos sejam automaticamente computados como hora extra.

### 2.7. O RH poderá atuar diretamente

Conforme suas permissões, o RH poderá:

- Criar e administrar ausências sem solicitação prévia do colaborador.
- Ajustar situações autorizadas de ponto sem apagar as batidas originais.
- Criar eventos de folha manuais.
- Tratar ocorrências individualmente ou em lote.
- Reprocessar dias ou períodos afetados.
- Fechar uma competência de forma regular ou com ressalvas.

### 2.8. Falhas técnicas não bloquearão de forma absoluta o fechamento

- Falha de sincronização, dado antigo ou batida sem vínculo gerarão alertas e ocorrências técnicas.
- O sistema poderá indicar que uma competência não está recomendada para fechamento.
- O RH responsável poderá prosseguir por meio do fechamento com ressalvas.
- A decisão exigirá motivo, confirmação explícita e auditoria.

### 2.9. Não haverá criação automática de colaboradores

- A integração associará batidas a colaboradores existentes.
- A associação priorizará identificador externo, matrícula e CPF.
- Nome não será utilizado como único critério automático definitivo.
- Batidas sem associação irão para uma fila de pendências de integração.

### 2.10. O Coala apurará quantidades, não valores financeiros da folha

O Coala produzirá eventos estruturados, por exemplo:

- Hora extra 60%: 3h22.
- Hora extra 100%: 6h.
- Falta descontável: 6h.
- Atraso descontável: 37 min.
- Trabalho em feriado: 6h.
- Ativar vale-transporte em 01/09/2026.

O cálculo em reais continuará sob responsabilidade do contador ou sistema contábil.

### 2.11. Implantação paralela e sem impacto involuntário

> A nova Jornada do Coala deverá nascer paralelamente ao sistema atual, ser testada inicialmente com um colaborador fictício e somente assumir responsabilidades reais de forma gradual, por colaborador ou grupo, depois de validada. Durante a transição, nenhuma funcionalidade nova poderá alterar involuntariamente a escala ou o processo oficial já existente.

Consequentemente:

- A escala atual continuará funcionando exatamente como funciona hoje.
- O novo módulo terá estrutura própria e isolada para jornada, regras, escala, ausências, batidas, apuração, ocorrências, eventos e fechamento experimental.
- A ativação mínima será por colaborador, não somente por uma chave global da empresa.
- Dados e resultados terão um modo explícito: teste, shadow, piloto ou produção.
- Dados experimentais não produzirão folha, exportação, notificação, benefício, documento ou indicador oficial.
- O novo módulo não escreverá automaticamente na escala atual durante a coexistência.
- Migrações de turnos, escalas, regras ou colaboradores serão deliberadas, graduais e auditáveis.
- Será possível desativar a Jornada V2 para um participante sem perder seu histórico.

## 3. Fontes de informação na arquitetura-alvo

A tabela abaixo descreve a responsabilidade de cada fonte no novo produto. Durante teste e shadow, o processo atual continuará sendo a referência oficial da operação; a responsabilidade do Motor do Coala passará a valer oficialmente apenas para participantes em piloto ou produção.

| Informação | Fonte oficial |
|---|---|
| Cadastro do colaborador | Coala |
| Contrato, vínculo e carga horária | Coala |
| Unidade, cargo e função | Coala |
| Regras de jornada e tolerâncias | Coala |
| Turnos e intervalos previstos | Coala |
| Escala do dia e trocas de turno | Coala |
| Feriados e folgas | Coala |
| Férias, ausências e documentos | Coala |
| Batidas originalmente realizadas | Sistema externo de ponto |
| Ajustes administrativos de ponto | Coala |
| Jornada esperada | Motor de Jornada do Coala |
| Jornada trabalhada e intervalos | Motor de Jornada do Coala |
| Atrasos, faltas e horas extras | Motor de Jornada do Coala |
| Ocorrências de jornada | Motor de Jornada do Coala |
| Tratamento das ocorrências | Coala / RH |
| Benefícios | Coala |
| Eventos enviados para a folha | Coala |
| Cálculo financeiro da folha | Contador / sistema contábil |
| Prévia e folha definitiva | Contador |
| Conciliação e aprovação | Coala |

## 4. Fluxo principal

Este é o fluxo interno da Jornada V2. Ele será executado de forma experimental ou comparativa enquanto o participante estiver em teste ou shadow e não substituirá o processo atual até a promoção controlada.

```text
CADASTRO E REGRAS NO COALA
Contrato + regras + turnos + escalas
Feriados + folgas + férias + ausências
                  │
                  ▼
          Jornada esperada do dia
                  │
                  │       SISTEMA EXTERNO DE PONTO
                  │       Batidas brutas e metadados
                  │                   │
                  └─────────┬─────────┘
                            ▼
                Motor de Jornada do Coala
                            │
                  ┌─────────┴─────────┐
                  ▼                   ▼
           Jornada regular       Ocorrências
                                      │
                       ┌──────────────┼──────────────┐
                       ▼              ▼              ▼
                 Justificativa   Documento      Ajuste do RH
                       └──────────────┬──────────────┘
                                      ▼
                               Reprocessamento
                                      ▼
                                Resultado final
                                      ▼
                               Eventos de folha
                                      ▼
                              Fechamento mensal
                                      ▼
                              Envio ao contador
                                      ▼
                           Retorno e conciliação
                           ├── Divergência → correção
                           └── Correto → aprovação
```

## 5. Domínios funcionais

| Domínio | Responsabilidade |
|---|---|
| Pessoas e contratos | Cadastro, vínculo, carga horária e associação externa |
| Jornada | Turnos, escalas, folgas, feriados e vigências |
| Regras de Jornada / Motor de Apuração | Construção da jornada esperada, interpretação das batidas e cálculo diário |
| Ausências | Férias, faltas, atestados, licenças, afastamentos e documentos |
| Integração de ponto | Sincronização e preservação das batidas brutas |
| Ocorrências e ajustes | Fila de exceções, tratamentos e ajustes administrativos |
| Solicitações | Pedidos, justificativas e documentos enviados pelo colaborador |
| Benefícios | Histórico e movimentações de VT e futuros benefícios |
| Eventos de folha | Conversão dos resultados em quantidades estruturadas |
| Fechamento mensal | Revisão, congelamento, ressalvas e versionamento da competência |
| Contabilidade | Envio, retorno, conciliação, correções e aprovação |

Esses domínios não precisam aparecer como onze opções independentes na navegação. Eles representam responsabilidades internas do produto.

## 6. Navegação proposta

```text
RH
├── Visão geral
├── Pessoas
├── Jornada
│   ├── Escalas
│   ├── Turnos
│   ├── Regras
│   └── Feriados e folgas
├── Ponto
│   ├── Apuração
│   ├── Ocorrências
│   ├── Ajustes
│   └── Sincronizações
├── Ausências
│   ├── Registros
│   ├── Solicitações
│   ├── Documentos
│   └── Tipos de ausência
├── Benefícios
├── Fechamento mensal
└── Contabilidade
    ├── Envios
    ├── Retornos
    └── Conciliação

Meu RH
└── Solicitações
```

Para evitar uma sidebar extensa, Escalas, Turnos, Regras e Feriados poderão ser abas de Jornada; Apuração, Ocorrências, Ajustes e Sincronizações poderão ser abas de Ponto; e Envios, Retornos e Conciliação poderão ser abas de Contabilidade. Essa navegação é própria do novo módulo e não pressupõe remoção ou reorganização imediata da navegação atual.

Enquanto a Jornada V2 estiver em teste, a navegação poderá ser protegida por permissão e feature flag, identificada como experimental e visível somente aos usuários autorizados. A navegação atual permanecerá inalterada.

## 7. Pessoas, contratos e vínculos externos

### 7.1. Cadastro principal

- Nome.
- CPF.
- Matrícula interna.
- E-mail e telefone.
- Cargo e função.
- Unidade e gestor.
- Data de admissão e desligamento.
- Tipo de contrato.
- Carga horária contratual.
- Regra de jornada aplicável.
- Situação do vínculo.

### 7.2. Vínculo com o sistema externo

- Fornecedor de ponto.
- Empresa ou estabelecimento externo.
- Identificador externo do colaborador.
- Matrícula externa.
- Data de início e fim do vínculo.
- Status da associação.
- Responsável e origem da associação.

### 7.3. Ordem para associação

1. Identificador externo estável.
2. Matrícula.
3. CPF.
4. Associação manual.

O nome poderá apoiar a busca manual, mas não será critério automático definitivo. Batidas não associadas ficarão em `Ponto → Sincronizações → Pessoas não vinculadas` e não criarão cadastros automaticamente.

### 7.4. Vigência e histórico

Contrato, carga horária, unidade, regra aplicável e vínculo externo deverão possuir vigência. Alterações não poderão modificar silenciosamente a interpretação histórica dos dias anteriores.

### 7.5. Participação na Jornada V2

O cadastro deverá possuir uma associação explícita de participação, independente do nome do colaborador:

- Modo atual da Jornada V2.
- Escopo de ativação que o incluiu.
- Data de início e fim.
- Responsável pela ativação.
- Motivo.
- Indicador de colaborador fictício ou registro experimental.
- Permissão para produzir efeitos oficiais.

Estados mínimos:

```text
DESATIVADA
TESTE
SHADOW
PILOTO
PRODUÇÃO
```

O requisito mínimo é a ativação individual. A arquitetura deverá permitir evolução para ativação por grupo, unidade e empresa, sempre resolvendo conflitos por uma regra explícita de precedência.

## 8. Jornada esperada

A jornada esperada é o retrato do que o colaborador deveria cumprir em determinada data. Será materializada ou reproduzível a partir de informações versionadas.

Exemplo:

```text
Colaborador: Maria Silva
Data: 12/08/2026
Contrato: Jornada 6h — versão 2
Turno: Manhã — versão 4
Escala: Turno Manhã
Entrada prevista: 10:00
Saída prevista: 16:15
Intervalo previsto: 15 min
Batidas esperadas: 4
Regra de jornada: Quiosques 2026 — versão 3
```

O snapshot ou conjunto de referências utilizado em cada apuração deverá permitir explicar posteriormente por que aquele resultado foi produzido.

Durante a coexistência, a jornada esperada do novo motor será construída em uma estrutura própria. Ela poderá receber uma cópia ou adaptação somente de leitura da escala atual, mas não poderá depender de alterações estruturais no fluxo legado nem escrever de volta nele.

## 9. Turnos

O turno será uma das bases obrigatórias do Motor de Jornada.

Os turnos utilizados pela Jornada V2 serão inicialmente próprios do novo módulo. Não haverá migração geral automática dos turnos atuais. Quando um turno existente precisar ser reutilizado, sua conversão será explícita, validada e auditada.

### 9.1. Campos

- Nome.
- Código.
- Horário previsto de entrada.
- Horário previsto de saída.
- Duração prevista da jornada.
- Existência e quantidade de intervalos.
- Duração prevista de cada intervalo.
- Janela em que o intervalo pode ocorrer.
- Quantidade esperada de batidas.
- Regras específicas ou regra herdada.
- Unidade ou grupo aplicável.
- Dias aplicáveis.
- Vigência.
- Status.
- Observações.

Exemplo:

```text
Turno Manhã

Entrada: 10:00
Saída: 16:15
Intervalo: 15 minutos
Janela de intervalo: 12:00 às 15:00
Batidas esperadas: 4
```

### 9.2. Casos que o modelo deverá comportar

- Turnos sem intervalo.
- Um ou múltiplos intervalos.
- Turnos que atravessam a meia-noite.
- Jornadas de duração variável.
- Turnos específicos de unidade.
- Turnos excepcionais.
- Mudança de turno com data de vigência.

Alterar um turno deverá afetar somente datas dentro da nova vigência. Alteração retroativa deverá exigir confirmação e provocar reprocessamento do intervalo afetado.

## 10. Escalas, folgas e feriados

Durante a transição, esta seção se refere à escala própria do novo módulo, denominada conceitualmente **Escala V2**. Ela coexistirá com a escala atual sem substituí-la.

### 10.1. Responsabilidade da escala

A escala responderá:

> Qual jornada este colaborador deveria cumprir nesta data?

### 10.2. Dados da escala

- Colaborador.
- Data.
- Turno.
- Unidade.
- Indicador de folga.
- Troca de turno.
- Alteração excepcional.
- Origem da escala.
- Responsável pela alteração.
- Motivo.
- Data da alteração.
- Histórico.

Exemplo:

```text
12/08 — Turno Manhã
13/08 — Turno Manhã
14/08 — Folga
15/08 — Turno Tarde
```

### 10.3. Alterações retroativas

Quando uma escala já utilizada em uma apuração for alterada retroativamente:

1. O registro anterior será preservado.
2. O sistema registrará usuário, data, motivo e valores anterior e novo.
3. Os dias afetados serão colocados na fila de reprocessamento.
4. Ocorrências e eventos derivados serão recalculados ou marcados para revisão.
5. Fechamentos já concluídos exigirão reabertura para incorporar o novo resultado.

### 10.4. Folgas e feriados

- Folgas poderão vir da própria escala ou de concessão específica.
- Feriados poderão ser nacionais, estaduais, municipais ou específicos da empresa.
- Cada feriado deverá indicar abrangência, vigência e regra aplicável.
- O motor distinguirá trabalho em folga, trabalho em feriado e batida em dia sem jornada.

### 10.5. Coexistência com a escala atual

```text
SISTEMA / ESCALA ATUAL
→ continua funcionando normalmente
→ continua sendo utilizado na operação real

NOVO MÓDULO / ESCALA V2
→ funciona paralelamente
→ inicialmente apenas para testes
→ não altera automaticamente a escala atual
```

Regras obrigatórias:

- O desenvolvimento da Jornada V2 não exigirá mudança estrutural na escala atual para funcionar.
- A Escala V2 terá suas próprias entidades, vigências, histórico e permissões.
- Quando necessário, dados do legado poderão ser lidos, copiados ou adaptados para a V2.
- Essa relação será inicialmente unidirecional: escala atual → leitura/cópia → Jornada V2.
- Jornada V2 → alteração automática → escala atual será proibido até uma decisão formal de migração.
- Não haverá migração automática de todos os turnos, escalas, regras ou colaboradores.

Durante a transição, um colaborador poderá estar:

- Apenas na escala atual.
- Na escala atual e na Jornada V2 em modo teste ou shadow.
- Na escala atual com a Jornada V2 oficial somente para um piloto controlado.
- Posteriormente, apenas na nova arquitetura, depois de aprovada a migração.

Se a escala atual já contiver dados úteis, um adaptador de leitura poderá criar snapshots na Escala V2. Alterações feitas no snapshot V2 não retornarão ao legado.

## 11. Regras de Jornada / Motor de Apuração

### 11.1. Domínio específico

O Motor de Apuração de Jornada será um domínio explícito do Coala, responsável por combinar a jornada esperada, as batidas efetivas, os ajustes administrativos e as exceções reconhecidas.

### 11.2. Escopos de configuração

As regras poderão ser definidas por:

- Empresa.
- Unidade.
- Tipo de contrato.
- Colaborador.
- Turno.
- Dia ou situação excepcional.

Deverá existir uma ordem de precedência clara e rastreável. Regras mais específicas poderão substituir regras gerais sem apagar o histórico.

### 11.3. Regras configuráveis

- Tolerância de entrada antecipada.
- Tolerância de atraso.
- Tolerância de saída antecipada.
- Tolerância de saída posterior.
- Quantidade esperada de batidas.
- Associação e pareamento das batidas.
- Tratamento de batidas excedentes.
- Tratamento de batidas ausentes.
- Regras de intervalo.
- Intervalo mínimo e máximo.
- Janela válida do intervalo.
- Arredondamentos, quando utilizados.
- Jornada excedente.
- Horas extras e percentuais.
- Trabalho em feriado.
- Trabalho em folga.
- Ausência parcial e integral.
- Regra para batida sem escala.
- Regra para escala sem batida.
- Regras especiais por contrato, unidade ou turno.

### 11.4. Tolerância de marcação

Determina se uma diferença entre a batida e o horário esperado deve gerar uma ocorrência.

Exemplo:

```text
Entrada prevista: 10:00
Tolerância antecipada: 5 min
Batida: 09:57
Resultado de conformidade: dentro da tolerância
```

### 11.5. Regra de apuração do tempo

Determina quanto tempo será efetivamente computado como jornada, atraso, extra, saldo ou outro evento.

No exemplo anterior, a regra poderá iniciar a jornada computável às 10:00, mesmo com batida às 09:57. Tolerar a marcação não significa remunerar automaticamente o período antecipado.

### 11.6. Vigência e versão

Toda regra usada para cálculo deverá ter:

- Identificador e versão.
- Data inicial e final de vigência.
- Escopo.
- Responsável pela publicação.
- Motivo da alteração.
- Histórico.

Uma mudança de regra não poderá recalcular silenciosamente competências fechadas.

## 12. Integração com o sistema externo de ponto

### 12.1. Papel da integração

A integração terá como finalidade trazer batidas brutas e metadados técnicos. Não importará como verdade oficial cálculos de jornada, atrasos, faltas ou horas extras feitos pelo fornecedor.

### 12.2. Formas de integração

Prioridade:

1. API com sincronização incremental.
2. Webhook, quando confiável e disponível.
3. Sincronização periódica de reconciliação.
4. Arquivo CSV ou XLSX apenas como contingência controlada.

Mesmo com webhook, haverá uma rotina periódica de reconciliação para recuperar eventos perdidos ou alterações retroativas.

### 12.3. Contrato mínimo da batida

- Fornecedor.
- Empresa ou estabelecimento externo.
- Identificador externo da batida.
- Identificador externo do colaborador.
- Data e hora local.
- Instante normalizado em UTC.
- Timezone original.
- Origem e dispositivo, quando disponíveis.
- Forma de criação: dispositivo, aplicativo, web ou manual na origem.
- Data de criação.
- Data da última alteração.
- Situação: ativa, corrigida, cancelada ou removida.
- Payload bruto ou referência técnica para auditoria, respeitando minimização de dados.

### 12.4. Sincronização incremental

O conector deverá suportar, conforme a API:

- Cursor ou timestamp da última leitura.
- Paginação.
- Janela de sobreposição para evitar perda de alterações tardias.
- Reconsulta dos dias recentes.
- Recuperação histórica controlada.
- Retry com backoff.
- Registro de limites e erros da API.

### 12.5. Idempotência e duplicidade

Receber a mesma batida mais de uma vez não poderá duplicá-la. A chave preferencial será o identificador externo da batida. Quando ele não existir, será necessária uma chave derivada e uma política explícita de colisão usando, por exemplo:

```text
fornecedor
+ estabelecimento
+ colaborador externo
+ instante da batida
+ origem/dispositivo
```

Batidas aparentemente duplicadas não deverão ser apagadas sem rastreabilidade. O sistema poderá ignorá-las para cálculo, preservando a razão da decisão.

### 12.6. Alterações, cancelamentos e exclusões

Quando a origem alterar ou remover uma batida:

1. O Coala preservará o estado anteriormente recebido.
2. Registrará o novo estado e os metadados da mudança.
3. Identificará os dias e colaboradores impactados.
4. Enfileirará reprocessamento direcionado.
5. Marcará tratamentos e eventos derivados para revisão quando necessário.
6. Se a competência estiver fechada, criará um alerta de alteração retroativa, sem sobrescrever a versão fechada.

### 12.7. Importação por arquivo de contingência

- Exigirá layout versionado.
- Guardará o arquivo original.
- Executará as mesmas validações e regras de idempotência.
- Informará claramente que a origem foi contingencial.
- Não poderá duplicar batidas já recebidas por API.

### 12.8. Estados técnicos

- Nunca sincronizado.
- Sincronizando.
- Atualizado.
- Atualizado com alertas.
- Falha na última tentativa.
- Dados potencialmente antigos.
- Sem vínculo externo.
- Reconciliação pendente.

Esses estados orientarão o RH, mas não impedirão de forma absoluta um fechamento com ressalvas.

### 12.9. Isolamento por modo operacional

Toda sincronização e toda batida vinculada à Jornada V2 deverão carregar o contexto em que serão utilizadas:

- `TESTE`: somente dados do colaborador fictício ou sandbox.
- `SHADOW`: dados reais processados paralelamente, sem efeito oficial.
- `PILOTO`: novo motor oficial somente para participantes explicitamente selecionados.
- `PRODUÇÃO`: novo motor oficial para escopo migrado e aprovado.

O conector deverá consultar somente participantes habilitados ou separar inequivocamente o uso posterior das batidas. Dados de teste jamais poderão ser misturados com sincronizações oficiais sem marcação explícita.

## 13. Tela de sincronização

### 13.1. Indicadores

- Última sincronização.
- Período sincronizado.
- Colaboradores consultados.
- Batidas recebidas.
- Novas batidas.
- Batidas alteradas.
- Batidas removidas ou canceladas.
- Duplicidades ignoradas.
- Colaboradores não vinculados.
- Erros técnicos.
- Última atualização conhecida da origem.
- Status da integração.
- Reprocessamentos disparados.
- Modo da execução: teste, shadow, piloto ou produção.
- Participantes e escopo de ativação.

### 13.2. Detalhamento de uma execução

- Identificador da execução.
- Tipo: manual, agendada, webhook, reconciliação ou arquivo.
- Início, término e duração.
- Cursor inicial e final.
- Páginas consultadas.
- Quantidades lidas, criadas, atualizadas, canceladas e ignoradas.
- Erros e tentativas.
- Usuário ou processo responsável.
- Arquivo original, quando aplicável.

### 13.3. Ações

- Sincronizar agora.
- Reconciliar período.
- Importar arquivo de contingência.
- Revisar pessoas não vinculadas.
- Revisar batidas alteradas ou canceladas.
- Ver reprocessamentos.
- Baixar relatório técnico.

Todas as ações deverão mostrar o modo operacional antes da confirmação. A importação de teste utilizará ambiente, arquivo ou filtro explicitamente identificado como experimental.

## 14. Batidas e ajustes administrativos

### 14.1. Batida original

Cada batida deverá preservar:

- Identificador interno e externo.
- Colaborador externo e colaborador vinculado.
- Data e hora originais.
- Instante normalizado.
- Timezone.
- Origem e dispositivo.
- Datas de criação, recebimento e alteração.
- Estado atual na origem.
- Histórico de versões recebidas.
- Modo operacional em que foi capturada ou utilizada.
- Indicador de dado experimental, quando aplicável.

### 14.2. Ajuste administrativo de ponto

O RH poderá, conforme permissão, resolver:

- Esquecimento de entrada.
- Esquecimento de saída.
- Ausência de registro de intervalo.
- Batida em horário incorreto.
- Duplicidade.
- Batida que deve ser desconsiderada.
- Outra inconsistência autorizada.

O ajuste não apagará nem modificará silenciosamente a batida original. Deverá guardar:

- Tipo de ajuste.
- Batida original relacionada, quando houver.
- Valor original.
- Valor efetivamente utilizado na apuração.
- Data e hora inserida, corrigida ou desconsiderada.
- Motivo.
- Justificativa do colaborador, quando houver.
- Documento, quando aplicável.
- Responsável.
- Data/hora.
- Aprovação adicional, quando exigida.
- Histórico e auditoria.

### 14.3. Estados do ajuste

```text
Rascunho
→ Pendente de aprovação, quando aplicável
→ Aprovado
→ Aplicado
→ Cancelado
→ Substituído
```

Aplicar, cancelar ou substituir um ajuste deverá provocar reprocessamento do dia afetado.

## 15. Motor de Apuração de Jornada

### 15.1. Entradas do motor

Para cada colaborador e data:

```text
Contrato vigente
+ carga horária
+ regra de jornada vigente
+ turno
+ escala
+ feriado
+ folga
+ férias
+ ausências reconhecidas
+ outras exceções
+ batidas originais válidas
+ ajustes administrativos aplicáveis
```

Durante a coexistência, contrato, turno, regra, escala e demais entradas serão resolvidos no contexto da Jornada V2 e do modo operacional do colaborador. O motor não modificará o cálculo, a escala nem o resultado oficial do legado quando estiver em `TESTE` ou `SHADOW`.

### 15.2. Processamento diário

1. Identificar o vínculo e o contrato válidos na data.
2. Determinar a escala, o turno, a folga ou a inexistência de jornada.
3. Aplicar feriados, férias e ausências reconhecidas.
4. Materializar a jornada esperada e as regras utilizadas.
5. Selecionar batidas válidas e ajustes aplicáveis.
6. Ordenar e parear as marcações conforme a regra.
7. Calcular períodos trabalhados e intervalos.
8. Aplicar tolerâncias de marcação.
9. Aplicar regras de tempo computável.
10. Calcular atrasos, antecipações, ausências e excedentes.
11. Classificar trabalho em folga ou feriado.
12. Detectar inconsistências.
13. Gerar resultado de apuração e ocorrências.
14. Registrar entradas, versão do algoritmo e justificativa do resultado.

### 15.3. Resultados possíveis

- Jornada regular.
- Jornada regular dentro da tolerância.
- Atraso.
- Entrada antecipada relevante.
- Saída antecipada.
- Permanência posterior.
- Intervalo menor, maior, ausente ou fora da janela.
- Ausência parcial.
- Possível ausência integral.
- Falta de batida.
- Quantidade incompatível de batidas.
- Batida excedente.
- Jornada excedente.
- Hora extra.
- Trabalho em folga.
- Trabalho em feriado.
- Escala sem batida.
- Batida sem escala.
- Dia sem dados suficientes.
- Resultado regular após ajuste ou ausência reconhecida.

### 15.4. Resultado preliminar e resultado final

O sistema distinguirá:

- **Resultado automático:** produzido pelo motor antes do tratamento humano.
- **Resultado final:** produzido após considerar tratamentos, ausências e ajustes aprovados.

Ambos permanecerão rastreáveis.

Todo resultado indicará também:

- Modo: teste, shadow, piloto ou produção.
- Efeito: experimental, comparativo ou oficial.
- Escopo de ativação aplicado.
- Versão do motor e da regra.

Resultados `TESTE` e `SHADOW` jamais serão promovidos implicitamente a resultado oficial.

### 15.5. Explicabilidade

Cada resultado deverá permitir responder:

- Qual jornada era esperada?
- Quais regras e versões foram utilizadas?
- Quais batidas e ajustes foram considerados?
- Como os períodos foram pareados?
- Quais tolerâncias foram aplicadas?
- Qual cálculo produziu o total?
- Qual ocorrência foi gerada?
- Qual tratamento alterou o resultado final?

## 16. Reprocessamento

### 16.1. Eventos que podem dispará-lo

- Nova batida.
- Alteração, cancelamento ou remoção de batida na origem.
- Criação, alteração, cancelamento ou aprovação de ajuste.
- Mudança de contrato ou carga horária.
- Mudança de turno.
- Mudança de escala.
- Inclusão ou retirada de folga.
- Alteração de feriado.
- Inclusão, aprovação, alteração ou cancelamento de férias ou ausência.
- Troca de turno aprovada.
- Mudança de regra de jornada.
- Correção administrativa.
- Mudança relevante de vínculo do colaborador.

### 16.2. Escopo direcionado

O motor deverá calcular o menor conjunto possível de dias afetados:

- Uma batida alterada: reprocessar o dia associado e, em turno noturno, os dias limítrofes necessários.
- Uma ausência de três dias: reprocessar os três dias.
- Uma escala mensal substituída: reprocessar somente as datas alteradas.
- Uma regra com nova vigência: reprocessar datas abertas cobertas pela vigência.

Não se deverá recalcular indiscriminadamente toda a base.

### 16.3. Histórico do reprocessamento

Registrar:

- Resultado anterior.
- Motivo do reprocessamento.
- Informação que provocou a mudança.
- Escopo calculado.
- Novo resultado.
- Ocorrências criadas, encerradas ou alteradas.
- Eventos de folha afetados.
- Data/hora.
- Usuário ou processo responsável.
- Versão do motor.

### 16.4. Competências fechadas

- O resultado congelado não será sobrescrito.
- A mudança posterior gerará alerta retroativo.
- Para incorporar a mudança, o RH deverá reabrir a competência.
- A reabertura criará uma nova versão de trabalho.

### 16.5. Reprocessamento em shadow mode

No modo sombra, o reprocessamento atualizará somente resultados comparativos da Jornada V2. Não poderá:

- Alterar a apuração oficial vigente.
- Criar eventos oficiais de folha.
- Modificar a escala atual.
- Notificar o contador.
- Produzir documentos oficiais.

As divergências entre o processo atual e o novo motor serão preservadas para análise e classificação.

## 17. Ausências

### 17.1. Papel na apuração

Ausências reconhecidas poderão alterar a jornada esperada antes do cálculo.

Exemplo:

```text
15/08/2026
Situação: férias
Jornada esperada: nenhuma
Batidas esperadas: nenhuma
```

Assim, a ausência de batidas não será interpretada como falta. O efeito dependerá do tipo de ausência, de sua situação e de suas regras.

### 17.2. Três origens possíveis

#### Pelo colaborador

Em `Meu RH → Solicitações`, o colaborador poderá solicitar uma ausência, justificar uma ocorrência, informar ausência parcial, enviar atestado ou documento e solicitar correção relacionada ao ponto.

#### Diretamente pelo RH

> O RH poderá criar, editar, aprovar, recusar, cancelar e encerrar registros de ausência, conforme suas permissões, independentemente de solicitação prévia do colaborador.

Exemplos:

- Cadastrar férias.
- Registrar licença ou afastamento.
- Receber atestado presencialmente.
- Registrar comunicação de um gestor.
- Conceder folga.
- Registrar ausência autorizada.
- Classificar falta como injustificada.
- Realizar lançamento retroativo.

O RH não precisará criar artificialmente uma solicitação em nome do colaborador.

Durante a implantação gradual, ausências da Jornada V2 serão inicialmente isoladas. Caso seja necessário utilizar uma ausência já existente no sistema atual, ela será lida ou copiada com referência à origem; o novo módulo não alterará automaticamente o registro legado.

#### Pela ocorrência detectada pelo motor

Exemplo:

```text
Jornada esperada: 10:00 às 16:15
Batidas: nenhuma
Ausência cadastrada: nenhuma

Resultado:
Possível ausência integral — tratamento necessário
```

O RH poderá solicitar justificativa, vincular documento, criar uma ausência, classificar como falta injustificada, abonar ou aplicar outro tratamento permitido.

### 17.3. Solicitação de ausência e ausência reconhecida

São registros distintos.

**Solicitação de ausência:** pedido que pode estar em rascunho, enviado, em análise, aprovado, recusado ou cancelado.

**Ausência:** registro reconhecido e aplicado ao colaborador, capaz de alterar a jornada esperada e os eventos de folha.

Fluxos possíveis:

```text
Colaborador solicita ausência
        ↓
RH analisa e aprova
        ↓
Sistema cria ou reconhece AUSÊNCIA
        ↓
Motor reprocessa o período
```

```text
RH cadastra ausência diretamente
        ↓
AUSÊNCIA
        ↓
Motor reprocessa o período
```

### 17.4. Dados mínimos da ausência

- Colaborador.
- Tipo de ausência.
- Data inicial e final.
- Ausência integral ou parcial.
- Horário inicial e final, quando parcial.
- Origem: colaborador, RH, gestor, ocorrência do ponto ou integração futura.
- Motivo.
- Observações.
- Documentos.
- Solicitante, quando houver.
- Responsável pelo lançamento.
- Responsável pela aprovação.
- Status.
- Data de vigência.
- Efeito sobre a jornada esperada.
- Efeito na apuração.
- Efeito para a folha.
- Histórico.
- Auditoria.

### 17.5. Tipos configuráveis

Cada tipo poderá determinar:

- Documento obrigatório ou opcional.
- Aprovação necessária.
- Possibilidade de período parcial.
- Possibilidade de período integral.
- Efeito na jornada esperada.
- Efeito na apuração.
- Efeito padrão para folha.
- Evento de folha relacionado.
- Vigência.
- Status.

Tipos iniciais:

- Falta injustificada.
- Atestado.
- Férias.
- Folga.
- Licença.
- Afastamento.
- Ausência autorizada.
- Acompanhamento médico.
- Falecimento.
- Casamento.
- Doação de sangue.
- Outros tipos configuráveis.

### 17.6. Estados da ausência

```text
Rascunho
→ Em análise, quando aplicável
→ Aprovada / Ativa
→ Encerrada

Alternativas:
Recusada
Cancelada
Substituída
```

### 17.7. Ausência registrada depois da apuração

Quando uma ausência for criada ou aprovada após o dia já ter sido calculado:

```text
ANTES
Jornada esperada: 6h
Batidas: nenhuma
Apuração: possível falta de 6h

RH registra atestado
        ↓
Motor reprocessa o dia
        ↓
Resultado anterior permanece no histórico
        ↓
Novo resultado é gerado
```

O histórico deverá registrar resultado anterior, gatilho, novo resultado, data, usuário ou processo responsável e eventos afetados.

## 18. Solicitações do colaborador

Área proposta: `Meu RH → Solicitações`.

### 18.1. Tipos iniciais

- Justificativa de ocorrência.
- Esquecimento de batida.
- Solicitação de correção de ponto.
- Envio de documento.
- Solicitação de ausência.
- Informação de ausência parcial.
- Troca de turno.
- Férias, quando aplicável.
- Ativação de vale-transporte.
- Desativação de vale-transporte.
- Alteração de vale-transporte.

### 18.2. Fluxo

```text
Rascunho
→ Enviada
→ Em análise
→ Aprovada ou recusada
→ Aplicada ao registro correspondente
→ Concluída
```

Uma solicitação cancelada permanecerá no histórico.

### 18.3. Dados principais

- Tipo.
- Colaborador.
- Data ou período.
- Motivo.
- Justificativa.
- Documentos.
- Registro de ponto, ocorrência, escala, ausência ou benefício relacionado.
- Data da solicitação.
- Solicitante.
- Analista.
- Decisão e justificativa da decisão.
- Data de vigência.
- Histórico.

### 18.4. Efeitos de uma aprovação

A solicitação não será o resultado em si. Sua aprovação poderá produzir uma ação de domínio:

```text
Solicitação de ausência aprovada
→ cria ausência
→ reprocessa os dias afetados
```

```text
Solicitação de troca de turno aprovada
→ altera escala
→ reprocessa os dias afetados
```

```text
Esquecimento de saída aprovado
→ cria ajuste administrativo
→ reprocessa o dia
```

```text
Ativação de VT aprovada
→ cria movimentação do benefício
→ gera evento de folha na vigência correta
```

Em `TESTE` ou `SHADOW`, esses efeitos ocorrerão apenas no conjunto de dados experimental da Jornada V2. Não haverá alteração de escala atual, benefício real, folha oficial ou notificação externa real. No piloto, somente participantes autorizados poderão produzir efeitos oficiais no novo fluxo.

## 19. Central de Ocorrências

### 19.1. Finalidade

A Central de Ocorrências será o principal ambiente de trabalho por exceção. As ocorrências de jornada serão majoritariamente geradas pelo Motor do Coala, e o RH não precisará revisar manualmente todos os dias regulares.

A central exibirá e filtrará o modo operacional. Ocorrências de teste e shadow serão visualmente distintas das oficiais e não integrarão contagens oficiais por padrão.

### 19.2. Níveis

| Nível | Uso | Fechamento |
|---|---|---|
| Informação | Registro sem ação necessária | Não bloqueia |
| Alerta | Recomenda revisão | Permite fechar com decisão |
| Ação necessária | Exige tratamento administrativo | Recomenda tratamento |
| Ressalva | Caso mantido em aberto deliberadamente | Permite fechamento com ressalvas |

### 19.3. Tipos iniciais

- Atraso.
- Saída antecipada.
- Entrada antecipada relevante.
- Permanência posterior relevante.
- Jornada excedente.
- Hora extra pendente de classificação.
- Falta de batida.
- Quantidade incompatível ou excesso de batidas.
- Intervalo ausente, menor, maior ou fora da janela.
- Ausência parcial.
- Possível ausência integral.
- Escala sem batida.
- Batida sem escala.
- Trabalho em folga.
- Trabalho em feriado.
- Batida alterada ou cancelada na origem.
- Alteração retroativa de escala, turno, regra ou ausência.
- Colaborador não vinculado.
- Documento pendente.
- Justificativa pendente.
- Solicitação pendente.
- Outra ocorrência configurável.

### 19.4. Fluxo de tratamento

```text
OCORRÊNCIA
        ↓
JUSTIFICATIVA
        ↓
DOCUMENTO, QUANDO APLICÁVEL
        ↓
ANÁLISE DO RH
        ↓
CLASSIFICAÇÃO
        ↓
REPROCESSAMENTO / RESULTADO FINAL
        ↓
EFEITO PARA A FOLHA
```

### 19.5. Ações do RH

- Confirmar.
- Corrigir por ajuste administrativo.
- Abonar.
- Desconsiderar.
- Classificar como falta.
- Criar ou vincular ausência.
- Vincular documento.
- Solicitar informação.
- Tratar sem efeito.
- Gerar evento.
- Manter como ressalva.

### 19.6. Tratamento em lote

Será permitido somente para ocorrências compatíveis. A interface mostrará:

- Quantidade afetada.
- Colaboradores e período.
- Decisão aplicada.
- Efeito previsto.
- Necessidade de reprocessamento.
- Confirmação explícita.
- Registro de auditoria.

### 19.7. Estados

```text
Nova
→ Em análise
→ Aguardando colaborador
→ Aguardando documento
→ Tratada
→ Tratada com ressalva
→ Desconsiderada
→ Reaberta por reprocessamento
```

## 20. Tela individual do colaborador

### 20.1. Abas

```text
[Resumo] [Escala] [Batidas] [Apuração] [Ocorrências]
[Ausências] [Documentos] [Solicitações] [Eventos]
[Benefícios] [Histórico]
```

O cabeçalho mostrará de forma inequívoca se o colaborador está em `TESTE`, `SHADOW`, `PILOTO`, `PRODUÇÃO` ou com a Jornada V2 desativada. Para o colaborador fictício, também mostrará a identificação de registro experimental.

### 20.2. Resumo da competência

- Jornada prevista.
- Jornada trabalhada.
- Horas extras.
- Atrasos.
- Saídas antecipadas.
- Faltas.
- Ausências.
- Ocorrências abertas e tratadas.
- Documentos pendentes.
- Eventos de folha.
- Situação para fechamento.
- Data da última sincronização e da última apuração.

### 20.3. Dia regular

```text
12/08/2026

Jornada esperada:
10:00 às 16:15

Batidas:
09:58
12:31
12:46
16:17

Intervalo:
15 min

Apuração:
Regular

Ocorrências:
Nenhuma
```

### 20.4. Dia com ocorrência

```text
14/08/2026

Jornada esperada:
10:00 às 16:15

Batidas:
10:02
12:20
12:35
—

Ocorrência:
Batida de saída ausente

[Corrigir ponto]
[Solicitar justificativa]
[Registrar ausência]
[Outra ação]
```

A tela deverá permitir alternar entre batidas originais, ajustes aplicados, cálculo automático e resultado final.

## 21. Eventos de folha

### 21.1. Origem dos eventos

Eventos poderão ser produzidos por:

- Resultado final da apuração de jornada.
- Tratamento de ocorrência.
- Ausência reconhecida.
- Movimentação de benefício.
- Lançamento manual autorizado.

### 21.2. Cadastro de tipos

Cada tipo poderá ter:

- Código interno.
- Nome.
- Categoria.
- Unidade de medida.
- Percentual, quando aplicável.
- Código utilizado pelo contador.
- Regra de geração.
- Exigência de aprovação.
- Permissão para lançamento manual.
- Vigência.
- Status.

Unidades possíveis:

- Horas.
- Minutos.
- Dias.
- Quantidade.
- Valor apenas informativo, quando permitido.
- Sim ou não.
- Data de vigência.

### 21.3. Exemplos

| Código | Evento | Quantidade |
|---|---|---:|
| HE60 | Hora extra 60% | 3h22 |
| HE100 | Hora extra 100% | 6h |
| FALTA | Falta descontável | 6h |
| ATRASO | Atraso descontável | 37m |
| FERIADO | Trabalho em feriado | 6h |
| VT_ATIVAR | Ativar vale-transporte | 01/09 |
| VT_REMOVER | Desativar vale-transporte | 01/09 |

### 21.4. Valores financeiros

O Coala apurará e enviará quantidades. Não precisará calcular salário, reflexos, adicionais em reais, descontos financeiros ou valor líquido. Esses cálculos permanecerão no sistema contábil ou com o contador.

### 21.5. Reprocessamento e eventos

Quando um resultado de jornada mudar:

- Eventos ainda não congelados poderão ser recalculados.
- Eventos manuais não serão apagados automaticamente.
- Eventos aprovados que forem afetados serão marcados para revisão.
- Eventos de competência fechada só mudarão em nova versão após reabertura.

### 21.6. Eventos experimentais

- Eventos gerados em `TESTE` ou `SHADOW` serão marcados como experimentais.
- Não integrarão folha oficial, exportação para o contador, arquivo bancário ou indicador oficial.
- Exportações de validação terão cabeçalho, nome de arquivo e destinatário claramente identificados como teste.
- Um evento experimental não poderá ser convertido em oficial apenas por mudança de status; o cálculo oficial deverá ocorrer no modo e na versão de fechamento correspondentes.

## 22. Benefícios e vale-transporte

### 22.1. Histórico do benefício

O primeiro benefício será o vale-transporte, com histórico de:

- Ativação.
- Alteração.
- Suspensão.
- Desativação.
- Reativação.

### 22.2. Origens da movimentação

- Solicitação do colaborador.
- Lançamento direto pelo RH.
- Gestor, quando permitido.
- Integração futura.

O RH poderá registrar movimentações diretamente conforme sua permissão, sem criar uma solicitação fictícia.

### 22.3. Dados da movimentação

- Data da solicitação, quando houver.
- Data de vigência.
- Origem.
- Motivo.
- Solicitante.
- Responsável pelo lançamento.
- Aprovação.
- Observação.
- Documento, quando necessário.
- Evento de folha gerado.
- Histórico.

### 22.4. Isolamento durante testes

Movimentações criadas para o colaborador fictício ou em shadow mode serão experimentais e não poderão ativar, suspender ou remover um benefício real. Caso o fluxo precise ser validado, o evento e toda saída deverão ser identificados como teste.

## 23. Fechamento mensal

### 23.1. Princípio operacional

O fechamento trabalhará por exceção. Dias regulares, calculados com dados suficientes e sem ocorrência, serão consolidados automaticamente. O RH concentrará sua revisão em pessoas e datas com ocorrências, alterações retroativas, documentos ou ressalvas.

### 23.2. Fluxo completo

```text
1. Sincronizar batidas
2. Apurar jornadas
3. Identificar ocorrências
4. Tratar ocorrências
5. Conferir ausências e documentos
6. Revisar ponto por colaborador
7. Gerar eventos de folha
8. Revisar eventos
9. Gerar resumo mensal
10. Fechar competência
11. Enviar ao contador
12. Receber prévia
13. Conciliar
14. Solicitar correções, quando necessário
15. Aprovar
16. Receber documentos definitivos
17. Concluir competência
```

Na interface, essas dezessete etapas poderão ser agrupadas em macroetapas:

```text
Dados e apuração
→ Exceções e tratamentos
→ Eventos e revisão
→ Fechamento
→ Contabilidade
→ Conclusão
```

### 23.3. Painel da competência

O painel deverá apresentar:

- Total de colaboradores.
- Período das batidas sincronizadas.
- Quantidade de batidas recebidas.
- Colaboradores sem dados.
- Jornadas apuradas.
- Colaboradores sem escala.
- Batidas sem vínculo.
- Dias com batidas faltantes.
- Ocorrências totais.
- Ocorrências tratadas.
- Ocorrências pendentes.
- Ausências reconhecidas.
- Documentos aguardando conferência.
- Justificativas aguardando colaborador.
- Horas extras apuradas.
- Faltas apuradas.
- Eventos de folha.
- Colaboradores prontos.
- Colaboradores com ressalvas.
- Alterações retroativas após a última revisão.
- Modo do fechamento e escopo de participantes.

Todos os indicadores deverão abrir a lista correspondente.

Por padrão, o painel oficial excluirá dados `TESTE` e `SHADOW`. Uma visão específica de transição mostrará esses dados e as comparações, sem misturá-los aos totais oficiais.

### 23.4. Situação por colaborador

```text
Sem escala
→ Aguardando batidas
→ Apuração pendente
→ Com ocorrências
→ Em tratamento
→ Pronto
→ Pronto com ressalvas
→ Fechado
```

Nem todos os estados representam bloqueio. A interface deverá explicar o que falta e quais decisões estão disponíveis.

### 23.5. Fechamento regular

Utilizado quando todos os casos relevantes foram tratados e não existem ressalvas assumidas pelo RH.

### 23.6. Fechamento com ressalvas

Utilizado quando existem situações não resolvidas ou incertezas técnicas, mas o RH decide prosseguir. Exigirá:

- Motivo.
- Responsável.
- Relação das ressalvas.
- Impacto conhecido ou potencial.
- Confirmação explícita.
- Auditoria.

Falhas técnicas não serão impedimento absoluto, mas deverão ficar visíveis no fechamento e na versão congelada.

### 23.7. Estados da competência

```text
Em preparação
→ Sincronizando batidas
→ Em apuração
→ Em tratamento
→ Em revisão de eventos
→ Pronto para fechar
→ Fechado
→ Enviado ao contador
→ Aguardando retorno
→ Em conciliação
→ Correção solicitada
→ Prévia aprovada
→ Aguardando documentos definitivos
→ Concluído
```

### 23.8. Fechamento experimental

O colaborador fictício deverá percorrer um ciclo mensal completo:

```text
Sincronização de batidas de teste
→ apuração
→ ocorrências
→ tratamentos
→ eventos experimentais
→ revisão
→ fechamento de teste
```

O fechamento experimental deverá:

- Indicar `Modo: TESTE` em todas as telas e arquivos.
- Usar competência ou identificador experimental inequívoco.
- Não compor folha, relatórios ou indicadores oficiais.
- Não ser enviado a destinatários reais.
- Não produzir arquivo bancário ou documento trabalhista oficial.
- Permitir reabertura, versão, auditoria e reprocessamento como o fluxo real.

No modo sombra, poderá existir um fechamento comparativo, também sem efeito oficial.

## 24. Versionamento e reabertura

### 24.1. Conteúdo congelado

Ao fechar, o Coala deverá congelar ou referenciar imutavelmente:

- Batidas e versões de origem utilizadas.
- Ajustes administrativos utilizados.
- Jornada esperada por dia.
- Versões de contrato, turno, escala e regras utilizadas.
- Ausências, documentos e tratamentos considerados.
- Resultados automáticos e finais.
- Ocorrências e ressalvas.
- Eventos gerados.
- Resumo por colaborador.
- Resumo da empresa.
- Responsável e data.
- Modo operacional e efeito oficial ou experimental.
- Feature flags e escopo de ativação vigentes.

Exemplo:

```text
Agosto/2026 — Versão 1
Fechada em 01/09/2026 às 10:31
Responsável: Fernanda/RH
5 ressalvas
```

### 24.2. Reabertura

```text
Reabrir
→ informar motivo
→ preservar V1
→ criar área de trabalho V2
→ aplicar ajustes
→ reprocessar somente o necessário
→ revisar eventos afetados
→ fechar novamente
→ Agosto/2026 — Versão 2
```

Nenhuma versão anterior será sobrescrita ou apagada.

## 25. Resumo para o contador

Somente participantes e eventos oficiais dos modos `PILOTO` ou `PRODUÇÃO`, dentro do escopo aprovado, poderão compor o resumo oficial. Dados `TESTE` e `SHADOW` ficarão excluídos por regra de domínio, não apenas por filtro de interface.

### 25.1. Por colaborador

| Colaborador | Evento | Quantidade | Origem | Observação |
|---|---|---:|---|---|
| Maria | HE 60% | 3h22 | Apuração Coala | Resultado final aprovado |
| Maria | Falta | 6h | Tratamento RH | Falta do dia 14/08 |
| João | HE 100% | 6h | Apuração Coala | Trabalho em feriado |
| Ana | VT | Ativar | Benefícios | Vigência em 01/09 |

### 25.2. Resumo geral

- Competência e empresa.
- Versão do fechamento.
- Quantidade de colaboradores.
- Admissões e desligamentos.
- Férias, licenças e afastamentos.
- Eventos de jornada.
- Movimentações de benefícios.
- Observações.
- Ressalvas.
- Data e responsável pelo fechamento.

### 25.3. Formatos

Prioridade:

1. XLSX estruturado.
2. CSV com layout versionado.
3. Portal seguro.
4. PDF como documento de leitura.

Exportações experimentais, quando necessárias para validação, deverão usar layout e identificação visual de teste, destinatários controlados e trilha de auditoria separada.

## 26. Contabilidade

### 26.1. Envio

- Competência.
- Versão do fechamento.
- Destinatários.
- Assunto e mensagem.
- Arquivos.
- Data e responsável.
- Identificador da mensagem e da conversa.
- Status.

O serviço de envio deverá rejeitar competências e eventos experimentais quando o destino for um canal oficial. Testes de e-mail utilizarão destinatário seguro e assunto marcado como `TESTE — SEM EFEITO`.

### 26.2. Fluxo

```text
Pronto para envio
→ Enviado
→ Aguardando retorno
→ Retorno recebido
→ Em conciliação
→ Correção solicitada, quando necessário
→ Nova prévia recebida
→ Aprovado
→ Documentos definitivos recebidos
→ Concluído
```

### 26.3. E-mail

- O e-mail continuará sendo um canal de comunicação.
- O Coala deverá guardar identificadores da mensagem e da conversa quando o provedor permitir.
- Respostas e correções deverão permanecer associadas à competência e à versão.
- O fechamento existirá independentemente do e-mail; o Coala será o registro oficial do processo.

### 26.4. Portal do contador — fase posterior

- Acesso por link seguro.
- Visualização apenas das empresas e competências autorizadas.
- Download do resumo e arquivos.
- Upload de prévia.
- Upload de documentos definitivos.
- Mensagens.
- Histórico do processo.

## 27. Retorno, prévias e conciliação

### 27.1. Retorno do contador

- Competência.
- Versão do fechamento enviada.
- Versão do retorno.
- Data.
- Arquivo original.
- Tipo de documento.
- Observação do contador.
- Responsável pelo recebimento.
- Dados estruturados extraídos ou digitados.
- Relação com o envio e com a conversa original.

Documentos possíveis:

- Prévia da folha.
- Relatório de eventos.
- Resumo financeiro.
- Holerites.
- Arquivos bancários.
- Documentos governamentais, quando aplicáveis.
- Documentos definitivos.

### 27.2. Tela de conciliação

| Evento | Coala | Contador | Resultado |
|---|---:|---:|---|
| HE 60% | 3h22 | 3h22 | OK |
| HE 100% | 6h | 6h | OK |
| Falta | 6h | 0h | Divergência |
| VT | Ativar | Ativar | OK |

Classificações:

- Igual.
- Divergência de quantidade.
- Ausente no contador.
- Ausente no Coala.
- Código não reconhecido.
- Informação incomparável.
- Conferência manual necessária.

Decisões:

- Aceitar resultado do contador.
- Manter resultado do Coala e solicitar correção.
- Ajustar mapeamento.
- Registrar justificativa.
- Marcar como conferido manualmente.

### 27.3. Solicitação de correção

Exemplo:

```text
Colaborador: Maria da Silva
Evento: Falta

Enviado pelo Coala: 6 horas
Retornado pelo contador: 0 hora

Mensagem:
A falta referente ao dia 14/08 não foi considerada.
Favor revisar a prévia.
```

O sistema registrará a divergência, enviará ou preparará a mensagem, alterará o status, aguardará nova versão e preservará a prévia anterior.

## 28. Permissões

### Colaborador

- Ver as próprias escalas, batidas e apurações autorizadas.
- Enviar justificativas e documentos.
- Informar esquecimento de batida.
- Solicitar correção, ausência, troca de turno e benefício.
- Acompanhar decisões.
- Ver documentos liberados.

O colaborador não poderá editar diretamente a batida original nem aprovar a própria solicitação.

### Gestor

- Ver a própria equipe.
- Ver escalas e ocorrências operacionais.
- Comentar.
- Criar comunicações ou ausências permitidas.
- Aprovar solicitações específicas.
- Não ajustar ponto ou eventos de folha sem permissão explícita.

### RH operacional

- Sincronizar batidas.
- Vincular colaboradores.
- Gerenciar turnos e escalas conforme permissão.
- Cadastrar e administrar ausências.
- Tratar ocorrências.
- Analisar documentos.
- Criar ajustes administrativos autorizados.
- Executar reprocessamentos.
- Gerar eventos.

### RH responsável

- Publicar regras de jornada.
- Aprovar ajustes e tratamentos sensíveis.
- Fechar com ou sem ressalvas.
- Reabrir competências.
- Enviar ao contador.
- Aprovar conciliação.
- Ativar, alterar estágio e desativar participantes da Jornada V2.
- Autorizar a passagem entre teste, shadow, piloto e produção.

### Financeiro

- Ver resumos, eventos financeiros e documentos autorizados.
- Acompanhar o status.
- Não alterar batidas, apuração ou decisões de RH.

### Administrador

- Configurar integrações.
- Configurar regras, turnos, tipos e permissões.
- Gerenciar acessos técnicos.
- Acessar auditoria conforme governança.
- Gerenciar feature flags e isolamento dos dados experimentais.
- Não promover participantes para produção sem a aprovação funcional definida.

### Contador externo

- Ver somente empresas e competências autorizadas.
- Baixar arquivos.
- Enviar retornos.
- Responder solicitações.
- Sem acesso ao restante do RH, batidas ou documentos médicos.

## 29. Auditoria

### 29.1. Escopo

Serão auditados:

- Sincronizações.
- Batidas importadas.
- Alterações, cancelamentos e exclusões na origem.
- Vínculos de colaboradores.
- Contratos e cargas horárias.
- Regras de jornada.
- Turnos.
- Escalas e trocas.
- Feriados e folgas.
- Ajustes administrativos de ponto.
- Ausências e férias.
- Documentos.
- Solicitações.
- Tratamentos.
- Reprocessamentos.
- Resultados de apuração.
- Eventos de folha.
- Benefícios.
- Fechamento e reabertura.
- Versionamento.
- Envio ao contador.
- Retorno e prévias.
- Conciliação e aprovação.
- Criação e identificação de colaborador fictício.
- Ativação e desativação da Jornada V2.
- Mudança entre teste, shadow, piloto e produção.
- Escopo de feature flags.
- Cópias ou adaptações de dados da escala atual para a Escala V2.
- Rollback de participante ou grupo.

### 29.2. Dados mínimos

Sempre que aplicável:

- Usuário ou processo.
- Data/hora.
- Entidade e identificador.
- Ação.
- Valor anterior.
- Valor novo.
- Origem.
- Motivo.
- Documento ou solicitação relacionados.
- Competência e versão afetadas.
- Modo operacional anterior e novo.
- Escopo de ativação anterior e novo.

Registros de auditoria não deverão ser alterados ou removidos por usuários operacionais.

## 30. Segurança e proteção documental

- Aplicar acesso por menor privilégio.
- Separar documentos médicos de anexos operacionais comuns.
- Restringir documentos sensíveis ao RH autorizado.
- Manter URLs temporárias ou downloads autenticados.
- Criptografar dados em trânsito e utilizar os controles do armazenamento em repouso.
- Definir política de retenção e descarte por categoria documental.
- Auditar visualização e download quando necessário.
- Evitar expor informações médicas em notificações, relatórios gerais ou acesso do gestor.
- Limitar o acesso do contador aos documentos estritamente necessários.
- Separar logicamente dados de teste, shadow e oficiais.
- Bloquear por regra de backend qualquer efeito externo real originado em `TESTE` ou `SHADOW`.
- Impedir que o nome do colaborador seja o único mecanismo de identificação de dado fictício.
- Exigir marcação explícita em arquivos, documentos e notificações experimentais.

## 31. Entidades principais

| Entidade | Responsabilidade |
|---|---|
| Employee | Colaborador |
| EmploymentContract | Contrato, vínculo e carga horária com vigência |
| ExternalEmployeeLink | Associação do colaborador com o sistema externo |
| ShiftTemplate | Modelo versionado de turno |
| LegacyScheduleReference | Referência somente de leitura à escala atual, quando utilizada |
| V2ScheduleEntry | Jornada escalada para uma data dentro da Jornada V2 |
| WorkRule / TimeRule | Regras e tolerâncias do Motor de Jornada |
| Holiday | Feriado e abrangência |
| TimePunch | Batida original e versões recebidas da origem |
| PunchSyncRun | Execução de sincronização ou reconciliação |
| WorkdayExpectation | Jornada esperada e referências utilizadas no dia |
| DailyTimeCalculation | Execução do cálculo diário |
| TimeCalculationResult | Resultado automático ou final da apuração |
| TimeOccurrence | Ocorrência gerada pelo motor ou processo administrativo |
| TimeAdjustment | Ajuste administrativo sem apagar a batida original |
| OccurrenceTreatment | Decisão do RH sobre uma ocorrência |
| EmployeeRequest | Solicitação genérica do colaborador |
| AbsenceRequest | Pedido de ausência ainda sujeito a análise |
| Absence | Ausência reconhecida e aplicada à jornada |
| AbsenceType | Tipo configurável de ausência |
| HRDocument | Documento, atestado ou anexo |
| BenefitEnrollment | Histórico da adesão ao benefício |
| BenefitRequest | Pedido de movimentação de benefício |
| PayrollEventType | Tipo configurável de evento de folha |
| PayrollEvent | Evento gerado ou lançado manualmente |
| PayrollClosing | Fechamento da competência |
| EmployeePayrollClosing | Situação e resumo individual no fechamento |
| ClosingVersion | Versão congelada do fechamento |
| AccountantSubmission | Envio ao contador |
| AccountantReturn | Retorno ou prévia do contador |
| PayrollReconciliation | Processo de conciliação |
| ReconciliationItem | Item comparado entre Coala e contador |
| PayrollDocument | Documento da folha |
| AuditLog | Registro imutável de auditoria |
| TimekeepingEnrollment | Ativação individual ou por escopo na Jornada V2 |
| RolloutCohort | Grupo controlado de teste, shadow, piloto ou produção |
| ExperimentContext | Identificação explícita de dados experimentais |
| FeatureFlagAssignment | Liberação gradual de capacidades por escopo |

### 31.1. Relações conceituais essenciais

```text
Employee
├── EmploymentContract
├── ExternalEmployeeLink
├── TimekeepingEnrollment → RolloutCohort / ExperimentContext
├── V2ScheduleEntry → ShiftTemplate
├── TimePunch
├── AbsenceRequest → Absence
├── EmployeeRequest
├── BenefitEnrollment
└── EmployeePayrollClosing

WorkdayExpectation
├── contrato/regra/turno/escala vigentes
├── feriado/folga/ausência
└── DailyTimeCalculation
    ├── TimePunch
    ├── TimeAdjustment
    ├── TimeCalculationResult
    └── TimeOccurrence → OccurrenceTreatment

TimeCalculationResult final
└── PayrollEvent
    └── PayrollClosing → ClosingVersion
```

Entidades da Jornada V2 não substituirão automaticamente entidades da escala atual. Quando houver leitura do legado, `LegacyScheduleReference` ou adaptador equivalente manterá a origem explícita e evitará escrita reversa.

## 32. Notificações

### Colaborador

- Justificativa solicitada.
- Correção de ponto recebida ou decidida.
- Documento recusado.
- Solicitação aprovada, negada ou cancelada.
- Prazo próximo.
- Documento disponibilizado.

### Gestor

- Troca de turno aguardando decisão.
- Ocorrência da equipe que exige manifestação.
- Ausência comunicada.
- Escala alterada.

### RH

- Sincronização concluída ou com falha.
- Batidas alteradas ou canceladas retroativamente.
- Pessoas não vinculadas.
- Dias reprocessados.
- Novas ocorrências.
- Novas justificativas.
- Documentos aguardando análise.
- Competência próxima do fechamento.
- Alteração após o fechamento.
- Retorno do contador recebido.
- Divergência encontrada.

Notificações de teste serão exibidas apenas em canais experimentais ou para destinatários autorizados e carregarão marcação inequívoca. Shadow mode não enviará mensagens operacionais reais aos colaboradores.

### Contador

- Novo fechamento disponível.
- Correção solicitada.
- Documento adicional enviado.
- Prazo próximo.
- Prévia aprovada.

## 33. Relatórios e indicadores

- Cobertura de sincronização das batidas.
- Batidas novas, alteradas, canceladas e duplicadas.
- Pessoas não vinculadas.
- Escalas sem batida e batidas sem escala.
- Dias apurados e dias com erro técnico.
- Ocorrências por tipo, unidade e colaborador.
- Tratamentos por responsável.
- Tempo médio de resolução.
- Ajustes administrativos por tipo e responsável.
- Jornadas previstas e trabalhadas.
- Horas extras por período e percentual.
- Atrasos, saídas antecipadas e faltas.
- Intervalos irregulares.
- Trabalho em folgas e feriados.
- Ausências por tipo e origem.
- Documentos pendentes.
- Benefícios ativos e movimentações.
- Eventos enviados ao contador.
- Divergências encontradas.
- Histórico de versões.
- Fechamentos com ressalvas.
- Situação das competências.
- Tempo entre fechamento, retorno e aprovação.
- Colaboradores somente no sistema atual.
- Colaboradores em teste.
- Colaboradores em shadow mode.
- Colaboradores em piloto.
- Colaboradores em produção V2.
- Apurações comparadas entre legado e V2.
- Divergências de comparação encontradas, classificadas e resolvidas.
- Rollbacks realizados.
- Falhas do novo motor por modo operacional.

Os relatórios deverão respeitar permissões e restringir a exposição de informações médicas.

Relatórios e indicadores oficiais excluirão dados de teste e shadow por padrão e por regra de backend. Um painel específico de implantação acompanhará a transição sem contaminar métricas operacionais oficiais.

## 34. Arquitetura técnica inicial

### 34.1. Estratégia

Adotar um monólito modular dentro da arquitetura atual do Coala, sem introduzir microserviços nesta fase.

O Motor de Apuração de Jornada deverá ser um módulo de domínio isolado das telas e do conector externo, ainda que executado dentro da mesma aplicação.

A Jornada V2 também será isolada do fluxo atual por contratos de leitura, namespaces ou coleções/tabelas próprias, permissões e controles de ativação. A implementação não poderá exigir que a escala atual seja remodelada antes de funcionar.

```text
SISTEMA DE PONTO
        ↓
Conector
        ↓
Batidas brutas
        ↓
┌───────────────────────────┐
│ MOTOR DE JORNADA DO COALA │
└───────────────────────────┘
        ↑
        ├── Contrato
        ├── Turno
        ├── Escala
        ├── Regras
        ├── Feriados
        ├── Folgas
        ├── Férias
        └── Ausências
        ↓
Apuração diária
        ↓
Ocorrências
        ↓
Tratamento RH / ajustes
        ↓
Reprocessamento
        ↓
Eventos de folha
```

### 34.2. Módulos internos sugeridos

```text
Employees
Contracts
Scheduling
TimeRules
PunchIntegration
TimeCalculationEngine
Absences
Requests
Occurrences
Adjustments
Benefits
PayrollEvents
PayrollClosing
Accounting
Documents
Audit
Notifications
RolloutControl
LegacyScheduleAdapter
```

### 34.3. Princípios técnicos

- Conectores idempotentes.
- Batidas originais e versões de origem preservadas.
- Motor determinístico para as mesmas entradas e mesma versão de regra.
- Versionamento do algoritmo e das regras.
- Jobs observáveis, reprocessáveis e com escopo direcionado.
- Fila de reprocessamento por colaborador e data.
- Histórico append-only para auditoria e versões fechadas.
- Documentos armazenados com acesso restrito.
- Transações nas mudanças críticas de estado.
- Índices planejados antes de liberar consultas em produção.
- Separação entre batida, ajuste, cálculo automático, tratamento e evento de folha.
- Datas e horas armazenadas com instante normalizado, timezone e contexto local.
- Testes de cenários de jornada como parte obrigatória da entrega.
- Feature flags avaliadas no servidor para capacidades sensíveis.
- Ativação da Jornada V2 por colaborador, com futura composição por grupo, unidade e empresa.
- Separação explícita entre dados `TESTE`, `SHADOW`, `PILOTO` e `PRODUÇÃO`.
- Bloqueio de side effects oficiais para teste e shadow.
- Adaptador de leitura do legado sem escrita reversa.
- Rollback de participação sem remoção de histórico.

### 34.4. Persistência

A escolha entre Firestore e PostgreSQL deverá ser avaliada durante a modelagem técnica. A decisão considerará:

- Consultas temporais e relacionais.
- Volume de batidas.
- Necessidade de transações.
- Versionamento e auditoria.
- Custo operacional.
- Compatibilidade com a arquitetura atual.
- Relatórios e exportações.

Não haverá migração automática de todo o Coala nem adoção híbrida sem justificativa de custo e operação.

### 34.5. Processamento e consistência

- A sincronização salva batidas antes de disparar cálculos.
- Um evento de domínio identifica os dias afetados.
- O job de apuração usa snapshot consistente das entradas.
- O resultado registra hash ou referências das entradas utilizadas.
- Repetir o mesmo cálculo não cria ocorrências ou eventos duplicados.
- Falhas parciais podem ser retomadas.
- Fechamentos congelados não são alterados por jobs posteriores.
- Todo job resolve o modo operacional antes de persistir resultados ou disparar efeitos.
- Filas experimentais e oficiais deverão ser separadas logicamente ou carregar validação obrigatória de contexto.

### 34.6. Feature flags e controle de liberação

Utilizar feature flags ou mecanismo equivalente para liberar capacidades sem afetar o fluxo atual. Exemplos conceituais:

```text
new_timekeeping_module
new_schedule_v2
new_absence_module
new_time_calculation_engine
new_monthly_closing
```

As flags poderão controlar disponibilidade de tela ou capacidade técnica, mas não substituirão o `TimekeepingEnrollment` por colaborador. Para produzir resultado, ambas as condições deverão ser satisfeitas:

```text
feature disponível para o escopo
+ colaborador habilitado no estágio correto
```

Uma flag global nunca deverá ativar automaticamente a Jornada V2 oficial para toda a empresa.

### 34.7. Proteção contra efeitos externos

Antes de executar qualquer efeito, o backend deverá verificar o modo do dado e do fechamento. Dados `TESTE` ou `SHADOW` serão excluídos de:

- Folha oficial.
- Exportação oficial para o contador.
- Movimentações reais de vale-transporte.
- Notificações reais.
- Relatórios e indicadores oficiais.
- Arquivos bancários.
- Documentos oficiais.
- Integrações com efeito financeiro ou trabalhista.

Caso uma funcionalidade externa precise ser testada, deverá utilizar sandbox, destinatário controlado ou saída marcada como experimental.

### 34.8. Rollback

Retirar um colaborador do novo fluxo não apagará batidas, cálculos, ocorrências, tratamentos ou fechamentos experimentais já produzidos.

Exemplo:

```text
Maria — Jornada V2: PILOTO
        ↓ problema identificado
Maria — Jornada V2: DESATIVADA
```

O sistema anterior continuará disponível enquanto a migração não estiver consolidada. Serão auditados estado anterior, estado novo, responsável, data, motivo e competências afetadas.

## 35. Implantação gradual e coexistência com o sistema atual

### 35.1. Princípio obrigatório

> A nova Jornada do Coala deverá nascer paralelamente ao sistema atual, ser testada inicialmente com um colaborador fictício e somente assumir responsabilidades reais de forma gradual, por colaborador ou grupo, depois de validada. Durante a transição, nenhuma funcionalidade nova poderá alterar involuntariamente a escala ou o processo oficial já existente.

### 35.2. Sistema atual preservado

Na primeira etapa:

```text
SISTEMA / ESCALA ATUAL
→ continua funcionando exatamente como hoje
→ continua sendo utilizado na operação real
→ continua produzindo o processo oficial

NOVO MÓDULO DE JORNADA
→ funciona paralelamente
→ possui dados e rotinas próprios
→ inicialmente é experimental
→ não altera automaticamente a escala atual
```

O novo módulo deverá funcionar sem exigir mudanças estruturais no fluxo atual. A existência da Jornada V2 não autoriza remover, reescrever ou redirecionar rotinas legadas.

### 35.3. Estrutura isolada do novo módulo

O novo módulo deverá possuir, quando aplicável, estrutura própria para:

- Turnos V2.
- Regras de jornada.
- Tolerâncias e regras de tempo computável.
- Intervalos.
- Escala V2 utilizada pela apuração.
- Ausências, férias, folgas e feriados.
- Batidas e sincronizações.
- Motor de apuração.
- Ocorrências.
- Ajustes administrativos.
- Eventos experimentais de folha.
- Fechamento experimental.

Essas entidades e rotinas coexistirão com as estruturas atuais e não deverão substituí-las implicitamente.

### 35.4. Identificação dos modos

Todo participante, apuração, evento e fechamento da Jornada V2 deverá possuir modo explícito:

| Modo | Finalidade | Efeito oficial |
|---|---|---|
| `DESATIVADA` | Fora da Jornada V2 | Nenhum |
| `TESTE` | Colaborador fictício ou sandbox | Nenhum |
| `SHADOW` | Cálculo paralelo de colaborador real | Nenhum |
| `PILOTO` | Novo fluxo oficial para escopo reduzido | Somente para participantes aprovados |
| `PRODUÇÃO` | Fluxo oficial para escopo migrado | Sim |

O modo deverá aparecer em telas, relatórios de transição, logs, apurações, eventos, exportações experimentais e fechamentos.

### 35.5. Primeira implantação com colaborador fictício

A primeira implantação será exclusiva para um colaborador fictício. Ele será identificado por atributo técnico, como `ExperimentContext` ou `isTestSubject`, e não apenas pelo nome.

O colaborador fictício deverá permitir validar:

- Cadastro e contrato.
- Vínculo externo ou fonte de batidas de teste.
- Turno e Escala V2.
- Jornada esperada.
- Intervalos e tolerâncias.
- Folgas, férias, feriados e ausências.
- Batidas regulares e irregulares.
- Falta de batida.
- Atraso e saída antecipada.
- Jornada excedente e horas extras.
- Documentos e justificativas.
- Ajustes administrativos.
- Tratamento de ocorrências.
- Reprocessamento.
- Eventos experimentais de folha.
- Fechamento mensal de teste.
- Reabertura, versionamento e auditoria.

Inicialmente:

```text
Colaboradores reais
→ utilizam exclusivamente o fluxo atual

Colaborador fictício
→ utiliza a Jornada V2 em modo TESTE
```

### 35.6. Isolamento de efeitos do teste

O colaborador fictício e qualquer dado experimental serão excluídos de:

- Folha oficial.
- Exportação oficial para o contador.
- Movimentações reais de vale-transporte.
- Notificações reais.
- Relatórios e indicadores oficiais.
- Arquivos bancários.
- Documentos oficiais.
- Integrações externas com efeito financeiro ou trabalhista.

Testes dessas saídas utilizarão sandbox, destinatário controlado ou arquivo marcado como `TESTE — SEM EFEITO OFICIAL`.

### 35.7. Fechamento experimental

O colaborador fictício deverá completar um ciclo mensal de teste:

```text
Batidas de teste
→ apuração
→ ocorrências
→ justificativas e ajustes
→ reprocessamento
→ eventos experimentais
→ revisão
→ fechamento de teste
→ reabertura e nova versão, quando necessário
```

Esse fechamento terá identificador e modo experimentais, não será misturado com competências oficiais e não poderá ser promovido diretamente a fechamento real.

### 35.8. Modo sombra

Depois da validação fictícia, colaboradores reais selecionados poderão entrar em `SHADOW`:

```text
PROCESSO ATUAL
→ permanece oficial

MOTOR DA JORNADA V2
→ recebe batidas e calcula em paralelo
→ produz resultado comparativo
→ não altera o processo oficial
```

Serão comparados, conforme disponibilidade do processo atual:

- Jornada trabalhada.
- Atrasos.
- Intervalos.
- Faltas.
- Horas excedentes.
- Horas extras.
- Ocorrências.

Divergências serão classificadas e analisadas, mas não modificarão automaticamente escala, folha, eventos ou fechamento oficiais.

### 35.9. Piloto controlado

Depois do shadow mode, um escopo reduzido poderá entrar em `PILOTO`:

- Um colaborador.
- Alguns colaboradores.
- Um grupo definido pelo RH.
- Uma unidade.

Nesse estágio, a Jornada V2 poderá se tornar oficial somente para os participantes aprovados. Os demais continuarão no fluxo atual. O escopo deverá ser explícito, versionado e auditado.

### 35.10. Expansão gradual

```text
Colaborador fictício
        ↓
Modo sombra
        ↓
Piloto controlado
        ↓
Grupo maior
        ↓
Unidade
        ↓
Demais unidades
        ↓
Migração completa
```

Não haverá virada obrigatória de toda a empresa de uma única vez. A expansão poderá ser pausada ou revertida em qualquer estágio.

### 35.11. Ativação seletiva

O controle de ativação deverá aceitar, progressivamente:

- Colaborador.
- Grupo ou coorte.
- Unidade.
- Empresa.

A ativação individual é requisito mínimo. Regras de composição deverão evitar que uma configuração ampla promova inadvertidamente um colaborador em teste ou shadow. Exceções individuais terão precedência sobre escopos mais amplos.

### 35.12. Rollback

Durante teste, shadow e piloto, será possível retirar um participante do novo fluxo:

```text
Maria — Jornada V2: PILOTO
        ↓ problema encontrado
Maria — Jornada V2: DESATIVADA
```

O rollback deverá:

- Preservar todo o histórico da Jornada V2.
- Impedir novos efeitos oficiais da V2 para o participante.
- Permitir continuidade do processo anterior.
- Identificar competências que exigem ação manual.
- Registrar estado anterior, estado novo, responsável, data e motivo.

### 35.13. Relação com a escala atual

Durante a coexistência:

```text
ESCALA ATUAL
        ↓
leitura / cópia / adaptação controlada
        ↓
ESCALA V2
```

Será evitado:

```text
ESCALA V2
        ↓
alteração automática
        ↓
ESCALA ATUAL
```

Qualquer migração será explícita e auditável. Não serão executadas automaticamente migração de todos os turnos, migração de todas as escalas, substituição de regras ou ativação em massa de colaboradores.

### 35.14. Critérios de passagem entre estágios

#### Teste fictício → Shadow

Somente avançar quando:

- Regras básicas funcionarem nos cenários definidos.
- Apuração estiver consistente e explicável.
- Ajustes e ausências produzirem o resultado esperado.
- Reprocessamento estiver validado.
- Fechamento experimental e versionamento funcionarem.
- Não houver impacto na escala ou no processo atual.
- Barreiras contra efeitos externos reais estiverem testadas.

#### Shadow → Piloto

Somente avançar quando:

- Resultados estiverem suficientemente alinhados com o processo oficial.
- Divergências relevantes estiverem compreendidas e classificadas.
- Estabilidade técnica estiver comprovada.
- Sincronização e reprocessamento estiverem observáveis.
- RH validar o fluxo operacional.
- Rollback individual estiver testado.

#### Piloto → Expansão

Somente avançar quando:

- Fechamento do piloto puder ser concluído.
- Não houver perda de dados.
- Auditoria estiver íntegra.
- Eventos e exportações oficiais estiverem corretos para o escopo.
- Rollback estiver validado.
- RH aprovar formalmente a expansão.

#### Expansão → Migração completa

Somente avançar quando:

- Todos os fluxos necessários estiverem cobertos.
- O módulo estiver estável nos escopos já migrados.
- Dados e resultados tiverem sido validados por competências suficientes.
- O RH estiver operando normalmente.
- Dependências relevantes do modelo anterior estiverem identificadas e resolvidas.

### 35.15. Observabilidade da transição

O painel de implantação mostrará:

- Colaboradores apenas no sistema atual.
- Colaboradores em teste.
- Colaboradores em shadow.
- Colaboradores em piloto.
- Colaboradores em produção V2.
- Apurações comparadas.
- Divergências encontradas, resolvidas e ainda abertas.
- Erros de sincronização.
- Reprocessamentos.
- Falhas do motor.
- Rollbacks.
- Fechamentos experimentais e oficiais por modo.
- Cobertura das regras testadas.

### 35.16. Desativação do legado

O sistema antigo continuará existindo durante toda a transição. Sua desativação será uma fase própria e só poderá ocorrer quando:

- Todos os fluxos necessários estiverem cobertos.
- A Jornada V2 estiver estável.
- Os dados tiverem sido validados.
- O RH estiver operando normalmente.
- O rollback da última expansão estiver disponível durante a janela acordada.
- Não existirem dependências relevantes do legado.
- A migração definitiva tiver aprovação formal.

Até esse momento, nenhuma decisão técnica presumirá substituição imediata da escala ou do processo atual.

## 36. Plano de implementação

O roadmap foi reorganizado para respeitar as dependências do cálculo: primeiro são definidos os dados que formam a jornada esperada; depois são trazidas as batidas; em seguida entra o motor; só então ocorrências, eventos e fechamento. Solicitações do colaborador vêm depois do fluxo administrativo básico, mas o módulo de Ausências é anterior ao motor porque altera sua entrada.

O plano será conduzido em duas dimensões independentes:

- **Trilha funcional:** constrói as capacidades do produto nas Fases 0 a 14.
- **Trilha de implantação:** controla quem pode usar cada capacidade e se ela produz ou não efeito oficial nas Fases A a H.

Concluir uma fase funcional não autoriza ativação geral. Toda capacidade continuará submetida ao estágio de implantação, às feature flags e ao modo do participante.

### 36.1. Trilha de implantação

#### Fase A — Infraestrutura para coexistência

- Criar feature flags.
- Criar `TimekeepingEnrollment` por colaborador.
- Criar modos `DESATIVADA`, `TESTE`, `SHADOW`, `PILOTO` e `PRODUÇÃO`.
- Criar identificação explícita de colaborador fictício e contexto experimental.
- Criar Escala V2 e demais namespaces isolados.
- Criar adaptador somente de leitura da escala atual, caso necessário.
- Bloquear efeitos oficiais originados em teste e shadow.
- Separar relatórios, notificações, documentos e exportações experimentais.
- Criar auditoria de ativação, mudança de estágio e rollback.

Critério de saída: o novo módulo pode existir e processar dados sem alterar a escala atual nem qualquer saída oficial.

#### Fase B — Colaborador fictício

- Criar um único colaborador explicitamente marcado como teste.
- Cadastrar contrato, regras, turnos e Escala V2.
- Gerar ou importar batidas de teste.
- Executar apuração básica em modo `TESTE`.
- Confirmar que nenhum colaborador real é incluído.

Critério de saída: o fluxo básico funciona exclusivamente para o colaborador fictício e todos os efeitos externos permanecem isolados.

#### Fase C — Validação completa do fictício

- Exercitar folgas, férias, ausências e feriados.
- Exercitar faltas de batida, atrasos, saídas antecipadas e jornadas excedentes.
- Exercitar justificativas, documentos, ajustes e tratamentos.
- Validar reprocessamento e explicabilidade.
- Gerar eventos experimentais.
- Executar fechamento mensal de teste, reabertura e nova versão.
- Validar bloqueios de exportação, notificação, benefício e documento oficial.

Critério de saída: todos os critérios `Teste fictício → Shadow` da seção 35.14 estão atendidos.

#### Fase D — Shadow mode com colaboradores reais

- Selecionar individualmente os participantes.
- Processar batidas reais no novo motor sem efeito oficial.
- Manter o processo atual como fonte oficial.
- Comparar resultados, classificar divergências e ajustar regras.
- Medir estabilidade, sincronização e reprocessamento.
- Validar rollback individual.

Critério de saída: todos os critérios `Shadow → Piloto` da seção 35.14 estão atendidos.

#### Fase E — Piloto controlado

- Definir coorte reduzida e responsáveis.
- Tornar a Jornada V2 oficial somente para o escopo aprovado.
- Manter o legado para os demais colaboradores.
- Concluir pelo menos um fechamento do piloto.
- Validar eventos, exportações, auditoria e rollback.

Critério de saída: todos os critérios `Piloto → Expansão` da seção 35.14 estão atendidos.

#### Fase F — Expansão gradual

- Ampliar por colaborador, grupo ou unidade.
- Monitorar indicadores e divergências a cada expansão.
- Manter exceções individuais e capacidade de rollback.
- Não ativar toda a empresa por consequência de uma flag global.

Critério de saída: os escopos migrados operam normalmente por competências suficientes e o RH aprova cada nova expansão.

#### Fase G — Migração definitiva

- Resolver dependências restantes do legado.
- Executar migrações de dados explicitamente aprovadas.
- Validar cobertura funcional e histórico.
- Aprovar formalmente a Jornada V2 como processo oficial para todo o escopo desejado.
- Manter janela de segurança e rollback conforme plano de corte.

Critério de saída: todos os critérios `Expansão → Migração completa` da seção 35.14 estão atendidos.

#### Fase H — Desativação do legado

- Confirmar ausência de dependências relevantes.
- Preservar acesso ao histórico necessário.
- Retirar gradualmente rotinas e navegação antigas.
- Monitorar a operação depois da desativação.
- Registrar aprovação, data e responsáveis.

Critério de saída: legado desativado sem perda de histórico, capacidade operacional ou rastreabilidade.

### 36.2. Trilha funcional

### Fase 0 — Descoberta da integração

Entregas:

- Identificação do sistema externo.
- Documentação da API.
- Estrutura completa das batidas.
- Identificadores de colaborador e batida.
- Timezone.
- Paginação e consulta incremental.
- Webhooks disponíveis.
- Alterações, cancelamentos e exclusões.
- Batidas inseridas manualmente na origem.
- Histórico recuperável.
- Limites e autenticação.
- Exemplos reais anonimizados.
- Estratégia de contingência por arquivo.

Critério de saída: contrato técnico de batidas conhecido, testado e aprovado.

### Fase 1 — Fundação do domínio

Entregas:

- Competências.
- Colaboradores e vínculos externos.
- Contratos, cargas horárias e vigências.
- Permissões.
- Auditoria.
- Armazenamento seguro de documentos.
- Tipos configuráveis iniciais.
- Convenções de datas, timezone e versionamento.
- Controle de ativação por colaborador.
- Contexto experimental e separação dos modos.
- Feature flags e barreiras contra efeitos oficiais.

Critério de saída: base capaz de representar colaboradores, vigências, decisões e histórico.

### Fase 2 — Jornada

Entregas:

- Turnos.
- Regras de jornada.
- Tolerâncias de marcação.
- Regras de tempo computável.
- Intervalos.
- Quantidade esperada de batidas.
- Escala V2 isolada.
- Adaptador somente de leitura da escala atual, se necessário.
- Trocas de turno.
- Folgas.
- Feriados.
- Vigências e histórico.

Critério de saída: Coala consegue construir a jornada esperada do colaborador fictício na Escala V2 sem alterar a escala atual.

### Fase 3 — Ausências

Entregas:

- Tipos configuráveis.
- Ausência integral e parcial.
- Lançamento direto pelo RH.
- Solicitação do colaborador em estrutura mínima.
- Férias, licenças, folgas e afastamentos.
- Documentos.
- Aprovações.
- Efeito sobre a jornada esperada.
- Vigência, histórico e auditoria.

Critério de saída: ausências reconhecidas alteram corretamente a jornada esperada antes do cálculo.

### Fase 4 — Integração das batidas

Entregas:

- Conector.
- Sincronização incremental e reconciliação.
- Webhook, se aplicável.
- Armazenamento das batidas.
- Idempotência e duplicidade.
- Vínculo de colaboradores.
- Alterações e exclusões retroativas.
- Importação contingencial.
- Tela de sincronização.
- Monitoramento.

Critério de saída: batidas brutas entram no Coala com origem, histórico e associação rastreáveis.

### Fase 5 — Motor de apuração

Entregas:

- Materialização da jornada esperada.
- Associação e pareamento das batidas.
- Jornada trabalhada.
- Intervalos.
- Tolerâncias.
- Atrasos e saídas antecipadas.
- Entrada antecipada e permanência posterior.
- Ausência parcial e integral.
- Falta e excesso de batidas.
- Jornada excedente e horas extras.
- Trabalho em feriados e folgas.
- Batida sem escala e escala sem batida.
- Explicabilidade do cálculo.
- Versionamento do motor.
- Suíte de testes de cenários.

Critério de saída: Coala parte de batidas brutas e produz uma apuração diária explicável e reproduzível.

### Fase 6 — Ocorrências, ajustes e reprocessamento

Entregas:

- Central de ocorrências.
- Fila por responsável.
- Justificativas e documentos.
- Tratamentos.
- Ajustes administrativos de ponto.
- Aprovação de ajustes sensíveis.
- Tratamento em lote.
- Reprocessamento direcionado.
- Histórico entre resultado anterior e novo.
- Ressalvas.

Critério de saída: RH consegue resolver exceções sem apagar dados originais e obter novo resultado calculado.

### Fase 7 — Portal do colaborador

Entregas:

- Meu RH → Solicitações.
- Justificativas.
- Esquecimento de batida.
- Correção de ponto.
- Documentos.
- Ausências.
- Troca de turno.
- Férias, quando aplicável.
- Acompanhamento do pedido.
- Notificações.
- Aplicação da decisão aos registros correspondentes.

Critério de saída: colaborador participa do processo com solicitações rastreáveis e conectadas à jornada.

### Fase 8 — Eventos de folha

Entregas:

- Tipos configuráveis.
- Mapeamentos para o contador.
- Geração automática a partir do resultado final.
- Lançamento manual.
- Aprovação.
- Recalculo e revisão quando a apuração mudar.
- Resumo individual.
- Consolidação da competência.

Critério de saída: apuração e tratamentos geram quantidades de folha confiáveis.

### Fase 9 — Fechamento mensal

Entregas:

- Painel orientado a exceções.
- Status por colaborador.
- Revisão de apuração e eventos.
- Fechamento regular.
- Fechamento com ressalvas.
- Congelamento.
- Versionamento.
- Reabertura justificada.
- Reprocessamento em nova versão.
- Resumos geral e individual.
- Exportação XLSX e CSV.
- Fechamento experimental identificado e isolado.
- Bloqueio de saídas oficiais para teste e shadow.

Critério de saída: competência experimental pode ser fechada e reaberta com rastreabilidade completa; exportações de teste permanecem isoladas. O uso oficial dependerá da trilha de implantação.

### Fase 10 — Benefícios

Entregas:

- Histórico do vale-transporte.
- Ativação, alteração, suspensão, desativação e reativação.
- Movimentação direta pelo RH.
- Solicitações do colaborador.
- Vigência e aprovação.
- Eventos de folha.

Critério de saída: movimentações de VT entram corretamente na competência.

### Fase 11 — Envio ao contador

Entregas:

- Destinatários e modelos de mensagem.
- Pacote do fechamento.
- Histórico de envio.
- E-mail e link seguro.
- Identificação da conversa.
- Status e prazos.

Critério de saída: fechamento enviado de forma padronizada e rastreável.

### Fase 12 — Retorno e documentos

Entregas:

- Upload pelo RH.
- Portal do contador.
- Prévias e versões.
- Documentos definitivos.
- Associação à competência e ao envio.
- Histórico.

Critério de saída: retornos centralizados no Coala.

### Fase 13 — Conciliação

Entregas:

- Estruturação do retorno.
- Mapeamento de eventos.
- Comparação.
- Destaque de divergências.
- Solicitação de correção.
- Nova versão.
- Aprovação.

Critério de saída: RH revisa prioritariamente o que divergiu.

### Fase 14 — Relatórios e automações

Entregas:

- Indicadores.
- Alertas e prazos.
- Relatórios gerenciais.
- Jobs agendados.
- Cobranças automáticas.
- Monitoramento da integração e do motor.
- Métricas operacionais.

Critério de saída: processo previsível, monitorado e mensurável.

## 37. Escopo do MVP

O MVP funcional deverá cobrir as fases funcionais 0 a 9 e provar o fluxo completo a partir das batidas brutas. Sua primeira execução será limitada às Fases A, B e C da trilha de implantação, exclusivamente com o colaborador fictício:

```text
Cadastrar regras de jornada
        ↓
Cadastrar turnos
        ↓
Montar a Escala V2 isolada
        ↓
Cadastrar ausências
        ↓
Sincronizar batidas
        ↓
Apurar jornada automaticamente
        ↓
Identificar ocorrências
        ↓
RH tratar ocorrências
        ↓
Receber justificativas e documentos
        ↓
Aplicar ajustes administrativos autorizados
        ↓
Reprocessar quando necessário
        ↓
Gerar eventos de folha
        ↓
Revisar por colaborador
        ↓
Fechar competência
        ↓
Versionar
        ↓
Gerar exportação experimental do resumo
```

O MVP somente estará concluído quando o Coala conseguir partir das batidas brutas do colaborador fictício e produzir uma apuração de jornada confiável, explicável e auditável, sem alterar a escala atual nem produzir qualquer efeito oficial.

O MVP deverá demonstrar também:

- Ativação individual em modo `TESTE`.
- Identificação técnica do colaborador fictício.
- Feature flags e isolamento dos dados.
- Escala V2 sem escrita na escala atual.
- Fechamento mensal experimental completo.
- Bloqueio de folha, contador, benefício, notificação, documento e relatório oficiais.
- Reabertura, nova versão e rollback sem perda de histórico.

Shadow mode, piloto e produção não fazem parte da primeira liberação do MVP; são estágios posteriores de implantação, condicionados aos critérios da seção 35.14.

Ficam para entregas posteriores ao MVP:

- Vale-transporte completo e demais benefícios.
- Envio integrado de e-mail.
- Portal do contador.
- Retorno estruturado.
- Conciliação automática.
- Documentos definitivos.
- Automações e relatórios avançados.

## 38. Critérios de sucesso do MVP

O MVP estará concluído quando o RH conseguir:

1. Selecionar uma competência.
2. Cadastrar e versionar regras de jornada.
3. Cadastrar turnos, intervalos e tolerâncias.
4. Montar e alterar a Escala V2 sem modificar a escala atual.
5. Cadastrar férias, folgas e ausências diretamente.
6. Receber solicitações de ausência do colaborador.
7. Sincronizar as batidas.
8. Identificar colaboradores não vinculados.
9. Consultar as batidas por colaborador e dia.
10. Visualizar a jornada esperada.
11. Visualizar a apuração automática e sua explicação.
12. Identificar ocorrências geradas pelo motor.
13. Corrigir administrativamente situações autorizadas sem apagar as batidas originais.
14. Solicitar e analisar justificativas.
15. Receber e analisar documentos.
16. Criar ou vincular ausências a uma ocorrência.
17. Reprocessar somente os dias ou períodos necessários.
18. Comparar o resultado anterior e o novo.
19. Gerar eventos de folha.
20. Revisar cada colaborador por exceção.
21. Fechar uma competência experimental de forma regular ou com ressalvas.
22. Reabrir gerando uma nova versão.
23. Gerar exportação experimental, identificada e impedida de seguir para o contador oficial.
24. Consultar todo o histórico e a auditoria.
25. Ativar e desativar individualmente o colaborador fictício.
26. Confirmar que nenhum colaborador real foi processado pela Jornada V2.
27. Confirmar que a escala atual permaneceu inalterada.
28. Confirmar que dados experimentais não entraram em folha, benefícios, notificações, relatórios ou documentos oficiais.

Critérios técnicos complementares:

- Reimportar a mesma batida não gera duplicidade.
- Alterar ou cancelar uma batida na origem provoca reprocessamento direcionado.
- O mesmo conjunto de entradas e a mesma versão de regra produzem o mesmo resultado.
- Uma competência fechada não é modificada por sincronização ou job posterior.
- Todos os resultados exibem regras, batidas, ajustes e tratamentos que os originaram.
- Cenários críticos de jornada possuem testes automatizados.
- A Jornada V2 funciona com estrutura própria sem escrita no legado.
- Feature flags e modo do participante são validados no backend.
- `TESTE` e `SHADOW` não conseguem disparar efeitos oficiais.
- O rollback preserva o histórico e interrompe novos processamentos da V2.

## 39. Questões em aberto antes do desenvolvimento

### Integração

- Qual é o sistema externo de ponto?
- Existe API oficial?
- Como o colaborador é identificado?
- Como cada batida é identificada?
- Há webhook?
- A API permite consulta incremental?
- Como funciona a paginação?
- Como batidas alteradas são informadas?
- Como batidas excluídas ou canceladas são informadas?
- Existe timezone explícito?
- Existe identificação de dispositivo ou origem?
- Existem batidas inseridas manualmente na origem?
- É possível diferenciar uma batida manual de uma batida feita em dispositivo?
- Qual histórico pode ser recuperado?
- Quais são os limites e janelas da API?
- Qual frequência de sincronização será adotada?
- Qual janela de sobreposição será utilizada?
- Qual será o formato de contingência por arquivo?

### Jornada e regras

- Quais tipos de contrato e carga horária existem?
- Quais turnos existem atualmente?
- Existem turnos noturnos ou que atravessam a meia-noite?
- Quantas batidas são esperadas em cada turno?
- Quais regras de tolerância serão utilizadas?
- Haverá arredondamento? Em quais situações?
- Como será computada a entrada antecipada dentro e fora da tolerância?
- Como será computada a permanência posterior?
- Quais regras definem horas extras?
- Quais percentuais de hora extra existem?
- Como tratar trabalho em folga e feriado?
- Existe banco de horas? Se sim, quais regras?
- Como tratar múltiplos intervalos?
- Como tratar batida sem escala?
- Quem pode publicar uma nova versão de regra?

### Ausências e solicitações

- Quais tipos de ausência existirão inicialmente?
- Quais alteram a jornada esperada?
- Quais poderão ser solicitados pelo colaborador?
- Quais poderão ser cadastrados diretamente pelo RH?
- Quais poderão ser comunicados pelo gestor?
- Quais exigirão documento?
- Quais exigirão aprovação?
- Quais poderão ser parciais?
- Quais efeitos padrão terão na folha?
- Qual política de guarda será aplicada aos documentos médicos?
- Em quais casos a aprovação de uma solicitação cria automaticamente uma ausência?

### Ajustes e governança

- Quais perfis poderão ajustar ponto?
- Quais ajustes exigirão aprovação adicional?
- Quais ajustes exigirão justificativa e documento?
- Colaborador poderá sugerir horário ou apenas informar o esquecimento?
- Qual prazo será permitido para ajustes retroativos?
- Como tratar alterações recebidas depois do fechamento?
- Quais perfis poderão fechar com ressalvas?

### Implantação e coexistência

- Qual atributo identificará tecnicamente o colaborador fictício?
- As batidas de teste virão de sandbox, arquivo ou gerador controlado?
- Quais usuários poderão acessar a Jornada V2 experimental?
- Quais feature flags serão necessárias no primeiro corte?
- A Escala V2 será totalmente manual no teste ou receberá cópia somente de leitura do legado?
- Qual será a regra de precedência entre ativação individual, grupo, unidade e empresa?
- Qual quantidade de colaboradores e competências será usada em shadow mode?
- Qual limiar de divergência será aceito para avançar ao piloto?
- Qual grupo ou unidade é candidato ao primeiro piloto?
- Qual janela de rollback será mantida em cada expansão?
- Quais relatórios do processo atual estarão disponíveis para comparação no shadow mode?
- Quem aprovará formalmente cada mudança de estágio?
- Quais dependências do legado precisam permanecer até a migração definitiva?

### Folha e contabilidade

- Quais eventos de folha o contador utiliza?
- Quais códigos e unidades são esperados?
- Qual formato de exportação será utilizado?
- Haverá um layout por empresa contábil?
- Quais eventos exigirão aprovação manual?
- Quais documentos retornarão do contador?
- Qual canal de e-mail será integrado?
- Quais competências históricas deverão ser migradas ou apenas consultadas?

## 40. Definição final do produto

> O sistema externo registra e fornece as batidas. O Coala mantém contratos, regras de jornada, turnos, escalas, férias, folgas, feriados e ausências; armazena e interpreta as batidas; apura a jornada; identifica ocorrências; permite que colaborador e RH informem ausências, justificativas e documentos; permite ao RH tratar ocorrências e ajustar situações autorizadas sem apagar o registro original; reprocessa os períodos afetados; gera eventos mensais de folha; e controla o fechamento, o versionamento e a interação com a contabilidade.

> A Jornada V2 nasce paralelamente ao sistema atual. Primeiro opera somente com um colaborador fictício explicitamente marcado como teste; depois avança para shadow mode, piloto e expansão gradual por colaborador, grupo ou unidade. Até a migração formalmente aprovada, não substitui nem altera automaticamente a escala atual, e resultados experimentais não produzem efeitos oficiais.
