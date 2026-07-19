# Dicionário de variáveis para documentos de RH

Versão do contrato: `coala-documents-v1`

Este documento define o padrão de preenchimento dos modelos de documentos da Gestão do Colaborador. A chave interna do campo é o identificador canônico. O rótulo mostrado na interface pode mudar sem quebrar modelos já cadastrados.

## Sintaxe do modelo

Use a chave canônica entre chaves duplas:

```text
{{employee.name}}
{{employee.cpf}}
{{employee.birth_date}}
```

Regras:

- as chaves usam letras minúsculas, pontos e `_`, sem espaços ou acentos;
- o gerador substitui somente o placeholder e preserva o estilo aplicado no modelo;
- valores inexistentes resultam em texto vazio;
- `null`, `undefined`, `[object Object]` e valores técnicos nunca devem aparecer no documento;
- o modelo deve registrar a versão do contrato de variáveis com a qual foi criado;
- os rótulos visuais não podem ser usados como identificadores de preenchimento.

## Formatação no Word

Negrito, itálico, sublinhado, cor, fonte, tamanho e realce são definidos diretamente no arquivo Word. Formate o placeholder inteiro como deseja que o valor final apareça.

Exemplo: para o nome sair em negrito, escreva `{{employee.name}}` no Word, selecione o placeholder completo e aplique **negrito**. O gerador deve trocar o texto preservando a formatação daquele trecho.

O mesmo princípio vale para:

- alinhamento, recuo, espaçamento e estilo do parágrafo;
- listas com marcadores ou numeração;
- conteúdo dentro de tabelas, cabeçalhos e rodapés;
- fonte, tamanho, cor e caixa alta configurados no Word.

Requisitos para o gerador DOCX:

1. Reconhecer placeholders mesmo quando o Word dividir o texto em vários `runs` XML.
2. Preservar as propriedades de formatação do primeiro `run` do placeholder ao inserir o valor.
3. Preservar o estilo do parágrafo, da célula, do cabeçalho ou do rodapé que contém o placeholder.
4. Converter quebras de linha de campos multilinha em quebras compatíveis com DOCX.
5. Não interpretar HTML dentro de campos comuns.

Para a primeira versão, um único valor deve possuir uma única formatação. Trechos diferentes do mesmo valor com estilos diferentes ficam reservados para um futuro tipo `rich_text`.

## Conversões obrigatórias

| Tipo do campo | Saída padrão | Exemplo |
|---|---|---|
| `text` | Texto sem alteração estrutural | `Maria da Silva` |
| `date` | `dd/MM/yyyy` | `17/07/2026` |
| `currency` | Real brasileiro | `R$ 8,40` |
| `number` | Número em `pt-BR` | `1.250` |
| `boolean` | `Sim` ou `Não` | `Sim` |
| `single_select` | Rótulo da opção | `Casado(a)` |
| `multi_select` | Opções separadas por vírgula | `A, B` |
| `multiline` | Texto com quebras de linha preservadas | — |
| `ref:*` | Rótulo resolvido, nunca o ID interno | `Atendente` |

CPF, telefone, CEP, PIS e outros documentos devem ser exibidos com máscara quando o valor puder ser normalizado com segurança. Caso contrário, o valor original deve ser preservado.

## Campos cadastrais

### Dados pessoais

| Placeholder | Nome no sistema | Tipo |
|---|---|---|
| `{{employee.name}}` | Nome completo | `text` |
| `{{employee.state}}` | Estado (UF) | `single_select` |
| `{{employee.city}}` | Cidade | `text` |
| `{{employee.address}}` | Endereço | `text` |
| `{{employee.phone}}` | Telefone celular | `text` |
| `{{employee.personal_email}}` | E-mail pessoal | `text` |
| `{{employee.nationality}}` | Nacionalidade | `text` |
| `{{employee.birth_date}}` | Data de nascimento | `date` |
| `{{employee.marital_status}}` | Estado civil | `single_select` |
| `{{employee.mother_name}}` | Nome da mãe | `text` |
| `{{employee.father_name}}` | Nome do pai | `text` |
| `{{employee.children_under_14}}` | Filhos menores de 14 anos | `single_select` |

### Documentos

| Placeholder | Nome no sistema | Tipo |
|---|---|---|
| `{{employee.cpf}}` | CPF | `text` |
| `{{employee.pis}}` | PIS | `text` |
| `{{employee.ctps_number}}` | CTPS — Número | `text` |
| `{{employee.ctps_series}}` | CTPS — Série | `text` |
| `{{employee.ctps_date}}` | CTPS — Data de emissão | `date` |
| `{{employee.has_cnh}}` | Possui CNH? | `boolean` |
| `{{employee.cnh_number}}` | CNH — Número | `text` |
| `{{employee.cnh_type}}` | CNH — Tipo | `multi_select` |
| `{{employee.cnh_expiry}}` | CNH — Validade | `date` |
| `{{employee.cnh_first_date}}` | 1ª habilitação | `date` |

### Dados contratuais

| Placeholder | Nome no sistema | Tipo |
|---|---|---|
| `{{employee.employer_cnpj}}` | CNPJ do empregador | `text` |
| `{{employee.employer_name}}` | Razão social | `single_select` |
| `{{employee.job_role_id}}` | Cargo/Função | `ref:jobRoles` |
| `{{employee.probation_eval_1}}` | Experiência — 1ª avaliação | `date` |
| `{{employee.probation_eval_2}}` | Experiência — 2ª avaliação | `date` |

### Benefícios

| Placeholder | Nome no sistema | Tipo |
|---|---|---|
| `{{employee.has_vt}}` | Tem VT? | `boolean` |
| `{{employee.vt_daily_value}}` | Valor do VT diário | `currency` |
| `{{employee.vt_notes}}` | Observação sobre VT | `multiline` |
| `{{employee.has_va_vr}}` | Tem VA/VR? | `boolean` |
| `{{employee.va_vr_daily_value}}` | Valor do VA/VR | `currency` |
| `{{employee.has_health_plan}}` | Convênio médico? | `boolean` |
| `{{employee.has_dental_plan}}` | Convênio odontológico? | `boolean` |

### Formação acadêmica

| Placeholder | Nome no sistema | Tipo |
|---|---|---|
| `{{employee.education_level}}` | Grau de instrução | `single_select` |
| `{{employee.education_course}}` | Curso | `text` |
| `{{employee.education_institution}}` | Instituição | `text` |
| `{{employee.education_end_date}}` | Data de conclusão | `date` |

### Inclusão e diversidade

| Placeholder | Nome no sistema | Tipo |
|---|---|---|
| `{{employee.gender_identity}}` | Identidade de gênero | `single_select` |
| `{{employee.sexual_orientation}}` | Orientação sexual | `single_select` |
| `{{employee.is_pcd}}` | É PCD? | `boolean` |
| `{{employee.disability}}` | Deficiência | `multi_select` |
| `{{employee.ethnicity}}` | Etnia | `single_select` |

Esses campos são dados pessoais sensíveis. O gerador deve validar a permissão do usuário e a finalidade do documento antes de disponibilizá-los.

### Contatos de emergência

| Placeholder | Nome no sistema | Tipo |
|---|---|---|
| `{{employee.emergency_name}}` | Nome | `text` |
| `{{employee.emergency_phone}}` | Celular com DDD | `text` |
| `{{employee.emergency_relation}}` | Grau de parentesco | `single_select` |

### Saúde e segurança

| Placeholder | Nome no sistema | Tipo |
|---|---|---|
| `{{employee.has_food_restriction}}` | Possui restrição alimentar relevante à atividade? | `boolean` |
| `{{employee.food_restrictions}}` | Ingredientes relacionados à restrição | `multi_select` |
| `{{employee.food_restriction_other}}` | Outro ingrediente | `text` |
| `{{employee.food_restriction_activity_effects}}` | Impacto da restrição na atividade | `multi_select` |
| `{{employee.needs_workplace_adaptation}}` | Necessita de adaptação funcional? | `boolean` |
| `{{employee.workplace_adaptation_notes}}` | Orientação funcional de SST | `multiline` |

Esses campos também exigem controle de acesso por conterem dados sensíveis de saúde.

### Dados bancários

| Placeholder | Nome no sistema | Tipo |
|---|---|---|
| `{{employee.bank_name}}` | Banco | `single_select` |
| `{{employee.bank_agency}}` | Agência | `text` |
| `{{employee.bank_account}}` | Conta corrente | `text` |
| `{{employee.pix_key}}` | Chave Pix | `text` |

### Controle de ASOs

| Placeholder | Nome no sistema | Tipo |
|---|---|---|
| `{{employee.aso_admission_date}}` | Exame admissional | `date` |
| `{{employee.aso_dismissal_date}}` | Exame demissional | `date` |
| `{{employee.aso_periodic_1}}` | Exame periódico 1 | `date` |
| `{{employee.aso_periodic_2}}` | Exame periódico 2 | `date` |

### Salário-família

| Placeholder | Nome no sistema | Tipo |
|---|---|---|
| `{{employee.children}}` | Cadastro de filhos | `repeatable` |
| `{{employee.has_family_salary}}` | Tem salário-família? | `boolean` |

`employee.children` não deve ser impresso como texto bruto. Deve ser usado como uma coleção repetível:

```text
{{#employee.children}}
Nome: {{name}}
CPF: {{cpf}}
Data de nascimento: {{birth_date}}
{{/employee.children}}
```

O contrato interno de cada filho deve ser estabilizado antes da implementação do gerador. A proposta inicial é `name`, `cpf`, `birth_date` e `relation`.

### Uniformes

| Placeholder | Nome no sistema | Tipo |
|---|---|---|
| `{{employee.uniform_shirt_size}}` | Tamanho de camisa | `single_select` |
| `{{employee.uniform_pants_size}}` | Tamanho da calça | `single_select` |
| `{{employee.uniform_shoe_size}}` | Numeração do calçado | `single_select` |
| `{{employee.uniform_shirt_qty}}` | Camisa — Quantidade entregue | `number` |
| `{{employee.uniform_apron_qty}}` | Avental — Quantidade entregue | `number` |
| `{{employee.uniform_sash_qty}}` | Faixa — Quantidade entregue | `number` |
| `{{employee.uniform_cap_qty}}` | Boné — Quantidade entregue | `number` |
| `{{employee.uniform_last_delivery}}` | Data da última entrega | `date` |

## Campos automáticos do sistema

Estes valores não devem ser procurados diretamente na coleção de valores complementares. O resolvedor do gerador deve obtê-los dos cadastros operacionais correspondentes.

| Placeholder | Nome no sistema | Tipo/resolução |
|---|---|---|
| `{{system.documents.registration_bizneo}}` | Matrícula Bizneo | `text` |
| `{{system.documents.registration_pdv}}` | Matrícula PDV | `text` |
| `{{system.documents.email}}` | E-mail de acesso | `text` |
| `{{system.documents.access_profile}}` | Perfil de acesso | rótulo do perfil |
| `{{system.role.job_role}}` | Cargo | rótulo do cargo |
| `{{system.role.operational}}` | Operacional | `boolean` |
| `{{system.role.goals}}` | Metas | `boolean` |
| `{{system.role.functions}}` | Funções | lista de rótulos |
| `{{system.schedule.shift}}` | Escala | rótulo da escala |
| `{{system.schedule.units}}` | Unidades | lista de rótulos |
| `{{system.uniforms.summary}}` | Uniformes | resumo calculado |
| `{{system.vacations.summary}}` | Férias | resumo calculado |
| `{{system.aso.summary}}` | Resumo de ASOs | resumo calculado |
| `{{system.family_salary.summary}}` | Resumo do salário-família | resumo calculado |
| `{{system.transport_voucher.enabled}}` | Vale-transporte | `boolean` |
| `{{system.behavior.operational}}` | Usuário operacional | `boolean` |
| `{{system.behavior.goals}}` | Participa de metas | `boolean` |

## Condicionais

A sintaxe proposta para exibir um trecho somente quando uma variável for verdadeira ou estiver preenchida é:

```text
{{#if employee.has_vt}}
O colaborador recebe vale-transporte no valor diário de {{employee.vt_daily_value}}.
{{/if}}
```

Para a versão inicial, recomenda-se suportar apenas:

- variável booleana igual a `true`;
- campo textual, monetário ou de data preenchido;
- negação com `{{#unless variável}}...{{/unless}}`;
- repetição de coleções com `{{#coleção}}...{{/coleção}}`.

## Valores calculados recomendados

Estes campos ainda não fazem parte dos 87 campos atuais, mas são úteis em praticamente todos os documentos e devem ser adicionados como variáveis somente de leitura:

| Placeholder proposto | Conteúdo |
|---|---|
| `{{document.generated_at}}` | Data e hora da geração |
| `{{document.generated_date}}` | Data da geração |
| `{{document.template_name}}` | Nome do modelo usado |
| `{{document.template_version}}` | Versão do modelo |
| `{{employee.first_name}}` | Primeiro nome do colaborador |
| `{{employee.age}}` | Idade calculada na data de geração |
| `{{employee.cnh_categories}}` | Categorias da CNH formatadas |
| `{{company.legal_name}}` | Razão social resolvida |
| `{{company.cnpj}}` | CNPJ resolvido e formatado |

Essas propostas não devem ser usadas em modelos de produção até entrarem no catálogo implementado.

## Contrato sugerido para `variables`

O campo `variables` de cada modelo deve armazenar as variáveis detectadas no arquivo e um retrato do contrato usado na publicação:

```json
{
  "schemaVersion": "coala-documents-v1",
  "variables": [
    {
      "key": "employee.name",
      "type": "text",
      "required": true
    },
    {
      "key": "employee.birth_date",
      "type": "date",
      "required": false
    }
  ]
}
```

Na publicação do modelo, o sistema deve bloquear placeholders desconhecidos e avisar sobre campos obrigatórios ausentes no cadastro do colaborador.

## Ordem de resolução dos dados

Quando existirem informações equivalentes em mais de uma fonte, o gerador deve usar esta prioridade:

1. campo automático oficial do cadastro operacional, quando o placeholder começa com `system.`;
2. valor complementar atual do perfil, quando o placeholder começa com `employee.`;
3. fallback explicitamente mapeado no catálogo;
4. texto vazio.

Não deve haver fallback implícito entre campos parecidos. Por exemplo, `employee.has_vt` e `system.transport_voucher.enabled` são variáveis distintas até que o catálogo declare formalmente uma relação entre elas.

