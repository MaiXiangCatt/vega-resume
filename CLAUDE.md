# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

VegaResume is an open-source Chinese resume online builder. It's a full-stack monorepo with JS (frontend + CLI) and Go (backend), orchestrated through a custom "vega harness" system that drives AI-assisted development via Skills + state machine + CLI.

## Commands

All commands go through the root `Makefile`. Do not call `pnpm` or `go` directly.

```bash
make install          # Install all deps (JS + Go) and link vega CLI globally
make lint             # Full lint (web + server + cli)
make test             # Full unit tests (web + server + cli)
make tdd-check        # Run all tests, exit 1 on failure
make e2e              # Playwright E2E tests
make build            # Full build (web + server + cli)

# Per-target
make test-web         # Vitest + RTL (apps/web)
make test-server      # Go test (apps/server)
make test-cli         # Vitest (packages/vega-cli)
make lint-web         # ESLint + tsc
make lint-server      # go vet + golangci-lint
make dev-web          # Vite dev server
make dev-server       # Go API server

# Contracts
make spec-check       # OpenSpec vs OpenAPI consistency
make generate         # Generate TS client (orval) + Go stubs (oapi-codegen)

# Vega CLI
make vega-build       # Build vega CLI
make vega-link        # pnpm link --global
```

## Architecture

### Monorepo Structure

- **`apps/web/`** — Vite + React + TypeScript frontend (pnpm workspace)
- **`apps/server/`** — Go + Gin backend (independent `go.mod`, NOT in pnpm)
- **`packages/vega-cli/`** — Node.js CLI tool for harness workflow (pnpm workspace, `@vega-resume/vega-cli`)
- **`contracts/openapi/`** — OpenAPI 3.1 specs, the only bridge between JS and Go
- **`openspec/`** — OpenSpec config and spec artifacts (Fission-AI/OpenSpec)
- **`.vega-harness/`** — Requirement state files and workflow artifacts (data only, no skills)
- **`.claude/skills/`** — Skill files for this agent

### Language Boundary

JS and Go are physically isolated. `pnpm-workspace.yaml` covers `apps/*` + `packages/*`, but `apps/server/` has no `package.json` — pnpm ignores it. Go deps are managed solely by `apps/server/go.mod`. The Makefile bridges both ecosystems.

### Frontend Five-Layer Architecture (`apps/web/src/`)

Strict layering rules — do not violate these boundaries:

- **`ui/`** — View rendering and event forwarding only. No direct `services` calls or `store` mutations; bridge through `hooks`.
- **`hooks/`** — Custom React hooks orchestrating `services` and `store`. Handles page-level effects and flows.
- **`services/`** — Pure business logic and API calls. No UI deps. Must run in Node.js/test environments.
- **`store/`** — Zustand state definitions. No complex logic, only state + pure actions.
- **`models/`** — TS types/interfaces and pure transform functions only. Zero side effects.

### Vega Harness System

Development is driven by a state machine with two workflow tracks:
- **Lite:** `init → brainstorm → openspec → implementation → verification → archive`
- **Full:** `init → brainstorm → tech_design → breakdown → openspec → implementation → verification → archive`

State files live in `.vega-harness/requirements/<name>.json`. The `vega` CLI operates the state machine. Skills in `.claude/skills/` define what to do at each phase.

Key CLI commands: `vega requirement status --json`, `vega next --json`, `vega complete`, `vega retry`.

### Contract-Driven Development

API changes follow: OpenSpec four-piece set → OpenAPI 3.1 contract → `make generate` (orval for TS client, oapi-codegen for Go stubs) → TDD implementation.

## Tech Stack

| Layer | Tech |
|-------|------|
| Frontend | Vite + React + TypeScript + Tailwind CSS + shadcn/ui |
| State | TanStack Query (server) + Zustand (local) |
| Backend | Go + Gin |
| Database | PostgreSQL + JSONB |
| Auth | JWT + bcrypt |
| CLI | Node.js + commander.js + tsdown |
| Testing | Vitest + RTL + Playwright + Go test |

## Key Constraints

- Before implementing any feature, produce the OpenSpec four-piece set (proposal, design, spec, tasks) and confirm the OpenAPI contract.
- TDD: write failing tests first, then implement. `make tdd-check` must pass before marking a phase complete.
- `apps/server/` must never contain `package.json`. `packages/vega-cli/` must never contain `go.mod`.
- pnpm filter for the CLI uses the scoped name: `pnpm --filter @vega-resume/vega-cli`.
