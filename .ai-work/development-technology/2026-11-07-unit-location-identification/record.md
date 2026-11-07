# Localização na identificação da unidade

- Data: 07/11/2026. Branch: `fix/unit-location-identification-20261107`; base `544ba8ce`.
- Pedido: remover a configuração de “Área de ponto” da ficha; editar a localização em “Editar unidade”; exibir em Identificação o endereço derivado do mapa; retirar endereço livre. Commit e rollout autorizados.
- Alteração: controle de localização na etapa Identificação do editor; endereço da ficha atualizado após salvar localização. Cadastro novo conserva endereço inicial e permanece no editor para escolher o ponto, necessário para obter o ID. Gestores de unidade sem permissão de política de ponto veem o endereço sem edição; o fluxo deixa explícito que localização é salva separadamente. A ficha lateral conserva somente a leitura e cópia do endereço.
- Dados: endereço em `dp_units`; área em `repP_locationPolicies`. Sem transação entre bancos, a mensagem de falha parcial existente continua aplicável. Não há mudança na regra de coleta.
- Verificação: 20 testes dirigidos, ESLint sem erros (3 avisos preexistentes), documentação e `git diff --check` passaram. Typecheck local com 6 GiB relatou apenas módulos `@tiptap/*` ausentes na instalação local; o CI fará typecheck com dependências instaladas.
- Mapa: `system-map.md` e `investigation-harness.md`; fontes `unit-wizard-modal.tsx`, `unit-detail-panel.tsx`, `dp-settings-units.tsx`, `location-policy-control.tsx`, guia de geolocalização. Telemetria de tokens indisponível.
- Revisão Doc Brown: pendente.
