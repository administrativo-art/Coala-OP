# Registro geral de prompts de IA

## Decisão de arquitetura

O Coala One possui um registro único de prompts em `src/ai/prompts/registry.ts`. Os textos e contextos permanecem segmentados por módulo em `src/ai/prompts/<modulo>/`.

Essa arquitetura combina:

- consulta central de identificador, versão, schema, status, risco e responsável;
- ownership por módulo, sem um arquivo monolítico;
- versionamento em código e revisão por deploy;
- separação explícita entre interpretação da IA e regra determinística do sistema.

## Estrutura

```text
src/ai/prompts/
├── registry.ts
├── types.ts
├── commercial/
├── documents/
├── financial/
├── hr/
└── operations/
```

Cada definição contém:

- `id`: chave estável e única no sistema;
- `module`: módulo proprietário;
- `version`: versão do texto;
- `schemaVersion`: versão do contrato estruturado;
- `status`: `active`, `draft` ou `deprecated`;
- `risk`: impacto potencial;
- `rulesBoundary`: o que a IA pode interpretar e o que permanece determinístico;
- `render(context)`: construção do texto final.

## Regras de governança

1. Nenhum prompt operacional novo deve ficar embutido diretamente em rota, componente ou fluxo.
2. Toda alteração material incrementa `version`.
3. Alteração do formato estruturado também incrementa `schemaVersion`.
4. Prompt `draft` não pode ser conectado a uma automação de produção.
5. O processamento deve persistir `promptVersion`, `schemaVersion`, modelo e resultado de validação quando o domínio exigir auditoria.
6. Contas, DRE, rateios, permissões, conciliação e pagamentos nunca são decididos somente pelo prompt.
7. A autorização bancária permanece exclusiva do usuário no aplicativo bancário.

## Prompts financeiros iniciais

Foram reservadas definições especializadas para:

- contracheque detalhado;
- DAS do Simples Nacional;
- guias de folha, FGTS, INSS e consignados;
- documentos financeiros usados para conciliar provisões.

Essas definições permanecem como `draft`. Por decisão operacional, recibos, contracheques, DAS e DARE são tratados pelo assistente, caso a caso, e não pelo upload automático da área de Documentos. A ativação futura dependerá de autorização expressa, schema estrito, validações de fechamento, integração e testes de conciliação.

## Evolução

Uma futura tela administrativa poderá listar os metadados do registro, versões e usos recentes. O texto canônico continuará versionado no repositório; a tela não deverá permitir alteração silenciosa de instruções contábeis ou de segurança.
