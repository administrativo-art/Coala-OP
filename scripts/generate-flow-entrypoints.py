#!/usr/bin/env python3
"""Inventory statically discoverable UI files and API calls for reviewed flow groups.

This is a navigation aid, not proof that a request is reachable at runtime.
"""

from __future__ import annotations

import argparse
import csv
import re
from collections import defaultdict
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
MATRIX = ROOT / "docs/engineering/flow-matrix.csv"
OUTPUT = ROOT / "docs/engineering/flow-entrypoints.md"
IMPORT_RE = re.compile(r"(?:from\s*|import\s*\(|import\s*)['\"]([^'\"]+)['\"]")
API_RE = re.compile(r"(?<![\w/])(?:/api/)([\w./\[\]-]+)")
COLLECTION_RE = re.compile(r"(?:\bcollection\s*\(\s*(?:db|firestore)\s*,\s*|\bdbAdmin\.collection\s*\(\s*|\bdoc\s*\(\s*db\s*,\s*)['\"]([A-Za-z][A-Za-z0-9_-]*)['\"]")
PERMISSION_RE = re.compile(r"\bpermissions(?:\?\.)?\.([A-Za-z][A-Za-z0-9_]*(?:\?\.[A-Za-z][A-Za-z0-9_]*|\.[A-Za-z][A-Za-z0-9_]*){1,5})")
MAX_DEPTH = 5
MAX_FILES_PER_GROUP = 300
API_ROOT = ROOT / "src/app/api"
GLOBAL_CONTEXT_FILES = {
    ROOT / "src/components/auth-provider.tsx",
    ROOT / "src/hooks/use-auth.ts",
}


def resolve_import(source: Path, specifier: str) -> Path | None:
    if specifier.startswith("@/"):
        base = ROOT / "src" / specifier[2:]
    elif specifier.startswith("."):
        base = source.parent / specifier
    else:
        return None
    for candidate in (base, *(Path(f"{base}{extension}") for extension in (".tsx", ".ts", ".jsx", ".js")), *(base / f"index{extension}" for extension in (".tsx", ".ts", ".jsx", ".js"))):
        if candidate.is_file():
            resolved = candidate.resolve()
            if resolved.is_relative_to(ROOT / "src"):
                return resolved
    return None


def search_group(pages: list[Path]) -> tuple[list[Path], dict[str, set[Path]], bool]:
    seen: set[Path] = set()
    queue = [(page.resolve(), 0) for page in pages]
    calls: dict[str, set[Path]] = defaultdict(set)
    truncated = False
    while queue:
        path, depth = queue.pop(0)
        if path in seen:
            continue
        if len(seen) >= MAX_FILES_PER_GROUP:
            truncated = True
            break
        seen.add(path)
        source = path.read_text(encoding="utf-8")
        for match in API_RE.finditer(source):
            calls[f"/api/{match.group(1)}"].add(path)
        if depth >= MAX_DEPTH:
            continue
        for specifier in IMPORT_RE.findall(source):
            target = resolve_import(path, specifier)
            if target and target not in seen and target not in GLOBAL_CONTEXT_FILES and (
                target.is_relative_to(ROOT / "src/components")
                or target.is_relative_to(ROOT / "src/features")
                or target.is_relative_to(ROOT / "src/hooks")
                or target.is_relative_to(ROOT / "src/app/dashboard")
            ):
                queue.append((target, depth + 1))
    return sorted(seen), calls, truncated


def link(path: Path) -> str:
    relative = path.relative_to(ROOT).as_posix()
    return f"[`{relative}`](../../{relative.replace('[', '%5B').replace(']', '%5D')})"


def route_candidate(call: str) -> Path | None:
    relative = call.removeprefix("/api/").strip("/")
    if call.endswith("/"):
        children = [path for path in (API_ROOT / relative).glob("[[]*[]]/route.ts") if path.is_file()]
        if len(children) == 1:
            return children[0]
    exact = API_ROOT / relative / "route.ts"
    if exact.is_file():
        return exact
    return None


def render() -> str:
    groups: dict[str, list[Path]] = defaultdict(list)
    with MATRIX.open(newline="", encoding="utf-8") as handle:
        for row in csv.DictReader(handle):
            if row["kind"] != "active":
                continue
            for flow_id in row["flow_id"].split(";"):
                if flow_id:
                    groups[flow_id].append(ROOT / row["page"])

    lines = [
        "# Entradas de interface e chamadas candidatas por fluxo",
        "",
        "Índice gerado de `flow-matrix.csv` e das importações locais alcançáveis a partir das páginas ativas. "
        "Ajuda a escolher onde investigar; uma string `/api/` encontrada no código **não prova** que a chamada ocorre nem que seja a única entrada do fluxo. "
        "Chamadas montadas dinamicamente, jobs, webhooks e importações além de cinco níveis podem não aparecer. "
        "Coleções e permissões abaixo são apenas literais encontrados nos arquivos percorridos; podem pertencer a outro ramo, faltar chamadas indiretas e não comprovam autorização efetiva. "
        "Confirme cada candidato na interface, na rota, no serviço e nos testes antes de marcar um grupo como traçado.",
        "",
        f"Grupos com página ativa: **{len(groups)}**. Atualize com `python3 scripts/generate-flow-entrypoints.py` e confira com `--check`.",
        "",
    ]
    for flow_id, pages in sorted(groups.items()):
        files, calls, truncated = search_group(pages)
        lines.extend([f"## `{flow_id}`", "", f"Páginas: {', '.join(link(page) for page in sorted(pages))}.", ""])
        lines.append(f"Arquivos locais percorridos: {len(files)}{' (limite atingido; índice parcial)' if truncated else ''}." )
        lines.append("")
        if calls:
            lines.append("Chamadas candidatas encontradas:")
            lines.append("")
            for call, sources in sorted(calls.items()):
                example = sorted(sources)[0]
                route = route_candidate(call)
                lines.append(f"- `{call}` — interface {link(example)}" + (f"; rota candidata {link(route)}" if route else ""))
        else:
            lines.append("Nenhuma string de API encontrada no percurso estático; investigar chamadas indiretas, ações de servidor e SDKs.")
        lines.append("")
        collections: dict[str, set[Path]] = defaultdict(set)
        permissions: dict[str, set[Path]] = defaultdict(set)
        for path in files:
            source = path.read_text(encoding="utf-8")
            for name in COLLECTION_RE.findall(source):
                collections[name].add(path)
            for name in PERMISSION_RE.findall(source):
                permissions[name.replace("?.", ".")].add(path)
        if collections:
            lines.append("Coleções Firestore candidatas por literal no cliente (confirmar ramo e regras):")
            lines.append("")
            for name, sources in sorted(collections.items()):
                lines.append(f"- `{name}` — {link(sorted(sources)[0])}")
            lines.append("")
        if permissions:
            lines.append("Permissões citadas pela interface (a autorização deve ser conferida no servidor/regras):")
            lines.append("")
            for name, sources in sorted(permissions.items()):
                lines.append(f"- `{name}` — {link(sorted(sources)[0])}")
            lines.append("")
    return "\n".join(lines)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    expected = render()
    if args.check:
        if not OUTPUT.exists() or OUTPUT.read_text(encoding="utf-8") != expected:
            raise SystemExit(f"{OUTPUT.relative_to(ROOT)} is stale; regenerate it")
        print("flow-entrypoints.md is current")
    else:
        OUTPUT.write_text(expected, encoding="utf-8")
        print(f"wrote {OUTPUT.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
