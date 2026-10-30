"""Build the interactive Bugsy PRD site from docs/prd.md and docs/competitors/.

Usage (from the repo root): python3 -I docs/prd-site/build.py

Reads the PRD text, the feature checklist, Bugsy's plan and every competitor
profile; regenerates the feature-plan appendix inside docs/prd.md; writes
docs/prd-site/index.html, the page to publish.
"""
import datetime
import json
import pathlib
import re

ROOT = pathlib.Path(__file__).resolve().parents[2]
COMP_DIR = ROOT / "docs" / "competitors"
PRD = ROOT / "docs" / "prd.md"
SITE = ROOT / "docs" / "prd-site"

# Pest specialists first, general field-service tools last. True marks a pest-focused product.
ORDER = [
    ("pestpac", True), ("fieldroutes", True), ("servsuite", True), ("briostack", True), ("pocomos", True),
    ("fieldwork", True), ("gorilladesk", True), ("jobber", False), ("housecall-pro", False),
]
FORBIDDEN = {chr(0x2014): ", ", chr(0x2013): " to ", chr(0x2192): " to "}
PAGE_RE = re.compile(r"<!--\s*page:\s*([\w-]+)\s*(?:\|\s*(.*?))?\s*-->")
APPENDIX_RE = re.compile(r"(<!-- BEGIN feature-plan -->\n).*?(<!-- END feature-plan -->)", re.S)


def clean(x):
    if isinstance(x, dict):
        return {k: clean(v) for k, v in x.items()}
    if isinstance(x, list):
        return [clean(v) for v in x]
    if isinstance(x, str):
        for bad, good in FORBIDDEN.items():
            x = x.replace(bad, good)
        return re.sub(r"\s+,", ",", x)
    return x


def load():
    tax = json.loads((COMP_DIR / "feature-taxonomy.json").read_text())
    plan = json.loads((COMP_DIR / "bugsy-plan.json").read_text())
    ids = [f["id"] for f in tax["features"]]
    plan_by_id = {f["id"]: f for f in plan["features"]}
    assert ids == [f["id"] for f in plan["features"]], "bugsy-plan.json must list every taxonomy feature in order"
    for f in plan["features"]:
        assert f["plan"] in plan["plans"], f"{f['id']}: unknown plan {f['plan']}"
        assert f["positioning"] in (None, *plan["positioning"]), f"{f['id']}: unknown positioning"
        for s in f["specs"]:
            assert s in plan["specs"], f"{f['id']}: unknown spec {s}"
    features = [{**t, **{k: plan_by_id[t["id"]][k] for k in ("plan", "specs", "positioning", "note")}} for t in tax["features"]]

    comps = []
    for slug, pest in ORDER:
        path = COMP_DIR / f"{slug}.json"
        if not path.exists():
            print(f"skipping {slug}: no profile yet")
            continue
        d = clean(json.loads(path.read_text()))
        by_id = {f["id"]: f for f in d["features"]}
        missing = set(ids) - set(by_id)
        assert not missing, f"{slug} is missing {sorted(missing)}"
        comps.append({
            "slug": slug, "pest": pest, "competitor": d["competitor"],
            "researched_on": d.get("researched_on"), "updated_on": d.get("updated_on"),
            "profile": d.get("profile", {}),
            "features": {i: {k: by_id[i].get(k, "") for k in ("status", "notes", "source")} for i in ids},
            "extra_features": d.get("extra_features", []),
        })
    return tax, plan, clean(features), comps


def appendix(features, comps, plan):
    n = len(comps)
    rows = ["| ID | Feature | Module | Bugsy plan | Specs | Group | Full support (of %d) |" % n,
            "| --- | --- | --- | --- | --- | --- | --- |"]
    for f in features:
        yes = sum(1 for c in comps if c["features"][f["id"]]["status"] == "Yes")
        group = {"wedge": "Wedge", "table-stakes": "Table stakes"}.get(f["positioning"], "")
        rows.append(f"| {f['id']} | {f['feature']} | {f['module']} | {plan['plans'][f['plan']]} | {', '.join(f['specs'])} | {group} | {yes} |")
    return "\n".join(rows) + "\n"


def pages(md):
    marks = list(PAGE_RE.finditer(md))
    out = []
    for i, m in enumerate(marks):
        pid, label = m.group(1), (m.group(2) or m.group(1)).strip()
        end = marks[i + 1].start() if i + 1 < len(marks) else len(md)
        if pid == "none":
            continue
        out.append({"id": pid, "label": label, "markdown": md[m.end():end].strip()})
    return out


def script_json(obj):
    return json.dumps(obj, ensure_ascii=True, separators=(",", ":")).replace("</", "<\\/")


def main():
    tax, plan, features, comps = load()

    md = PRD.read_text()
    new_md, n = APPENDIX_RE.subn(lambda m: m.group(1) + appendix(features, comps, plan) + m.group(2), md)
    assert n == 1, "docs/prd.md needs the feature-plan markers"
    if new_md != md:
        PRD.write_text(new_md)
        print("updated the feature-plan appendix in docs/prd.md")

    data = {
        "generated_on": datetime.date.today().isoformat(),
        "plans": plan["plans"], "specs": plan["specs"],
        "status_values": tax["status_values"],
        "features": features, "competitors": comps,
    }
    page_list = pages(new_md)
    html = (SITE / "template.html").read_text()
    assert "/*__DATA__*/null" in html and "/*__PAGES__*/null" in html
    html = html.replace("/*__DATA__*/null", script_json(data)).replace("/*__PAGES__*/null", script_json(page_list))
    for bad in FORBIDDEN:
        assert bad not in html, "forbidden character in the built page"
    (SITE / "index.html").write_text(html)
    print(f"wrote docs/prd-site/index.html: {len(page_list)} pages, {len(features)} features, {len(comps)} competitors, {len(html) // 1024} KB")


if __name__ == "__main__":
    main()
