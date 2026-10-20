# Background documents

These are for people, and for Claude only when a spec points here. They are not loaded into every session.

- **Discovery spec** (business model, Wisconsin rules research, module answers, open questions): https://claude.ai/code/artifact/b6c1d3fb-9dca-41ea-ba70-2f67277669ba. To keep a copy in the repo, export it from the doc as Markdown and save it here as `discovery.md`.
- **Competitor crosswalk** (PestPac, FieldRoutes, ServSuite, Briostack, Pocomos, GorillaDesk, Jobber, Housecall Pro scored on 81 features): https://claude.ai/artifact/WDcbLu2XcpW3jwVpt5qdLN. Raw research, one JSON file per product with a source per feature, lives in `docs/competitors/`, with the checklist in `feature-taxonomy.json`. When a spec decides scope, check the matching feature IDs there.
- **Data model**: `data-model.md`.

The domain knowledge Claude needs while building lives in skills under `.claude/skills/`, which load only when relevant.
