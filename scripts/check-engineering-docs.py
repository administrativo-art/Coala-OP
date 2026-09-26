#!/usr/bin/env python3
"""Check local references and flow coverage in the engineering map."""

from __future__ import annotations

import csv
import re
from collections import Counter
from pathlib import Path
from urllib.parse import unquote


ROOT = Path(__file__).resolve().parents[1]
DOCS = ROOT / "docs/engineering"
LINK_RE = re.compile(r"\[[^]]*\]\(([^)]+)\)")
ROW_RE = re.compile(r"^\| `([a-z][a-z0-9-]*)` \| (\d+) \| (Localizado|Traçado|Verificado) \|", re.MULTILINE)


def main() -> None:
    errors: list[str] = []
    files = sorted(DOCS.rglob("*.md"))
    for source in files:
        for target in LINK_RE.findall(source.read_text(encoding="utf-8")):
            if target.startswith(("https://", "http://", "mailto:", "#")):
                continue
            path, _, anchor = target.partition("#")
            if not path:
                continue
            resolved = (source.parent / unquote(path)).resolve()
            if not resolved.exists():
                errors.append(f"{source.relative_to(ROOT)}: missing {target}")
            elif anchor and resolved.is_file() and resolved.suffix == ".md":
                # Anchor spelling depends on renderer; existence of its file is the stable check.
                pass

    with (DOCS / "flow-matrix.csv").open(newline="", encoding="utf-8") as handle:
        expected_count = Counter(flow for row in csv.DictReader(handle) for flow in row["flow_id"].split(";") if flow)
    expected = set(expected_count)
    coverage = (DOCS / "flow-coverage.md").read_text(encoding="utf-8")
    rows = ROW_RE.findall(coverage)
    listed = [flow for flow, _, _ in rows]
    for flow in sorted(expected - set(listed)):
        errors.append(f"flow-coverage.md: missing {flow}")
    for flow in sorted(set(listed) - expected):
        errors.append(f"flow-coverage.md: stale {flow}")
    if len(listed) != len(set(listed)):
        errors.append("flow-coverage.md: duplicate flow rows")
    for flow, page_count, state in rows:
        if int(page_count) != expected_count.get(flow, 0):
            errors.append(f"flow-coverage.md: {flow} has {page_count} pages; matrix has {expected_count.get(flow, 0)}")
        if state != "Localizado":
            row = next((line for line in coverage.splitlines() if line.startswith(f"| `{flow}` |")), "")
            if "flows/" not in row:
                errors.append(f"flow-coverage.md: {flow} marked {state} without deep guide")

    verification = (DOCS / "flow-verification.md").read_text(encoding="utf-8")
    verification_rows = re.findall(
        r"^\| `([a-z][a-z0-9-]*)` \| (Parcial|Verificado(?: \(contrato local\))?) \|",
        verification,
        re.MULTILINE,
    )
    reviewed = [flow for flow, _ in verification_rows]
    for flow in sorted(expected - set(reviewed)):
        errors.append(f"flow-verification.md: missing {flow}")
    for flow in sorted(set(reviewed) - expected):
        errors.append(f"flow-verification.md: stale {flow}")
    if len(reviewed) != len(set(reviewed)):
        errors.append("flow-verification.md: duplicate flow rows")
    coverage_states = {flow: state for flow, _, state in rows}
    for flow, result in verification_rows:
        if (result.startswith("Verificado")) != (coverage_states.get(flow) == "Verificado"):
            errors.append(f"flow-verification.md: {flow} disagrees with coverage state")

    surfaces = (DOCS / "surface-inventory.md").read_text(encoding="utf-8")
    external_inventory_section = surfaces.split("## Páginas fora do dashboard", 1)[1].split("## Rotas de API", 1)[0]
    external_inventory = re.findall(r"^\| `([^`]+)` \|", external_inventory_section, re.MULTILINE)
    external_map = (DOCS / "external-page-map.md").read_text(encoding="utf-8")
    external_listed = re.findall(r"^\| \[`([^`]+)`\]\(", external_map, re.MULTILINE)
    for route in sorted(set(external_inventory) - set(external_listed)):
        errors.append(f"external-page-map.md: missing {route}")
    for route in sorted(set(external_listed) - set(external_inventory)):
        errors.append(f"external-page-map.md: stale {route}")
    if len(external_listed) != len(set(external_listed)):
        errors.append("external-page-map.md: duplicate route rows")

    guide_count = len(list((DOCS / "flows").glob("*.md"))) - 1  # TEMPLATE.md
    guided_groups = sum("flows/" in line for line in coverage.splitlines() if ROW_RE.match(line))
    traced = sum(state in {"Traçado", "Verificado"} for _, _, state in rows)
    verified = sum(state == "Verificado" for _, _, state in rows)
    progress = (DOCS / "system-map-execution.md").read_text(encoding="utf-8")
    audit = (DOCS / "coverage-audit.md").read_text(encoding="utf-8")
    counters = [
        (progress, r"(\d+)/\d+ grupos traçados integralmente", traced, "execution traced"),
        (progress, r"(\d+)/\d+ verificados", verified, "execution verified"),
        (progress, r"Há (\d+) guias de subfluxo", guide_count, "execution guides"),
        (audit, r"Grupos com ao menos um guia \| (\d+)/", guided_groups, "audit groups with guides"),
        (audit, r"Grupos marcados `Traçado` \| (\d+)/", traced, "audit traced"),
        (audit, r"Grupos marcados `Verificado` \| (\d+)/", verified, "audit verified"),
        (audit, r"Guias de subfluxo \| (\d+) \|", guide_count, "audit guides"),
    ]
    for document, pattern, value, label in counters:
        match = re.search(pattern, document)
        if not match or int(match.group(1)) != value:
            errors.append(f"{label}: expected {value}, found {match.group(1) if match else 'missing'}")

    if errors:
        raise SystemExit("\n".join(errors))
    print(f"{len(files)} engineering docs; {len(listed)} flow groups; local links valid")


if __name__ == "__main__":
    main()
