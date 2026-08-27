---
name: coala-security-scan
description: Executa e interpreta análise estática local de segurança do Coala-OP sem autofix. Use somente por invocação explícita; configuração remota, instalação e correção exigem autorização separada.
disable-model-invocation: true
user-invocable: true
---

# Coala security scan

Execute análise estática somente leitura por padrão. Um achado da ferramenta não é automaticamente uma vulnerabilidade confirmada.

## Modos

- `changed`: padrão quando o usuário pedir as mudanças atuais; limita o escopo a arquivos alterados relevantes.
- `path <caminho>`: analisa somente o caminho informado, após validar que está no repositório.
- `full`: somente quando o usuário solicitar explicitamente o projeto inteiro.

## Preflight e execução

1. Leia `AGENTS.md`.
2. Execute `node .agents/skills/coala-security-scan/scripts/run-security-scan.mjs <modo> [caminho]`.
3. O wrapper confirma a presença e versão do Semgrep, configuração local, escopo e política sem rede.
4. Se Semgrep ou configuração local não estiver disponível, encerre informando que o scan não foi realizado. Não instale nada.
5. Nunca use configuração de registro remoto, incluindo `--config auto`, sem autorização explícita.
6. Salve somente em `.ai-work/security/YYYY-MM-DD-HHMM[-N]/findings.json` e `report.md`.
7. Revise cada achado e atualize a classificação no relatório sem alterar o código-fonte.

## Classificação

Use uma destas classificações: `CONFIRMADO`, `PROVÁVEL`, `INCONCLUSIVO`, `FALSO POSITIVO` ou `ACEITO POR DECISÃO`.

Para cada achado registre ID, severidade da ferramenta, classificação humana/da IA, arquivo e linha, regra, evidência resumida, impacto, cenário possível, falso positivo possível, teste necessário, correção recomendada e risco de alterar comportamento.

## Limites

- Não altere código, não aplique autofix e não adicione `nosemgrep`.
- Não esconda achados para obter resultado verde.
- Não afirme que o sistema está seguro quando não houver achados.
- Não instale Semgrep nem acesse rede sem autorização específica.
- Remediação exige outra instrução explícita e deve começar por reprodução e teste de regressão.
