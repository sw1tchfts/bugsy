"""Compile competitor research JSON into the crosswalk page.

Usage: python3 -I build.py <research_dir> <template.html> <out.html>
"""
import json, pathlib, re, sys
from urllib.parse import urlparse

research, template, out = map(pathlib.Path, sys.argv[1:4])

ORDER = [  # pest specialists first, general field-service tools last
    ("pestpac", True), ("fieldroutes", True), ("servsuite", True), ("briostack", True),
    ("pocomos", True), ("gorilladesk", True), ("jobber", False), ("housecall-pro", False),
]

PLAN = {
    "CRM-01": "P1", "CRM-02": "P1", "CRM-03": "P1", "CRM-04": "P1", "CRM-05": "P2", "CRM-06": "P2",
    "CRM-07": "P2", "CRM-08": "P1", "CRM-09": "P1", "CRM-10": "Not planned",
    "AGR-01": "P1", "AGR-02": "P1", "AGR-03": "P1", "AGR-04": "TBD", "AGR-05": "P1", "AGR-06": "P2", "AGR-07": "P1",
    "SCH-01": "P1", "SCH-02": "P1", "SCH-03": "P2", "SCH-04": "P1", "SCH-05": "P3", "SCH-06": "Not planned", "SCH-07": "TBD",
    "MOB-01": "P1", "MOB-02": "P1", "MOB-03": "P1", "MOB-04": "P1", "MOB-05": "P2", "MOB-06": "TBD", "MOB-07": "P2", "MOB-08": "P2",
    "CMP-01": "P1", "CMP-02": "P1", "CMP-03": "P1", "CMP-04": "P1", "CMP-05": "P1", "CMP-06": "P1", "CMP-07": "P2", "CMP-08": "P1",
    "COM-01": "P2", "COM-02": "P2", "COM-03": "P2", "COM-04": "P2", "COM-05": "P2", "COM-06": "P2", "COM-07": "P2",
    "SPC-01": "P2", "SPC-02": "P2", "SPC-03": "P2", "SPC-04": "P1", "SPC-05": "P1",
    "BIL-01": "P1", "BIL-02": "P1", "BIL-03": "P1", "BIL-04": "P1", "BIL-05": "P1", "BIL-06": "P1", "BIL-07": "P1",
    "ACC-01": "P1", "ACC-02": "P2", "ACC-03": "Not planned", "ACC-04": "P1", "ACC-05": "P2", "ACC-06": "P2",
    "CX-01": "P2", "CX-02": "P1", "CX-03": "TBD", "CX-04": "Not planned", "CX-05": "P1",
    "RPT-01": "P1", "RPT-02": "P2", "RPT-03": "P2", "RPT-04": "P3",
    "PLT-01": "P1", "PLT-02": "P1", "PLT-03": "P3", "PLT-04": "P1", "PLT-05": "P3", "PLT-06": "P3", "PLT-07": "Not planned",
}
PLAN_NOTES = {
    "MOB-01": "Installable mobile web app in Phase 1, not a native app",
    "PLT-04": "Spreadsheet import in Phase 1; importers for other pest software in Phase 3",
    "SPC-04": "Lawn rounds and tax in Phase 1 through seasonal programs",
    "SPC-05": "Mosquito seasons in Phase 1 through seasonal programs",
    "MOB-06": "Open question in spec 06",
    "SCH-07": "Open question in spec 05",
    "AGR-04": "Open question in spec 04",
    "CX-03": "Not in the discovery doc yet",
}

def clean(s):
    if not isinstance(s, str):
        return s
    s = s.replace("—", ", ").replace("–", " to ").replace("→", " to ")
    return re.sub(r"\s+,", ",", s).strip()

def safe_url(u):
    if isinstance(u, str) and urlparse(u).scheme in ("http", "https"):
        return u
    return ""

def deep_clean(x):
    if isinstance(x, dict):
        return {k: deep_clean(v) for k, v in x.items()}
    if isinstance(x, list):
        return [deep_clean(v) for v in x]
    return clean(x)

tax = json.loads((research / "feature-taxonomy.json").read_text())
ids = [f["id"] for f in tax["features"]]
assert set(ids) == set(PLAN), set(ids) ^ set(PLAN)

competitors, missing = [], []
for slug, specialist in ORDER:
    p = research / "competitors" / f"{slug}.json"
    if not p.exists():
        missing.append(slug)
        continue
    d = deep_clean(json.loads(p.read_text()))
    got = [f["id"] for f in d["features"]]
    assert got == ids, (slug, set(ids) ^ set(got))
    for f in d["features"]:
        assert f["status"] in tax["status_values"], (slug, f)
        f["source"] = safe_url(f.get("source"))
    for e in d.get("extra_features", []):
        e["source"] = safe_url(e.get("source"))
    d["sources"] = [{"title": s.get("title", ""), "url": safe_url(s.get("url"))} for s in d.get("sources", []) if safe_url(s.get("url"))]
    d["profile"]["pricing_source"] = safe_url(d["profile"].get("pricing_source"))
    d["profile"]["website"] = safe_url(d["profile"].get("website"))
    d["specialist"] = specialist
    d["counts"] = {k: sum(1 for f in d["features"] if f["status"] == k) for k in tax["status_values"]}
    competitors.append(d)

n = len(competitors)
features = []
for f in tax["features"]:
    cells = {c["slug"]: next(x for x in c["features"] if x["id"] == f["id"]) for c in competitors}
    has = sum(1 for c in cells.values() if c["status"] in ("Yes", "Add-on"))
    partial = sum(1 for c in cells.values() if c["status"] == "Partial")
    unknown = sum(1 for c in cells.values() if c["status"] == "Unknown")
    features.append({**f, "plan": PLAN[f["id"]], "plan_note": PLAN_NOTES.get(f["id"], ""),
                     "has": has, "partial": partial, "unknown": unknown})

data = {"researched_on": "2026-10-20", "status_values": tax["status_values"], "features": features,
        "competitors": competitors, "count": n, "missing": missing}
html = template.read_text().replace("/*__DATA__*/null", json.dumps(data, ensure_ascii=False).replace("</", "<\\/"))
out.write_text(html)
print(f"built {out} with {n} competitors; missing: {missing or 'none'}; {len(html)//1024} KB")
for c in competitors:
    print(f"  {c['competitor']:14} {c['counts']}")
