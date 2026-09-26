#!/usr/bin/env python3
"""Generate the dashboard route index from the checked-out source tree."""

from __future__ import annotations

import argparse
import re
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
DASHBOARD = ROOT / "src/app/dashboard"
OUTPUT = ROOT / "docs/engineering/route-inventory.md"
IMPORT_RE = re.compile(r"from\s+['\"]@/([^'\"]+)['\"]")
REDIRECT_RE = re.compile(r"(?:redirect|router\.replace|router\.push)\(\s*['\"]([^'\"]+)['\"]")


def local_source(alias: str) -> Path | None:
    base = ROOT / "src" / alias
    for candidate in (base.with_suffix(".tsx"), base.with_suffix(".ts"), base / "index.tsx", base / "index.ts"):
        if candidate.is_file():
            return candidate
    return None


def rel_link(path: Path) -> str:
    return "../../" + path.relative_to(ROOT).as_posix().replace("(", "%28").replace(")", "%29")


def describe_next(source: str) -> str:
    redirect = REDIRECT_RE.search(source)
    if redirect and len(source.splitlines()) <= 30 and redirect.group(1).startswith("/dashboard/"):
        return f"Redireciona para `{redirect.group(1)}`"
    if re.search(r"return\s+null\s*;", source) and len(source.splitlines()) <= 10:
        return "Retorna `null`"

    selected: list[Path] = []
    for alias in IMPORT_RE.findall(source):
        if alias.startswith(("components/ui/", "components/navigation/", "hooks/use-auth", "lib/utils")):
            continue
        resolved = local_source(alias)
        if resolved is not None and resolved not in selected:
            selected.append(resolved)
        if len(selected) == 2:
            break
    if not selected:
        return "Ler a própria página"
    return ", ".join(f"[{path.name}]({rel_link(path)})" for path in selected)


def generate() -> str:
    lines = [
        "# Inventário de rotas do dashboard",
        "",
        "Gerado de `src/app/dashboard/**/page.tsx` por `scripts/generate-route-inventory.py`. "
        "As pastas são caminhos de código; segmentos como `@modal` e `(.)` não são URLs públicas. "
        "Use busca por caminho ou domínio; não carregue a tabela inteira para uma tarefa local. "
        "A coluna seguinte contém só importações ou redirecionamentos diretos observados no arquivo. "
        "Para fluxo, dados, permissões e testes, consulte [entradas principais](dashboard-areas.md) "
        "e o [guia do domínio](system-map.md).",
        "",
    ]
    pages = sorted(DASHBOARD.rglob("page.tsx"))
    groups: dict[str, list[Path]] = {}
    for page in pages:
        route = page.relative_to(DASHBOARD).parent
        group = route.parts[0] if route.parts else "raiz"
        groups.setdefault(group, []).append(page)
    for group, entries in sorted(groups.items()):
        lines += [f"## {group} ({len(entries)})", "", "| Pasta sob `src/app` | Arquivo | Próximo ponto direto |", "| --- | --- | --- |"]
        for page in entries:
            route = page.relative_to(DASHBOARD).parent.as_posix()
            display = "dashboard" + ("/" + route if route != "." else "")
            lines.append(f"| `{display}` | [page.tsx]({rel_link(page)}) | {describe_next(page.read_text())} |")
        lines.append("")
    lines += [f"Total: **{len(pages)} páginas** no checkout usado para a geração.", ""]
    return "\n".join(lines)


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--check", action="store_true", help="fail if the generated document is stale")
    arguments = parser.parse_args()
    expected = generate()
    if arguments.check:
        if not OUTPUT.exists() or OUTPUT.read_text() != expected:
            raise SystemExit("route-inventory.md is stale; run scripts/generate-route-inventory.py")
        print("route-inventory.md is current")
    else:
        OUTPUT.write_text(expected)
        print(f"generated {OUTPUT.relative_to(ROOT)}")
