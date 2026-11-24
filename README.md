# Agent Path Explorer

A single-page, simulated map of how an AI agent request travels end to end: trigger, channel,
agent runtime, model backend, tool layer and data platform. It shows how the **identity
choice** (API key, M2M, managed identity, workload federation, OBO, stored consent, token
passthrough) changes every hop: the credential on the wire, the token claims, the permission
check, the result, the audit trail and the blast radius.

Everything lives in one pattern library:

- **Identity paths** (interactive card, shown first). The map, with optional **AI gateway** (in front of the model providers)
  and **API gateway** (in front of tool and data backends such as Snowflake and Databricks).
  Each gateway can forward the caller's token, swap it for its own identity, or (API gateway
  only) do an OBO exchange so the user survives. A token card shows claims changing hop by
  hop.
- **Sequence patterns.** Animated, step-through sequence diagrams of 35 agent patterns across
  orchestration, identity (MCP OAuth, Entra Agent ID, CIBA, ID-JAG, token exchange), data
  (RAG, permission-trimmed RAG, text-to-SQL, memory), security (lethal trifecta, tool
  poisoning, confused deputy, sandboxing) and platform (A2A, OpenTelemetry, gateway fallback).
  Each pattern has good and bad variants, sources, and unverified claims flagged.

The tool is written for experienced practitioners. Nothing calls a real service, and every
token and identifier is fictional.

## Run locally

```bash
npm install
npm run dev      # http://localhost:5173
npm test         # rules-engine and content tests
npm run build    # static site in dist/
```

## Layout

| Path | What it holds |
|---|---|
| `src/model/catalog.ts` | Nodes on the map and identity modes |
| `src/model/hops/` | Per-hop rules and content: inbound, model backends, MCP, platforms |
| `src/model/engine.ts` | Resolves a selection into hops and marks unreached ones |
| `src/model/tours.ts` | Guided scenarios |
| `src/model/sources.ts` | Public documents each hop cites |
| `src/model/hops/gateways.ts` | AI and API gateway hops (forward, swap, exchange) |
| `src/patterns/` | Pattern types, validator and content (`content/*.ts`) |
| `src/ui/` | SVG map, inspector, token card, pattern library and sequence player, URL-hash state |
| `docs/concept.md` | Design concept and roadmap |
| `docs/backlog.md` | Patterns planned but not built yet |

To add a platform, add a node to `catalog.ts`, a layout position in `src/ui/map.ts`, and a
resolver in `src/model/hops/platforms.ts`. The tests check every combination resolves and
cites a source.

To add a pattern, add an object to the matching file in `src/patterns/content/`. The tests run
`validatePattern` on every pattern.

## Deploy

`.github/workflows/deploy.yml` tests, builds and publishes `dist/` to GitHub Pages on every
push to `main`. In the repository settings, set Pages → Source to "GitHub Actions".

## Licence

Code: MIT ([LICENSE](LICENSE)). Content: CC BY 4.0 ([LICENSE-CONTENT.md](LICENSE-CONTENT.md)).
This project does not accept outside contributions.
