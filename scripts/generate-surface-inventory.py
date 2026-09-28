#!/usr/bin/env python3
"""Inventory App Router API endpoints and pages outside the dashboard."""

from __future__ import annotations

import argparse
import csv
import re
from pathlib import Path
from urllib.parse import quote


ROOT = Path(__file__).resolve().parents[1]
APP = ROOT / "src/app"
OUTPUT = ROOT / "docs/engineering/surface-inventory.md"
MATRIX = ROOT / "docs/engineering/surface-flow-matrix.csv"
METHOD_RE = re.compile(r"export\s+(?:async\s+)?(?:function|const)\s+(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\b")
SOURCE_SUFFIXES = {".ts", ".tsx", ".js", ".jsx"}


def route_path(path: Path) -> str:
    parts = path.relative_to(APP).parts[:-1]
    return "/" + "/".join(part for part in parts if not (part.startswith("(") and part.endswith(")")))


def link(path: Path) -> str:
    relative = path.relative_to(ROOT).as_posix()
    return f"[{relative}](../../{quote(relative, safe='/.-_')})"


def function_exports() -> list[tuple[str, Path, str]]:
    """Resolve the explicit exports in the deployed entrypoint; never import runtime code."""
    entry = ROOT / "functions/src/index.ts"
    source = re.sub(r"/\*.*?\*/|//[^\n]*", "", entry.read_text(), flags=re.S)
    if re.search(r"export\s+\*", source):
        raise SystemExit("Resolve wildcard Functions exports explicitly before updating the map")
    exports = [(name, entry) for name in re.findall(r"export\s+const\s+(\w+)", source)]
    reexports = re.findall(r"export\s*\{([^}]+)\}\s*from\s*['\"]([^'\"]+)['\"]", source)
    if len(re.findall(r"^\s*export\b", source, re.M)) != len(exports) + len(reexports):
        raise SystemExit("Unsupported Functions export syntax; review the inventory resolver")
    for names, module in reexports:
        path = (entry.parent / module).with_suffix(".ts").resolve()
        for name in names.split(","):
            if name.strip():
                if not re.fullmatch(r"\w+", name.strip()):
                    raise SystemExit(f"Review aliased export: {name}")
                exports.append((name.strip(), path))
    result = []
    for name, path in exports:
        declaration = re.search(rf"export\s+const\s+{name}\s*=\s*(on\w+)(?:<[^>]+>)?\s*\(", path.read_text())
        if not declaration:
            raise SystemExit(f"Unclassified Functions export: {name} in {path}")
        result.append((name, path, declaration[1]))
    if len({name for name, _, _ in result}) != len(result):
        raise SystemExit("Duplicate Functions export")
    return sorted(result)


def classifications(expected: set[tuple[str, str, str]]) -> dict:
    with MATRIX.open(newline="", encoding="utf-8") as handle:
        rows = list(csv.DictReader(handle))
    mapping = {}
    for row in rows:
        key = (row["kind"], row["source"], row["symbol"])
        if key in mapping or not row["note"].strip():
            raise SystemExit(f"Duplicate or incomplete surface classification: {key}")
        guide = ROOT / row["guide"]
        if not guide.is_file() or not row["guide"].startswith("docs/engineering/"):
            raise SystemExit(f"Invalid guide: {row['guide']}")
        mapping[key] = row
    if set(mapping) != expected:
        raise SystemExit(f"Review surface-flow-matrix.csv; missing={sorted(expected - set(mapping))}; stale={sorted(set(mapping) - expected)}")
    return mapping


def generate() -> str:
    apis = sorted(
        (path for path in APP.rglob("route.*") if path.suffix in SOURCE_SUFFIXES),
        key=lambda path: (route_path(path), path.as_posix()),
    )
    public_pages = sorted(
        (path for path in APP.rglob("page.*") if path.suffix in SOURCE_SUFFIXES and "dashboard" not in path.relative_to(APP).parts),
        key=lambda path: (route_path(path), path.as_posix()),
    )
    functions = function_exports()
    expected = {(kind, path.relative_to(ROOT).as_posix(), "") for kind, paths in [("api", apis), ("page", public_pages)] for path in paths}
    expected.update(("function", path.relative_to(ROOT).as_posix(), name) for name, path, _ in functions)
    mapping = classifications(expected)

    def guide(kind: str, path: Path, symbol: str = "") -> str:
        row = mapping[(kind, path.relative_to(ROOT).as_posix(), symbol)]
        target = Path(row["guide"]).relative_to("docs/engineering").as_posix()
        return f"[{Path(target).stem}]({target})"
    lines = [
        "# Entradas externas e rotas de API",
        "",
        f"Inventário estrutural gerado de `src/app`: **{len(apis)} rotas de API** e **{len(public_pages)} páginas fora do dashboard**. "
        "Os métodos são extraídos dos exports; uma linha aqui não comprova autenticação, autorização, uso efetivo nem cobertura de fluxo. "
        "Para páginas internas, veja o [inventário do dashboard](route-inventory.md). Para entender comportamento, siga o [harness](investigation-harness.md) e confira o código.",
        "",
        f"Inclui **{len(functions)} exports de Cloud Functions** resolvidos de `functions/src/index.ts`. Destinos manuais na [matriz de superfícies](surface-flow-matrix.csv); uma entrada nova exige classificação explícita. Esta associação indica onde investigar, não certifica autorização, implantação nem execução. Veja a [auditoria ampliada](surface-audit.md).",
        "",
        "## Páginas fora do dashboard",
        "",
        "| Caminho | Arquivo | Guia |",
        "| --- | --- | --- |",
    ]
    lines.extend(f"| `{route_path(path)}` | {link(path)} | {guide('page', path)} |" for path in public_pages)
    lines.extend(["", "## Rotas de API", "", "| Caminho | Métodos exportados | Arquivo | Guia |", "| --- | --- | --- | --- |"])
    for path in apis:
        methods = list(dict.fromkeys(METHOD_RE.findall(path.read_text(encoding="utf-8"))))
        lines.append(f"| `{route_path(path)}` | {', '.join(methods) or '—'} | {link(path)} | {guide('api', path)} |")
    lines.extend(["", "## Cloud Functions exportadas", "", "| Export | Gatilho declarado | Fonte | Guia |", "| --- | --- | --- | --- |"])
    lines.extend(f"| `{name}` | `{trigger}` | {link(path)} | {guide('function', path, name)} |" for name, path, trigger in functions)
    lines.append("")
    return "\n".join(lines)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true", help="Fail if generated inventory is stale")
    args = parser.parse_args()
    expected = generate()
    if args.check:
        if not OUTPUT.exists() or OUTPUT.read_text(encoding="utf-8") != expected:
            raise SystemExit("surface-inventory.md is stale; run python3 scripts/generate-surface-inventory.py")
        print("surface-inventory.md is current")
    else:
        OUTPUT.write_text(expected, encoding="utf-8")
        print(f"wrote {OUTPUT.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
