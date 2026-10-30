# Background documents

These are for people, and for Claude only when a spec points here. They are not loaded into every session.

- **PRD** (first tenant, market, competitors, the feature list, Phase 1 requirements, pricing, rollout, risks, decisions): `prd.md` is the source of truth. The interactive PRD at https://claude.ai/artifact/1BayEPBwd84ASPVhq3AZK6 is built from it and from `competitors/` by `python3 -I docs/prd-site/build.py`; republish `prd-site/index.html` to the same link after rebuilding.
- **Feature list and competitor crosswalk**: one checklist of 80 features in `competitors/feature-taxonomy.json`, Bugsy's plan for each in `competitors/bugsy-plan.json`, and one JSON profile per competitor (nine products, a source behind every score). The PRD site's Features and Competitors pages show them. When a spec decides scope, check the matching feature IDs and update `bugsy-plan.json`.
- **Discovery spec** (business model, Wisconsin rules research, module answers, open questions): `discovery-spec.md`, exported from the master doc at https://claude.ai/artifact/PZvWbg1f2PkV4NJK7QjFqb. Re-export it after the doc changes.
- **Competitor research, October 29, 2026**: sourced notes in `../research_notes/Competitor research vs Bugsy PRD/` and the comparison report in `../reports/`.
- **Data model**: `data-model.md`.

Superseded: the October 29 PRD Claude Doc and the October 20 crosswalk page. The PRD site replaces both.

The domain knowledge Claude needs while building lives in skills under `.claude/skills/`, which load only when relevant.
