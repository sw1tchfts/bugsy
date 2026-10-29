# Background documents

These are for people, and for Claude only when a spec points here. They are not loaded into every session.

- **Discovery spec** (business model, Wisconsin rules research, module answers, open questions): `discovery-spec.md`, exported from the master doc at https://claude.ai/artifact/PZvWbg1f2PkV4NJK7QjFqb. Re-export it after the doc changes.
- **Competitor crosswalk** (PestPac, FieldRoutes, ServSuite, Briostack, Pocomos, GorillaDesk, Jobber, Housecall Pro scored on 80 features): https://claude.ai/artifact/WDcbLu2XcpW3jwVpt5qdLN. Raw research, one JSON file per product with a source per feature, lives in `docs/competitors/`, with the checklist in `feature-taxonomy.json`. When a spec decides scope, check the matching feature IDs there.
- **Data model**: `data-model.md`.

The domain knowledge Claude needs while building lives in skills under `.claude/skills/`, which load only when relevant.
