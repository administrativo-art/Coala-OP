---
name: coala-security-audit
description: Coordena auditorias AppSec rastreáveis do Coala-OP, do reconhecimento ao relatório e reteste local. Use somente por invocação explícita; não corrige código nem testa produção na primeira execução.
disable-model-invocation: true
user-invocable: true
---

# Coala security audit

Produza diagnóstico baseado em evidência e cobertura declarada. “Completa” significa que as superfícies do escopo receberam estado verificável; nunca significa ausência comprovada de vulnerabilidades.

## Fluxo obrigatório

1. Leia `AGENTS.md`, `docs/engineering/investigation-harness.md`, `docs/engineering/system-map.md`, `docs/engineering/security-baseline.md` e `docs/engineering/agent-skills.md`.
2. Confirme `git status --short`, branch, revisão e inventário vigente. Não altere produto, infraestrutura ou dados nesta primeira rodada.
3. Inicialize o registro com:

   ```bash
   node .agents/skills/coala-security-audit/scripts/init-audit-run.mjs
   ```

4. Preencha `scope.json` antes de teste dinâmico. Na falta de autorização específica, limite-se à análise estática. Leia [escopo e evidência](references/scope-and-evidence.md).
5. Faça reconhecimento e análise estática por risco, mantendo `coverage.json`, `hypotheses.json` e `findings.json`. Leia [análise estática](references/static-analysis.md).
6. Quando dependências e instalação estiverem no escopo, use `$coala-security-supply-chain`; não replique seu inventário nem atualize pacotes.
7. Elabore o plano de testes antes de executar DAST. Para testes autorizados em ambiente local, leia [validação local](references/local-validation.md).
8. Contextualize achados por ativo, ator, fronteira de confiança, pré-condições, impacto e controles compensatórios. Leia [modelagem de ameaças](references/threat-modeling.md) quando houver múltiplos fluxos ou risco sistêmico.
9. Consolide resultados conforme [relatório e reteste](references/reporting-and-retest.md). Separe fato, inferência, hipótese e decisão.
10. Valide os artefatos:

   ```bash
   node .agents/skills/coala-security-audit/scripts/validate-audit-run.mjs <diretório-da-auditoria>
   ```

## Modos

- **Diagnóstico:** padrão; reconhecimento, análise estática, hipóteses, plano e relatório inicial sem correções.
- **Validação local:** executa somente testes previstos no escopo, com emuladores/projeto `demo-`, dados sintéticos e evidência positiva e negativa.
- **Reteste:** repete testes associados a achados selecionados e atualiza seus estados; não amplia cobertura silenciosamente.
- **Plano de correção:** propõe causa raiz, impacto, arquivos e testes. Implementação é uma tarefa separada e exige autorização.

## Limites

- A invocação desta skill não autoriza produção, rede externa, navegador do usuário, scanners externos, dados reais, força bruta, indisponibilidade, exfiltração, persistência, commit, push, deploy ou correção.
- Não classifique um componente como seguro; registre apenas o controle e o cenário efetivamente validados.
- Não exponha segredos, tokens, dados pessoais, payloads financeiros/RH ou URLs assinadas. Evidências devem ser minimizadas e redigidas.
- Não invente OWASP, CWE, CVSS ou versão de referencial. Registre fonte oficial e data quando a consulta estiver autorizada; caso contrário marque o mapeamento como não verificado.
- Preserve os registros em `.ai-work/security-audit/<id>/`. Não grave evidência sensível em documentação versionada.
