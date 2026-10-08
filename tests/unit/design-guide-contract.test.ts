import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { test } from "node:test"

import { nextSegmentedIndex } from "../../src/components/patterns/segmented-navigation"

const read = (path: string) => readFileSync(path, "utf8")

test("segmented navigation wraps and supports Home/End", () => {
  assert.equal(nextSegmentedIndex("ArrowRight", 2, 3), 0)
  assert.equal(nextSegmentedIndex("ArrowLeft", 0, 3), 2)
  assert.equal(nextSegmentedIndex("ArrowDown", 0, 3), 1)
  assert.equal(nextSegmentedIndex("ArrowUp", 1, 3), 0)
  assert.equal(nextSegmentedIndex("Home", 2, 3), 0)
  assert.equal(nextSegmentedIndex("End", 0, 3), 2)
  assert.equal(nextSegmentedIndex("Enter", 1, 3), null)
})

test("design guide source uses semantic tokens instead of loose hex", () => {
  const paths = [
    "src/components/design/design-guide.tsx",
    "src/components/patterns/control-panel.tsx",
    "src/components/patterns/filter-chips.tsx",
    "src/components/patterns/inline-confirm.tsx",
    "src/components/patterns/lift-row.tsx",
    "src/components/patterns/segmented.tsx",
    "src/components/patterns/side-panel.tsx",
    "src/components/patterns/wizard-modal.tsx",
    "src/components/ui/status-pill.tsx",
  ]

  for (const path of paths) {
    assert.doesNotMatch(read(path), /#[0-9a-f]{3,8}\b/i, path)
  }
})

test("shared guide components expose stable visual markers", () => {
  const contracts = new Map([
    ["src/components/patterns/control-panel.tsx", 'data-ui="control-panel"'],
    ["src/components/patterns/lift-row.tsx", 'data-ui="lift-row"'],
    ["src/components/patterns/side-panel.tsx", 'data-ui="side-panel"'],
    ["src/components/patterns/wizard-modal.tsx", 'data-ui="wizard-modal"'],
    ["src/components/ui/status-pill.tsx", 'data-ui="status-pill"'],
  ])

  for (const [path, marker] of contracts) {
    assert.match(read(path), new RegExp(marker), path)
  }
})

test("design button variants stay additive", () => {
  const source = read("src/components/ui/button.tsx")
  for (const variant of ["default", "destructive", "outline", "secondary", "ghost", "link"]) {
    assert.match(source, new RegExp(`\\b${variant}:`))
  }
  for (const variant of ["primary-page", "primary-modal", "ds-secondary", "ds-ghost", "ds-link", "danger-link", "on-dark-secondary", "on-dark-icon"]) {
    assert.match(source, new RegExp(`["]${variant}["]:`))
  }
})

test("wizard modal validates both final and per-step saves", () => {
  const source = read("src/components/patterns/wizard-modal.tsx")

  assert.match(source, /const advance = \(\) => \{\s*if \(onValidateStep && !onValidateStep\(stepIndex\)\) return/)
  assert.match(source, /const saveCurrentStep = \(\) => \{\s*if \(onValidateStep && !onValidateStep\(stepIndex\)\) return/)
  assert.match(source, /onClick=\{saveCurrentStep\}>Salvar etapa<\/Button>/)
})

test("wizard modal offers cancel on the first final-save step", () => {
  const source = read("src/components/patterns/wizard-modal.tsx")

  assert.match(source, /stepIndex === 0 && saveMode === "final"/)
})
