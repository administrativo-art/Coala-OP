# Modais (`WizardModal`)

Contrato medido nos protótipos `Insumo Base - Modal 2a-2b`, `Insumo Derivado - Modal` e `Pessoas e Empresas - Modal`. O guia vivo demonstra as variantes; a migração dos modais operacionais fica fora deste PR.

## Casca comum

| Item | Valor |
|---|---|
| Largura | 1080px, máximo `calc(100vw - 48px)` |
| Altura | automática, 780, 800 ou 820px, máximo `calc(100vh - 48px)` |
| Raio | 26px com `overflow: hidden` |
| Formulário | `--ds-surface-input` |
| Lateral | `--ds-surface-dark` |
| Sombra e véu | `--ds-shadow-modal` e `--ds-scrim` |

O modal usa Radix Dialog: foco preso, Esc e clique no véu passam pela mesma regra de fechamento, e o foco volta ao acionador.

## Lateral escura

`sidebarWidth` aceita 380px para Insumo Base, 360px como padrão e 340px para Pessoas e Empresas. A lateral recebe um slot e organiza:

1. kicker 10,5/800, caixa alta;
2. identidade ao vivo, com nome 30/800 e tags;
3. fatos vivos em card translúcido;
4. stepper vertical quando `stepper="sidebar"`;
5. nota opcional no rodapé.

## Stepper

### `stepper="sidebar"`

Padrão para três ou mais etapas. Cada botão mostra número ou ✓, rótulo e resumo do preenchimento. Etapas com `hidden` saem da lista; no modo `new`, `highestStep` bloqueia o que ainda não foi alcançado. A atual usa `aria-current="step"`.

### `stepper="top"`

Padrão do Insumo Base, cuja lateral já contém fatos extensos. Usa barras de 4px e rótulos “01 Identificação”. O botão × fica na mesma faixa.

Em telas menores, o stepper lateral reaparece em versão horizontal no cabeçalho; a lateral visual fica oculta sem esconder a navegação das etapas.

## Cabeçalho e corpo

- `sidebar`: título 21/800, descrição 13px, ações opcionais e botão × de 34px.
- `top`: stepper e × compartilham a primeira linha.
- Só o corpo rola; cabeçalho e rodapé permanecem fixos.
- Erro fica junto do campo, ligado por `aria-describedby` e anunciado com `role="alert"`.
- Seleção dentro do formulário usa os tokens `--ds-modal-accent*`; foco continua rosa.

## Rodapés

| Modo | Esquerda | Direita |
|---|---|---|
| `new` + `final` | Cancelar na primeira etapa; Voltar nas demais | Avançar; na última, Adicionar |
| `edit` + `final` | Cancelar ou Voltar | Avançar; na última, Salvar alterações |
| `edit` + `per-step` | Voltar | dica, Próxima etapa e Salvar etapa |
| `readOnly` | — | Editar |

Com `dirty`, fechar sempre abre `InlineConfirm` no rodapé. Em `per-step`, trocar de etapa também confirma o descarte. O primário usa `primary-modal`; Cancelar usa `ds-ghost`; Voltar e Editar usam `ds-secondary`.

## API entregue no guia

```tsx
<WizardModal
  open
  onOpenChange={setOpen}
  mode="new" // ou "edit"
  readOnly={false}
  stepper="sidebar" // ou "top"
  saveMode="final" // ou "per-step"
  sidebarWidth={360}
  height={800}
  sidebar={<SidebarContent />}
  steps={[{ id, label, description, summary, hidden, valid }]}
  stepIndex={step}
  highestStep={highestStep}
  onStepChange={setStep}
  headerActions={<StatusControl />}
  onValidateStep={validateCurrentStep}
  onSubmit={saveAll}
  onSaveStep={saveCurrentStep}
  dirty
  title="Editar insumo"
  submitLabel="Salvar alterações"
>
  <StepFields />
</WizardModal>
```

`onClose` continua aceito apenas como compatibilidade com o scaffold inicial; novas composições usam `onOpenChange`.

## Critérios antes da adoção operacional

- O shell deve montar Insumo Base, Derivado e Pessoas sem duplicar a casca.
- Validação, persistência e permissão continuam pertencendo ao fluxo real; o componente não grava dados.
- Testar abertura, Esc, clique no véu, retorno de foco, mudança de etapa, etapa bloqueada, descarte e carregamento.
- A ficha somente leitura reaproveita a mesma casca; abas específicas podem ser fornecidas pelo conteúdo até existir um contrato compartilhado comprovado.
