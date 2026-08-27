---
name: coala-supply-chain-audit
description: Audita manifests, lockfiles e scripts de instalação do Coala-OP sem atualizar dependências. Use somente por invocação explícita; consultas externas e remediação exigem autorização separada.
disable-model-invocation: true
user-invocable: true
---

# Coala supply chain audit

Audite deterministicamente dependências e superfícies de instalação. Esta skill é somente leitura por padrão e não interpreta CVEs sem uma fonte apropriada.

## Fluxo

1. Leia `AGENTS.md`.
2. Execute `node .agents/skills/coala-supply-chain-audit/scripts/inventory-dependencies.mjs`.
3. O script inspeciona manifests, lockfiles, dependências diretas, versões, Git/URL, scripts lifecycle, overrides, duplicidades e comandos de download/execução.
4. Salve somente em `.ai-work/supply-chain/YYYY-MM-DD-HHMM[-N]/inventory.json`, `findings.json` e `report.md`.
5. Classifique fatos locais separadamente de CVEs, risco de manutenção ou risco de mantenedor não verificados.
6. Se o usuário quiser `npm audit`, consulta de CVEs ou outro auditor externo, pare e solicite autorização de rede específica. Registre ferramenta e data quando houver autorização.

## Categorias

Use: `CVE conhecida`, `versão desatualizada`, `dependência abandonada`, `script de instalação`, `dependência por URL`, `dependência Git`, `versão não fixada`, `pacote duplicado`, `manifest/lockfile divergente`, `ferramenta executada por npx sem versão`, `risco de mantenedor` ou `risco inconclusivo`.

Não classifique faixa semver como vulnerabilidade; ela é apenas uma característica de resolução. Não afirme CVE, abandono ou risco de mantenedor sem fonte externa datada.

## Limites

- Não execute `npm update`, instalação, remoção, regeneração de lockfile, override, edição de workflow ou publicação.
- Não execute auditoria de rede sem autorização explícita.
- Não copie segredos eventualmente encontrados em scripts; registre somente tipo e localização segura.
- Remediação é uma tarefa separada e deve selecionar achados específicos.
