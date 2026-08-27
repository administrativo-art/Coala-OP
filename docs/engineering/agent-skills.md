# Agent Skills do Coala-OP

## O que são

As Agent Skills são procedimentos operacionais versionados com o repositório para orientar Claude Code e Codex em tarefas repetíveis. Elas não fazem parte do runtime do Coala-OP, não executam como serviço em segundo plano e não substituem testes, CI ou revisão humana.

A implementação canônica fica em `.agents/skills/<nome>/`. As entradas correspondentes em `.claude/skills/<nome>` são symlinks para a mesma pasta; portanto, não há duas cópias manuais do workflow. Configurações locais do Claude continuam ignoradas.

Todas as seis skills são de invocação explícita.

## Como invocar

### Claude Code

```text
/coala-issue-draft
/coala-handoff
/coala-resume-handoff
/coala-security-scan
/coala-supply-chain-audit
/coala-error-triage
```

### Codex

```text
$coala-issue-draft
$coala-handoff
$coala-resume-handoff
$coala-security-scan
$coala-supply-chain-audit
$coala-error-triage
```

## Exemplos

```text
/coala-issue-draft Use o print anexado para criar um rascunho. Não publique.
/coala-handoff Crie um handoff factual desta implementação.
/coala-resume-handoff Valide .ai-work/handoffs/2026-08-26-1530-exemplo.md sem continuar.
/coala-security-scan Analise somente as mudanças atuais.
/coala-supply-chain-audit Faça o inventário local sem consultar a rede.
/coala-error-triage Agrupe este export JSONL e prepare a triagem local sem publicar issues.
```

No Codex, substitua a barra inicial por `$` e mantenha o restante do pedido.

## Saídas locais

As skills escrevem artefatos sob `.ai-work/`:

```text
.ai-work/
├── issues/
├── handoffs/
├── security/
├── supply-chain/
└── error-triage/
```

Esse diretório é ignorado pelo Git porque contém contexto de sessão, rascunhos e relatórios locais que podem ficar obsoletos ou conter metadados operacionais. Fixtures automatizadas ficam em diretórios temporários criados pelos testes, nunca em `.ai-work/`.

## Contratos resumidos

| Skill | Entrada | Saída | Mutação permitida por padrão |
|---|---|---|---|
| `coala-issue-draft` | relato, print, log ou caminho fornecido | um Markdown em `.ai-work/issues/` | somente o rascunho |
| `coala-handoff` | contexto verificável da sessão | um Markdown em `.ai-work/handoffs/` | somente o handoff |
| `coala-resume-handoff` | caminho de handoff e modo | classificação de compatibilidade | nenhuma em `VALIDATE` |
| `coala-security-scan` | `changed`, `path` ou `full` explícito | JSON e relatório em `.ai-work/security/` | somente artefatos do scan |
| `coala-supply-chain-audit` | checkout local | inventário, achados e relatório em `.ai-work/supply-chain/` | somente artefatos da auditoria |
| `coala-error-triage` | export JSON/JSONL e inventário opcional de issues | eventos normalizados, grupos, relatório e rascunhos em `.ai-work/error-triage/` | somente artefatos da triagem |

## Segurança

- O frontmatter `disable-model-invocation: true` mantém as skills manuais no Claude Code.
- `policy.allow_implicit_invocation: false` em `agents/openai.yaml` mantém as skills manuais no Codex.
- Nenhuma skill publica issue, faz commit, push, deploy ou rollout.
- Scans não aplicam autofix, atualização de dependência ou supressão automática.
- Rede, instalação de ferramenta e auditoria externa exigem autorização específica.
- Rascunhos de issue passam por scanner local de padrões sensíveis, mas a revisão humana continua obrigatória.
- Handoffs registram somente fatos apoiados por comandos e resultados executados.

## Manutenção

Valide a estrutura compartilhada com:

```bash
npm run skills:validate
npm run test:skills
```

O comando agregado `npm run check` também executa `skills:validate` depois do typecheck, lint e testes unitários.

Para adicionar uma nova skill:

1. crie a implementação canônica em `.agents/skills/<nome>/`;
2. inclua `SKILL.md`, `agents/openai.yaml`, scripts e avaliações necessários;
3. marque a política de invocação adequada em cada cliente;
4. crie um symlink relativo em `.claude/skills/<nome>` para a pasta canônica;
5. ajuste as exceções específicas de `.gitignore` se a entrada Claude precisar ser versionada;
6. acrescente a skill ao validador central e aos testes estruturais;
7. execute os dois comandos acima.

Não copie manualmente o conteúdo inteiro para `.claude/skills`.

## Limitações

- Claude Code ou Codex podem precisar ser reiniciados ou abrir uma nova sessão para redescobrir skills adicionadas durante uma sessão ativa.
- A validação estrutural não prova descoberta real pela interface nem qualidade das decisões do modelo.
- `skills-ref` é opcional; quando ausente, somente o validador local é executado.
- `coala-security-scan` não roda sem Semgrep e uma configuração local; ele não instala a ferramenta.
- `coala-error-triage` não consulta nem publica issues; o inventário relacionado deve ser fornecido por arquivo local obtido em modo somente leitura.
- Consulta de CVEs, `npm audit` e configurações remotas de scanner dependem de rede e autorização.
- Um teste de wrapper não substitui um scan real, e um inventário local não prova ausência de risco na cadeia de suprimentos.
