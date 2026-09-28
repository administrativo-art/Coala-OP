#!/usr/bin/env python3
"""Check that every dashboard page has one reviewed classification."""

from __future__ import annotations

import csv
import re
from collections import Counter
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "src/app/dashboard"
MATRIX = ROOT / "docs/engineering/flow-matrix.csv"
KINDS = {"active", "navigation", "redirect", "inactive", "special"}


def main() -> None:
    with MATRIX.open(newline="") as handle:
        reader = csv.DictReader(handle)
        required = {"page", "kind", "flow_id", "note"}
        if set(reader.fieldnames or ()) != required:
            raise SystemExit("flow-matrix.csv has unexpected columns")
        rows = list(reader)

    actual = {path.relative_to(ROOT).as_posix() for path in SOURCE.rglob("page.tsx")}
    listed = [row["page"] for row in rows]
    duplicates = [path for path, count in Counter(listed).items() if count != 1]
    missing = actual - set(listed)
    stale = set(listed) - actual
    errors: list[str] = []
    if duplicates:
        errors.append(f"duplicate pages: {duplicates}")
    if missing:
        errors.append(f"unclassified pages: {sorted(missing)}")
    if stale:
        errors.append(f"removed pages still listed: {sorted(stale)}")
    for row in rows:
        page = row["page"]
        kind = row["kind"]
        flow_ids = row["flow_id"].split(";") if row["flow_id"] else []
        source = (ROOT / page).read_text() if page in actual else ""
        if kind not in KINDS:
            errors.append(f"{page}: invalid kind {kind}")
        if kind == "inactive" and flow_ids:
            errors.append(f"{page}: inactive page must not own a flow")
        if kind != "inactive" and (not flow_ids or any(not re.fullmatch(r"[a-z][a-z0-9-]*", flow_id) for flow_id in flow_ids)):
            errors.append(f"{page}: active entry needs a flow ID")
        if kind == "redirect" and not row["note"]:
            errors.append(f"{page}: redirect needs its destination or condition in note")
        if kind == "redirect" and not re.search(r"\bredirect\(|\brouter\.(?:replace|push)\(", source):
            errors.append(f"{page}: redirect no longer appears in source")
        if kind == "inactive" and not re.search(r"return\s+null\s*;", source):
            errors.append(f"{page}: inactive page no longer returns null")
        if kind == "special" and "@" not in page and "(.)" not in page:
            errors.append(f"{page}: special route has no Next.js route marker")
    if errors:
        raise SystemExit("\n".join(errors))
    counts = Counter(row["kind"] for row in rows)
    flows = {flow_id for row in rows for flow_id in row["flow_id"].split(";") if flow_id}
    print(f"{len(rows)} pages classified; {len(flows)} flow groups; {dict(counts)}")


if __name__ == "__main__":
    main()
