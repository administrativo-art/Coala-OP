# Plano de Implementação: Analytics Operacional em Formulários

## 1. Objetivo

Este plano define como transformar os formulários operacionais em uma fonte confiável de métricas estruturadas. A necessidade principal é responder perguntas como: quantas manutenções ocorreram na porta 09 nos últimos seis meses; qual máquina apresentou mais ocorrências; qual marca de equipamento gerou mais manutenção; quantas ocorrências de limpeza apareceram no balcão X; quantos problemas de uniforme foram apontados para um colaborador específico; e em qual item do uniforme ou quesito operacional esses problemas se repetem.

Hoje o módulo de formulários já possui uma base importante: projetos, subprojetos, modelos, templates, versões, aplicações, execuções, itens por tipo, respostas normalizadas, evidências, condicionais e criação de tarefas. A implementação proposta não deve substituir essa base. Ela deve acrescentar uma camada de classificação e geração de ocorrências analíticas em cima das respostas já coletadas. O formulário continua sendo a interface de coleta. O template passa a declarar o significado analítico de cada pergunta. A execução gera registros estruturados para consulta, painel e relatórios.

O objetivo não é criar uma ferramenta genérica de BI dentro do formulário. O objetivo é criar uma trilha operacional auditável: cada ocorrência precisa apontar de onde veio, qual pergunta gerou o registro, qual resposta foi dada, qual domínio ela representa, qual alvo foi afetado, qual quesito falhou ou foi confirmado, qual resultado deve entrar nas métricas, quais evidências existem, e se isso abriu uma tarefa corretiva.

A regra central deve ser: o auditor responde perguntas simples; o sistema gera informação estruturada. O usuário com permissão configura os domínios, alvos, quesitos e regras no template. O auditor não deve precisar escolher termos técnicos de analytics durante a execução, exceto quando o próprio formulário pedir um alvo ou detalhe operacional, como selecionar qual equipamento, qual colaborador, qual área ou quais itens do uniforme apresentaram problema.

## 2. Conceitos Funcionais

O primeiro conceito é o domínio. Domínio é a área ampla da ocorrência. Exemplos: Manutenção, Limpeza, Uniforme, Segurança, Qualidade, Temperatura, Atendimento, Estoque, Patrimônio e Processos. O domínio permite responder perguntas por categoria: quantas ocorrências de manutenção, quantas ocorrências de limpeza, quantas ocorrências de uniforme, quais unidades concentram problemas de qualidade.

O segundo conceito é o alvo. Alvo é aquilo sobre o que a ocorrência fala. Pode ser um equipamento do módulo de patrimônio, uma porta, um balcão, uma máquina, uma câmara fria, uma área da loja, uma unidade, um colaborador, um uniforme, um produto, um processo ou um item livre controlado por cadastro. O alvo precisa ter tipo e identificador. Quando o alvo existe em outro módulo, como patrimônio ou colaboradores, o registro deve guardar o id de origem e uma cópia do nome exibido no momento da ocorrência. Quando o alvo for local ou item operacional sem módulo próprio, ele deve vir de um cadastro administrável.

O terceiro conceito é o quesito. Quesito é o critério específico avaliado dentro de um domínio. Em Uniforme, quesitos podem ser Camisa, Avental, Touca, Calça, Sapato, Crachá, Higiene do uniforme, Estado de conservação ou Uniforme completo. Em Limpeza, quesitos podem ser Superfície limpa, Resíduo aparente, Organização, Lixeira, Vidro, Balcão, Câmara, Piso ou Banheiro. Em Manutenção, quesitos podem ser Porta, Borracha de vedação, Motor, Sensor, Iluminação, Vazamento, Ruído, Temperatura, Painel elétrico ou Estrutura.

O quarto conceito é o resultado. Resultado é a classificação final que entra na métrica. Exemplos: Conforme, Não conforme, Ocorrência, Manutenção necessária, Manutenção realizada, Pendente, Resolvido, Bloqueante, Atenção, Crítico. O resultado deve ser configurável, mas precisa ter uma semântica padronizada para relatórios: positivo, negativo, neutro ou corretivo. Assim o dashboard consegue calcular taxa de conformidade, reincidência e volume de problemas sem depender do texto de cada cliente.

O quinto conceito é a ocorrência. Ocorrência é o registro derivado de uma resposta. Ela não é necessariamente uma tarefa. Uma ocorrência pode ser apenas informativa, como "uniforme completo: conforme". Também pode ser negativa, como "touca ausente para colaborador X". Também pode gerar uma tarefa, como "corrigir borracha de vedação da porta 09". A ocorrência é o principal dado para analytics.

O sexto conceito é a evidência. Evidência é foto, assinatura, arquivo, localização, observação ou qualquer dado anexado à resposta. A ocorrência deve guardar links ou referências para as evidências relevantes, sem duplicar arquivos. Isso permite que um painel mostre números e que o gestor abra a ocorrência para conferir a prova.

## 3. Princípios de Produto

A configuração deve ser feita no template, não na execução. O usuário com permissão monta ou edita o modelo de formulário e define quais perguntas geram métrica. Ele decide se a pergunta pertence ao domínio Limpeza, se avalia o alvo Balcão, se o quesito é Superfície limpa, se uma resposta "não" gera uma ocorrência negativa, e se essa ocorrência abre tarefa.

O auditor deve ver apenas uma experiência de formulário. Se a pergunta for "Uniforme completo?", o auditor responde Sim ou Não. Se responder Sim, o fluxo finaliza aquele assunto. Se responder Não, o formulário mostra os itens do uniforme para selecionar os que estão com problema e, em cada item selecionado, permite descrever o problema. O auditor não precisa saber que isso gerará ocorrências de domínio Uniforme, alvo Colaborador, quesitos Touca, Avental ou Camisa, resultado Não conforme.

O sistema precisa gerar dados consistentes mesmo quando o formulário muda de versão. A ocorrência deve salvar ids da execução, do template, da versão, da seção e do item. Também deve salvar snapshots dos rótulos principais. Assim, se o quesito "Balcão" for renomeado para "Balcão de atendimento", relatórios antigos continuam entendíveis.

O cadastro de taxonomia precisa ser governado. Domínios, quesitos, resultados e alvos livres não devem ser criados por qualquer operador durante a execução. Usuários com permissão podem cadastrar, editar, desativar e ordenar esses registros. A execução pode consumir esses cadastros, mas não deve criar novos termos sem validação.

A solução deve ser incremental. Primeiro, criar taxonomias e configurar perguntas. Depois, gerar ocorrências na conclusão das execuções. Em seguida, construir consultas e dashboards. Por último, incluir automações, relatórios avançados e backfill histórico.

## 4. Modelo de Permissões

O módulo precisa de permissões claras. A permissão de visualizar formulários não deve permitir alterar taxonomia. A permissão de operar formulários não deve permitir criar domínio ou quesito. A permissão de gerenciar formulários pode editar templates, mas a empresa pode querer separar isso da governança dos indicadores. Por isso, o ideal é introduzir permissões específicas.

As permissões sugeridas são: visualizar analytics de formulários, gerenciar taxonomias analíticas, configurar analytics em templates, visualizar ocorrências, editar ocorrências administrativas, exportar ocorrências, reprocessar ocorrências e gerenciar regras de tarefa automática. A primeira permite acessar painéis. A segunda permite criar domínios, quesitos e resultados. A terceira permite ligar uma pergunta a um domínio e configurar quando ela gera ocorrência. A quarta permite abrir a lista de ocorrências. A quinta permite corrigir metadados em registros excepcionais, mantendo auditoria. A sexta permite exportar dados sensíveis. A sétima deve ser restrita porque pode alterar ou recriar dados derivados. A oitava controla integrações com tarefas.

No fluxo inicial, a implementação pode mapear essas permissões para o papel de manager do projeto de formulários e administradores do workspace. No entanto, os nomes das permissões devem ser planejados desde o início para evitar uma refatoração posterior.

## 5. Modelo de Dados: Cadastros

A primeira coleção sugerida é `form_analytics_domains`. Cada documento representa um domínio. Campos: `id`, `workspace_id`, `name`, `slug`, `description`, `color`, `icon`, `is_active`, `order`, `created_at`, `updated_at`, `created_by`, `updated_by`. O slug ajuda em filtros e exportações. A cor e o ícone ajudam na interface. O campo ativo permite desativar sem quebrar histórico.

A segunda coleção é `form_analytics_criteria`. Ela representa os quesitos. Campos: `id`, `workspace_id`, `domain_id`, `name`, `slug`, `description`, `default_severity`, `default_result_negative_id`, `default_result_positive_id`, `target_type`, `is_active`, `order`, `created_at`, `updated_at`, `created_by`, `updated_by`. O quesito deve estar ligado a um domínio. O `target_type` é opcional, mas ajuda a dizer que certos quesitos normalmente se aplicam a patrimônio, colaborador ou local.

A terceira coleção é `form_analytics_results`. Ela representa resultados padronizados. Campos: `id`, `workspace_id`, `name`, `slug`, `polarity`, `severity`, `counts_as_occurrence`, `counts_as_non_conformity`, `is_closing_result`, `color`, `is_active`, `order`, `created_at`, `updated_at`. O campo `polarity` pode ser `positive`, `negative`, `neutral` ou `corrective`. O campo `counts_as_occurrence` define se entra no volume de ocorrências. O campo `counts_as_non_conformity` alimenta indicadores de falha. O campo `is_closing_result` ajuda em análises de resolução.

A quarta coleção é `form_analytics_targets`. Ela representa alvos que não vêm de módulos existentes. Campos: `id`, `workspace_id`, `type`, `name`, `code`, `description`, `unit_ids`, `parent_id`, `metadata`, `is_active`, `created_at`, `updated_at`. Exemplos: Balcão X, Porta 09, Área de atendimento, Banheiro cliente, Freezer frontal sem cadastro patrimonial. Quando o alvo existir no Patrimônio, o sistema não deve duplicar nesse cadastro; deve buscar no módulo de patrimônio e gravar a referência na ocorrência.

A quinta coleção opcional é `form_analytics_target_groups`. Ela agrupa alvos. Exemplos: Balcões, Portas, Câmaras, Máquinas de sorvete, Áreas internas, Áreas externas. Isso ajuda filtros e relatórios, mas pode ficar para uma fase posterior.

## 6. Modelo de Dados: Configuração no Template

O tipo `FormTemplateItem` deve receber um campo opcional `analytics_config`. Como o item já tem `config`, `task_triggers`, `criticality`, `action_required`, `show_if` e `conditional_branches`, a configuração analítica deve ficar separada para não misturar regra de exibição com regra de métrica.

O formato sugerido é:

```ts
type FormItemAnalyticsConfig = {
  enabled: boolean;
  domain_id: string;
  criterion_id?: string;
  target_type: "asset" | "collaborator" | "unit" | "location" | "product" | "process" | "free_target";
  target_source: "fixed" | "execution_unit" | "answered_item" | "assigned_collaborator" | "selected_option" | "manual";
  fixed_target_id?: string;
  fixed_target_name?: string;
  target_item_id?: string;
  occurrence_mode: "single" | "per_selected_option" | "per_target";
  occurrence_condition: {
    operator: "always" | "equals" | "not_equals" | "contains" | "out_of_range" | "is_empty" | "is_not_empty";
    value?: unknown;
  };
  positive_result_id?: string;
  negative_result_id?: string;
  neutral_result_id?: string;
  severity?: "low" | "medium" | "high" | "critical";
  requires_description?: boolean;
  description_item_id?: string;
  evidence_item_ids?: string[];
  tags?: string[];
  create_task?: boolean;
  task_trigger_id?: string;
};
```

Esse formato permite mapear perguntas simples e perguntas complexas. Para uma pergunta Sim/Não, `occurrence_mode` pode ser `single`, `occurrence_condition` pode ser `equals false`, e o resultado negativo pode ser "Não conforme". Para uma pergunta de temperatura, a condição pode ser `out_of_range`. Para multi seleção de itens de uniforme, o modo pode ser `per_selected_option`, gerando uma ocorrência para cada opção selecionada. Para uma pergunta que pede selecionar um equipamento, `target_source` pode ser `answered_item`, apontando para o item que contém o equipamento.

Também será necessário permitir analytics por opção em perguntas `select` e `multi_select`. O `FormItemConfig` hoje tem `options?: string[]`. Para preservar compatibilidade, pode-se introduzir uma estrutura opcional `option_metadata`, sem quebrar formulários antigos. Exemplo:

```ts
type FormItemOptionAnalytics = {
  option: string;
  criterion_id?: string;
  target_id?: string;
  target_name?: string;
  result_id?: string;
  severity?: "low" | "medium" | "high" | "critical";
};
```

Se o sistema quiser evoluir melhor, o ideal será transformar opções de string em opções com id, label e metadados. Porém isso exige migração mais ampla. Para MVP, manter string e acrescentar metadados por valor é suficiente.

## 7. Modelo de Dados: Ocorrências

A coleção central deve ser `form_occurrences`. Cada documento representa uma ocorrência derivada de uma execução. Campos principais: `id`, `workspace_id`, `form_project_id`, `form_type_id`, `form_subtype_id`, `template_id`, `template_version`, `form_version_id`, `execution_id`, `execution_status`, `execution_completed_at`, `unit_id`, `unit_name`, `section_id`, `section_title`, `template_item_id`, `execution_item_id`, `item_title`, `domain_id`, `domain_name`, `criterion_id`, `criterion_name`, `target_type`, `target_id`, `target_name`, `target_code`, `target_metadata`, `result_id`, `result_name`, `result_polarity`, `severity`, `answer_value`, `answer_label`, `description`, `evidence_refs`, `created_from`, `created_at`, `updated_at`, `resolved_at`, `resolved_by`, `linked_task_id`, `is_active`, `dedupe_key`.

O campo `dedupe_key` é importante para idempotência. A geração pode rodar mais de uma vez ao salvar, concluir, reabrir ou reprocessar. O sistema não deve duplicar ocorrências. Uma chave previsível pode combinar `workspace_id`, `execution_id`, `execution_item_id`, `domain_id`, `criterion_id`, `target_type`, `target_id` e, quando for por opção, o valor da opção. Para um item multi seleção, cada opção vira uma ocorrência com dedupe diferente.

O campo `is_active` resolve reprocessamento e reabertura. Se uma execução completada gerou ocorrência e depois foi reaberta e corrigida, a ocorrência antiga pode ser marcada como inativa ou substituída. A decisão recomendada: manter histórico com `is_active=false` e `superseded_by_occurrence_id`, quando houver nova ocorrência. Para MVP, é aceitável apagar e recriar ocorrências derivadas de uma execução enquanto ela não está finalizada, mas após conclusão e auditoria é melhor preservar alterações.

O campo `created_from` pode ser `form_execution`, `manual_adjustment`, `reprocess` ou `migration`. Isso ajuda auditoria. A ocorrência deve sempre apontar para a execução original para o gestor conseguir abrir o formulário preenchido.

## 8. Adaptação aos Tipos de Pergunta Existentes

O tipo `yes_no` é o mais importante para conformidade. Ele deve permitir gerar resultado positivo quando a resposta for Sim, resultado negativo quando for Não, ou gerar ocorrência apenas no Não. Exemplo: "Uniforme completo?" com Sim gera nada ou gera uma ocorrência positiva agregada; Não abre perguntas condicionais e gera ocorrências por item problemático. Exemplo: "Porta 09 está funcionando?" com Não gera domínio Manutenção, alvo Porta 09, quesito Funcionamento, resultado Manutenção necessária.

O tipo `checkbox` pode representar confirmação. Se marcado, pode ser conforme. Se não marcado, pode gerar não conformidade quando obrigatório. Exemplo: "Marca como conferido" normalmente não deve gerar ocorrência, mas pode alimentar score. Para analytics, deve haver opção de gerar ocorrência apenas quando estiver falso ou vazio.

O tipo `number` deve permitir regras numéricas. Exemplo: "Quantidade de ocorrências visíveis", "nível de estoque", "pressão", "peso". A condição pode ser maior que, menor que, fora de faixa, igual a zero ou não preenchido. O resultado deve ser configurado por regra. Para MVP, aproveitar `reference_value` e `tolerance_percent` quando existir, gerando ocorrência se `is_out_of_range=true`.

O tipo `temperature` já tem semântica forte. Deve gerar ocorrência quando fora da faixa, e pode registrar o valor medido em `answer_value`. O alvo pode ser fixo, como "Câmara fria 01", ou selecionado em pergunta anterior, como "Equipamento". O quesito pode ser Temperatura. O resultado pode ser Fora da faixa, Crítico ou Conforme.

O tipo `select` deve mapear opções para resultado. Exemplo: "Estado do balcão" com opções Limpo, Sujo, Organizado, Danificado. Cada opção pode ter polarity e resultado. Para MVP, o template pode configurar uma condição simples: se opção contém "Sujo", gera ocorrência. Em fase posterior, cada opção deve ter metadados.

O tipo `multi_select` é o tipo central para casos como uniforme, áreas verificadas, itens de limpeza e equipamentos com problema. Ele deve permitir `occurrence_mode: per_selected_option`. Cada item selecionado vira uma ocorrência. Se a pergunta for "Quais itens do uniforme estão com problema?", as opções Touca, Camisa, Calça e Sapato viram quesitos ou subquesitos. A descrição pode vir de uma pergunta textual condicionada ao item ou de um campo de detalhe por opção.

O tipo `text` deve ser usado como complemento, não como métrica principal. Texto livre é ruim para analytics. Ele deve alimentar `description`, observação, causa provável ou ação tomada. Se o usuário quiser contar ocorrências por texto, a resposta será inconsistente. Portanto, perguntas de texto só devem gerar ocorrência diretamente em casos raros, como "Descreva a não conformidade encontrada" associada a uma pergunta anterior que já estruturou domínio, alvo e quesito.

O tipo `photo` deve alimentar evidência. A foto não precisa gerar ocorrência sozinha. Ela pode ser obrigatória quando a ocorrência for negativa. Exemplo: se "Uniforme completo?" for Não, exigir foto ou descrição. A ocorrência deve referenciar `photo_urls`.

O tipo `signature` deve registrar confirmação, aprovação ou encerramento. Não deve ser usado como quesito analítico, exceto para saber se uma ocorrência foi validada por responsável.

O tipo `date` pode alimentar prazo, vencimento, data observada ou data de manutenção. Ele também pode servir como campo auxiliar da ocorrência.

O tipo `file_upload` deve alimentar evidências ou documentos anexos.

O tipo `location` pode ser usado como evidência ou para mapear local geográfico, especialmente em operações externas.

## 9. Exemplo Completo: Uniforme

O cenário desejado é: se "Uniforme completo?" for Sim, finaliza; se for Não, abre opções com itens do uniforme; o auditor seleciona os itens com problema e descreve, em cada um, qual é o problema.

No template, a seção pode ter a pergunta 1: "Uniforme completo?" do tipo `yes_no`. Ela tem analytics opcional. Pode gerar ocorrência positiva com domínio Uniforme, alvo Colaborador, quesito Uniforme completo, resultado Conforme quando Sim. Para reduzir ruído, o MVP pode não gerar ocorrência positiva e deixar apenas a execução compor taxa de conformidade. Quando a resposta for Não, a pergunta aciona uma ramificação condicional.

A pergunta 2 aparece apenas se a pergunta 1 for Não: "Quais itens estão com problema?" do tipo `multi_select`. Opções: Camisa, Calça, Avental, Touca, Sapato, Crachá. Essa pergunta tem `analytics_config.enabled=true`, domínio Uniforme, alvo Colaborador, `target_source=assigned_collaborator` ou `target_source=answered_item` se o colaborador for escolhido em uma pergunta anterior. O modo é `per_selected_option`. Cada opção selecionada mapeia para um quesito. Camisa mapeia para quesito Camisa. Touca mapeia para quesito Touca. Sapato mapeia para quesito Sapato. O resultado é Não conforme. A gravidade pode ser Média por padrão, com opção Crítica para itens obrigatórios.

A pergunta 3 pode ser "Descreva o problema" do tipo `text`. Ela aparece se houver qualquer item selecionado. Para conseguir descrição por item, existem duas opções. A opção simples é um único campo textual: o auditor escreve "Touca ausente; camisa suja". Isso é rápido, mas menos estruturado. A opção melhor é criar uma interface de detalhe por opção, ainda persistindo como respostas do formulário: para cada opção selecionada, abrir um campo "Qual problema em Camisa?", "Qual problema em Touca?". Isso exige evolução do renderer, mas entrega melhor analytics.

Para MVP, recomenda-se começar com um campo textual único e gerar uma ocorrência por item selecionado, copiando a mesma descrição para todas. Em uma fase posterior, implementar detalhes por opção com estrutura `multi_option_details`, por exemplo `{ option: "Touca", description: "Ausente", severity: "high" }`.

A ocorrência gerada para Touca teria: domínio Uniforme, alvo Colaborador João, quesito Touca, resultado Não conforme, descrição "Touca ausente", execução X, pergunta Y, unidade Z, evidência foto A. Assim a análise pode responder: quantas ocorrências de Touca ocorreram no último mês; quais colaboradores reincidiram; quais unidades têm mais falhas de uniforme; qual item do uniforme mais falha.

## 10. Exemplo Completo: Manutenção

Para manutenção, existem dois casos. O primeiro é quando o equipamento já existe no módulo de patrimônio. Nesse caso, o formulário deve ter uma pergunta de seleção de patrimônio ou uma aplicação vinculada a um patrimônio. O alvo da ocorrência será `target_type=asset`, `target_id` igual ao id do patrimônio, `target_name` igual ao nome do equipamento, e `target_metadata` com marca, modelo, número de série, categoria e unidade, copiados no momento da ocorrência.

O segundo caso é quando o item ainda não existe no patrimônio, como Porta 09, Balcão X ou área específica. Nesse caso, o alvo deve vir de `form_analytics_targets`, com tipo `location` ou `free_target`. Assim, "Porta 09" deixa de ser texto solto e vira um alvo controlado.

Um formulário de manutenção pode ter: "Qual item apresentou problema?" do tipo select, "Qual o problema?" do tipo multi_select, "Descreva a ocorrência" do tipo text, "Foto" do tipo photo. A pergunta "Qual item apresentou problema?" define o alvo. A pergunta "Qual o problema?" gera ocorrências por opção: Borracha, Fechadura, Ruído, Vazamento, Sensor, Motor. A descrição e a foto entram como evidência.

Para responder "quantas manutenções na porta 09 nos últimos 6 meses?", a consulta filtra `domain_id=Manutenção`, `target_id=Porta 09`, `created_at` nos últimos seis meses e `result_polarity=negative` ou `counts_as_occurrence=true`. Para responder "qual marca dá mais manutenção?", a consulta agrupa ocorrências de `target_type=asset` por `target_metadata.brand`.

## 11. Exemplo Completo: Limpeza

Limpeza normalmente envolve local, superfície e condição. O alvo pode ser Balcão X, Banheiro cliente, Câmara fria, Piso do salão, Área de produção ou Loja inteira. O quesito pode ser Superfície limpa, Lixeira, Resíduo aparente, Organização, Odor, Vidro, Equipamento limpo.

Um formulário pode perguntar: "Área auditada" com select vindo de alvos cadastrados; "Condição da área" com yes_no ou select; "Problemas encontrados" com multi_select; "Evidência fotográfica" com photo. Se a pergunta "Área auditada" seleciona Balcão X e "Problemas encontrados" seleciona Resíduo aparente e Superfície pegajosa, o sistema gera duas ocorrências: uma para o quesito Resíduo aparente e outra para Superfície pegajosa, ambas com alvo Balcão X.

Para responder "quantas ocorrências aconteceram sobre limpeza no balcão X?", o dashboard filtra domínio Limpeza, alvo Balcão X e período. Para responder "qual quesito de limpeza mais reincide?", agrupa por `criterion_id`.

## 12. UX de Cadastro de Domínios, Quesitos e Resultados

Deve existir uma tela administrativa chamada "Taxonomia de analytics" ou "Classificações". Ela pode ficar dentro de Formulários, em uma aba de configurações, visível apenas para usuários com permissão. A tela deve ter três listas principais: Domínios, Quesitos e Resultados. Em uma segunda fase, incluir Alvos operacionais.

No cadastro de domínio, campos editáveis: nome, descrição, ícone, cor, ordem e ativo. O sistema gera slug automaticamente. O usuário pode editar nome e descrição, mas alterações devem preservar ids para manter histórico.

No cadastro de quesito, campos editáveis: domínio, nome, descrição, tipo de alvo recomendado, gravidade padrão, resultado positivo padrão, resultado negativo padrão, ordem e ativo. O sistema deve impedir apagar quesitos usados em ocorrências; deve permitir desativar.

No cadastro de resultado, campos editáveis: nome, descrição, polaridade, gravidade padrão, cor, se conta como ocorrência, se conta como não conformidade, se é resultado de encerramento e ativo. Isso permite que cada empresa use termos próprios sem quebrar métricas.

No cadastro de alvo operacional, campos editáveis: tipo, nome, código, descrição, unidades aplicáveis, grupo, metadados e ativo. Quando o alvo vier de Patrimônio ou Colaborador, não deve ser editado aqui; a tela deve apenas permitir selecionar e visualizar vínculos.

## 13. UX de Configuração no Builder de Formulários

No editor dedicado do modelo/template, cada pergunta deve ganhar um painel recolhível chamado "Analytics e ocorrências". Esse painel não deve aparecer como texto dentro da execução. Ele é configuração administrativa.

Campos do painel: "Gerar métrica para esta pergunta", "Domínio", "Quesito", "Tipo de alvo", "Origem do alvo", "Condição para gerar ocorrência", "Resultado quando conforme", "Resultado quando não conforme", "Gravidade", "Descrição vem de qual pergunta", "Evidências vêm de quais perguntas", "Gerar tarefa", "Regra de tarefa" e "Tags".

A interface deve adaptar campos ao tipo da pergunta. Para `yes_no`, mostrar respostas Sim e Não com resultados configuráveis. Para `temperature` e `number`, mostrar regra de faixa. Para `multi_select`, mostrar tabela de opções, cada uma com quesito, resultado e gravidade. Para `photo`, mostrar apenas uso como evidência. Para `text`, avisar discretamente que texto é melhor como descrição de ocorrência, não como métrica principal.

Quando o usuário escolhe domínio, o seletor de quesito deve filtrar quesitos daquele domínio. Quando escolhe tipo de alvo Patrimônio, a origem do alvo deve permitir "selecionado em outra pergunta", "fixo no template" ou "contexto da aplicação". Quando escolhe Colaborador, a origem pode ser "colaborador atribuído", "selecionado em pergunta" ou "usuário executor".

O builder deve validar antes de publicar: se analytics está ativo, domínio é obrigatório; se a condição pode gerar ocorrência negativa, resultado negativo é obrigatório; se o alvo não for unitário, origem do alvo é obrigatória; se o modo for por opção, cada opção precisa de quesito ou herdar quesito principal; se a descrição for obrigatória, o item referenciado precisa existir e estar visível na mesma condição.

## 14. Fluxo de Execução e Geração

A geração de ocorrências deve acontecer no backend, não no frontend. O frontend envia respostas. A rota de atualização da execução já normaliza respostas e calcula score. Após aplicar respostas e antes ou depois de salvar o status final, um serviço deve avaliar as configurações analíticas dos itens visíveis.

O serviço sugerido é `generateOccurrencesForExecution`. Entradas: execução atualizada, template snapshot, usuário, modo de execução (`save`, `complete`, `reprocess`). Saída: ocorrências criadas, atualizadas, desativadas e eventuais tarefas geradas. Esse serviço deve ficar em `src/features/forms/lib/analytics.ts` ou pasta equivalente, para não inflar a rota.

O serviço deve percorrer os itens da execução, localizar `analytics_config`, validar visibilidade pelo mesmo mecanismo de `show_if`, obter resposta normalizada, avaliar condição, resolver domínio, quesito, alvo, resultado, gravidade, descrição e evidência. Em seguida, deve montar `dedupe_key` e gravar no Firestore.

No `save`, existem duas opções. A primeira é gerar ocorrências provisórias, o que dá dashboards em tempo real, mas exige cuidar de rascunhos. A segunda é gerar apenas no `complete`, mais simples e confiável. Recomenda-se para MVP gerar apenas ao concluir. Em fase posterior, pode gerar prévias internas durante rascunho.

No `reopen`, o sistema deve marcar ocorrências ativas daquela execução como `is_active=false` ou `status=reopened`. Ao completar novamente, deve gerar novas ocorrências. Isso evita que uma não conformidade corrigida dentro da própria execução continue contando como ocorrência final.

No `cancel`, ocorrências ativas devem ser desativadas ou marcadas como canceladas, conforme regra de auditoria. Para MVP, execuções canceladas não devem alimentar analytics.

## 15. Integração com Tarefas

O módulo já possui `task_triggers` e criação de tarefa a partir de itens. A implementação de analytics deve reaproveitar isso. Não vale criar um segundo mecanismo de tarefa se o atual atende. A configuração analítica pode apontar para um `task_trigger_id` existente ou usar `create_task=true` para acionar o trigger vinculado ao item.

A diferença entre ocorrência e tarefa precisa ficar clara. Ocorrência é dado analítico. Tarefa é ação operacional. Uma ocorrência pode não gerar tarefa. Uma tarefa pode resolver uma ocorrência. Quando uma tarefa for criada, a ocorrência deve armazenar `linked_task_id` e talvez `linked_task_status`. Quando a tarefa for concluída, o sistema pode atualizar a ocorrência como resolvida em fase posterior.

Para exemplos: uniforme incompleto pode gerar ocorrência sem tarefa se o gestor só quer medir. Temperatura crítica pode gerar tarefa imediata. Porta 09 quebrada pode gerar tarefa de manutenção com SLA. Limpeza pendente no balcão pode gerar tarefa para a equipe da unidade.

## 16. Consultas e Dashboards

Os dashboards devem consultar `form_occurrences`, não interpretar respostas brutas a cada carregamento. Isso reduz custo, melhora performance e dá consistência. As respostas brutas continuam disponíveis para auditoria, mas analytics usa registros derivados.

Filtros mínimos: período, domínio, quesito, resultado, polaridade, gravidade, unidade, projeto, subprojeto, formulário, modelo, alvo, tipo de alvo, colaborador, patrimônio, marca, executor e status da tarefa. Filtros avançados podem incluir tags, turno, recorrência, versão do template e origem.

Métricas iniciais: total de ocorrências, não conformidades, taxa de conformidade, ocorrências por domínio, ocorrências por quesito, ranking de alvos, ranking de unidades, ranking de colaboradores, reincidência por alvo, tempo médio até conclusão da tarefa, ocorrências críticas abertas e evolução por mês.

Para manutenção, relatórios úteis: equipamentos com mais ocorrências, marcas com mais ocorrências, categoria de patrimônio com mais ocorrência, unidades com mais manutenção, tipos de problema mais frequentes, reincidência em 30/90/180 dias e ocorrências sem tarefa resolvida.

Para limpeza, relatórios úteis: áreas com mais problemas, quesitos mais reincidentes, unidades com maior volume, horários críticos e comparação por auditoria.

Para uniforme, relatórios úteis: itens com mais problema, colaboradores reincidentes, unidades com mais falhas, evolução mensal, ocorrências por função ou escala quando houver vínculo com RH.

## 17. Índices e Performance

Firestore exige planejamento de índices. Consultas por período e workspace são obrigatórias. Índices iniciais sugeridos para `form_occurrences`: `workspace_id + is_active + created_at`, `workspace_id + domain_id + created_at`, `workspace_id + target_type + target_id + created_at`, `workspace_id + unit_id + created_at`, `workspace_id + result_polarity + created_at`, `workspace_id + severity + created_at`, `workspace_id + form_project_id + created_at`, `workspace_id + criterion_id + created_at`.

Para relatórios de marca, se a marca vier em `target_metadata.brand`, o Firestore não agrupa nativamente. Existem duas opções: fazer agregação no servidor após consultar período limitado, ou manter campos denormalizados como `target_brand`, `target_category`, `target_model`. Recomenda-se denormalizar os campos mais consultados: marca, categoria, modelo, código patrimonial e colaborador.

Para dashboards muito usados, criar coleções agregadas diárias em fase posterior. Exemplo: `form_occurrence_daily_metrics` com chave por workspace, data, domínio, quesito, unidade e alvo. O MVP pode consultar ocorrências diretamente, limitando período e paginação.

## 18. Migração e Compatibilidade

A implementação deve ser compatível com formulários existentes. `analytics_config` é opcional. Templates sem configuração continuam funcionando. Execuções antigas não geram ocorrências até haver reprocessamento.

Primeira migração: adicionar tipos TypeScript e schemas Zod opcionais. Segunda: criar APIs e telas de taxonomia. Terceira: permitir salvar `analytics_config` nos templates/modelos. Quarta: implementar gerador de ocorrências para novas execuções concluídas. Quinta: oferecer reprocessamento manual de execuções antigas para templates já configurados.

Reprocessamento histórico deve ser explícito. O usuário escolhe projeto, formulário, período e versão. O sistema simula quantas ocorrências serão criadas, depois executa. Cada ocorrência criada por reprocessamento recebe `created_from=reprocess`.

Não é recomendado tentar inferir analytics automaticamente de todos os textos antigos. Isso geraria dados inconsistentes. O máximo aceitável é mapear templates importantes e reprocessar respostas estruturadas.

## 19. APIs e Serviços

APIs sugeridas: `GET/POST /api/forms/analytics/domains`, `PATCH/DELETE /api/forms/analytics/domains/[domainId]`, equivalentes para criteria, results e targets. Para ocorrências: `GET /api/forms/analytics/occurrences`, `GET /api/forms/analytics/summary`, `POST /api/forms/analytics/reprocess`.

Serviços sugeridos: `listAnalyticsDomains`, `createAnalyticsDomain`, `updateAnalyticsDomain`, `listAnalyticsCriteria`, `listAnalyticsResults`, `listAnalyticsTargets`, `generateOccurrencesForExecution`, `resolveOccurrenceTarget`, `evaluateOccurrenceCondition`, `buildOccurrenceDedupeKey`, `summarizeOccurrences`.

Schemas Zod devem validar todos os cadastros e `analytics_config`. O schema de template deve aceitar o novo campo opcional. A validação de publicação deve ser mais rígida do que a validação de rascunho.

## 20. Testes

Testes unitários devem cobrir avaliação de condição, resolução de alvo, geração por opção, idempotência por `dedupe_key`, desativação em reopen/cancel, mapeamento por tipo de pergunta e cópia de evidências.

Testes de API devem cobrir permissões, criação de domínio, criação de quesito, bloqueio de exclusão quando usado, listagem por workspace, isolamento entre workspaces e validação de payload inválido.

Testes de UI devem cobrir cadastro de domínio, configuração de pergunta no builder, validação de publicação e execução de um formulário com pergunta condicional.

Testes end-to-end devem cobrir pelo menos três cenários: uniforme incompleto gerando múltiplas ocorrências; temperatura fora da faixa gerando ocorrência e tarefa; manutenção em patrimônio gerando ocorrência com marca denormalizada.

## 21. Fases de Implementação

Fase 1: fundação de dados. Criar tipos, schemas, coleções, APIs CRUD de domínios, quesitos, resultados e alvos livres. Criar tela administrativa simples. Sem mexer no fluxo de execução ainda.

Fase 2: configuração no builder. Adicionar `analytics_config` ao item do template e do modelo. Criar painel "Analytics e ocorrências" no editor. Validar regras por tipo de pergunta. Salvar e carregar configurações.

Fase 3: geração de ocorrências. Criar serviço backend, integrar na conclusão da execução, gerar ocorrências idempotentes, desativar em reopen/cancel, referenciar evidências e vincular tarefas quando configurado.

Fase 4: dashboards e consultas. Criar lista de ocorrências, filtros, cards de resumo e rankings. Começar com consultas diretas em `form_occurrences`. Adicionar exportação se necessário.

Fase 5: integrações avançadas. Integrar melhor com Patrimônio, RH, colaboradores, tarefas e agregações diárias. Criar reprocessamento histórico. Adicionar detalhes por opção para multi seleção.

## 22. Critérios de Aceite

Um usuário com permissão consegue cadastrar Domínio, Quesito e Resultado. Um gestor consegue configurar uma pergunta existente para gerar analytics. Um auditor consegue preencher o formulário sem ver complexidade técnica. Ao concluir a execução, o sistema gera uma ou mais ocorrências estruturadas. O dashboard consegue responder por período, domínio, alvo e quesito. Uma pergunta de uniforme com múltiplos itens selecionados gera uma ocorrência por item. Uma pergunta de manutenção vinculada a patrimônio grava marca e modelo no registro. Reabrir e concluir novamente não duplica ocorrências. Cancelar execução remove a ocorrência dos indicadores ativos.

Com essa implementação, o formulário deixa de ser apenas checklist e passa a ser uma camada de captura operacional estruturada. A empresa continua livre para criar seus modelos, mas os dados passam a responder perguntas gerenciais sem depender de texto livre, interpretação manual ou planilhas paralelas.
