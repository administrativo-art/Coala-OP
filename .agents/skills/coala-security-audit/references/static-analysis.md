# Análise estática orientada ao Coala-OP

Comece pelo inventário vigente, não por busca irrestrita. Use `docs/engineering/surface-inventory.md`, `runtime-surfaces.md`, `access-and-privacy.md`, matrizes de fluxo e o guia do domínio; confirme tudo no código atual.

## Ordem de risco

1. Sessão, primeiro acesso, recuperação de senha, tokens públicos e revogação.
2. Autorização no servidor, propriedade de recurso e isolamento por workspace, organização, unidade e pessoa.
3. Financeiro, pagamentos, RH, documentos, privacidade e operações administrativas.
4. Uploads, downloads, Storage, URLs assinadas, MIME/assinatura, nomes e caminhos.
5. Webhooks, jobs e identidades de máquina: assinatura, replay, idempotência, segredo, auditoria e erros.
6. Entradas e injeções: schema, mass assignment, NoSQL, comando, SSRF, path traversal, XSS e desserialização.
7. Dados: projeção mínima, cache, logs, backups, retenção, criptografia e segredo.
8. Next.js e navegador: cookies, headers, CSP, CORS, source maps, service worker e fronteiras server/client.
9. Firebase/GCP: Auth, Admin SDK, Security Rules, bancos nomeados, Storage, Functions, IAM e Secret Manager.
10. CI/CD e supply chain: workflows, ações fixadas, artefatos, manifests, lockfiles e scripts de instalação.

## Cobertura

Registre uma entrada por superfície e método relevante em `coverage.json`. Inclua localização, guia, dados, identidade, autorização, estado da revisão, testes planejados/executados e lacunas. Catch-alls e helpers compartilhados exigem cobertura por ramo/consumidor; uma linha de inventário não certifica todos os comportamentos.

Para controles compartilhados, prove quais chamadores realmente os utilizam. Middleware, botão oculto, validação de frontend ou função com nome de permissão não comprovam cobertura do endpoint.

## Dependências e referenciais

Use `$coala-security-supply-chain` para inventário local determinístico. Consultas de CVE, manutenção ou versões exigem fonte externa datada e autorização de rede.

Para OWASP, CWE, CVSS, NIST ou outro referencial, fixe a versão e a fonte oficial consultada. Não derive identificadores por memória quando a versão não tiver sido verificada.
