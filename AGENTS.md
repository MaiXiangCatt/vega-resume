# Repository Guidelines

## Project Structure & Module Organization

Vega Resume is a pnpm monorepo with a separate Go service. `apps/web/` contains the Vite React TypeScript frontend; source lives in `apps/web/src/`, with images and SVGs in `apps/web/src/assets/`. `apps/server/` contains the Go API entry point under `cmd/api/` and manages dependencies with its own `go.mod`. `packages/vega-cli/` contains the Node CLI package, with implementation in `src/` and Vitest tests in `tests/`. Product and design notes live in `docs/`, and OpenSpec configuration starts in `openspec/`.

## Build, Test, and Development Commands

Use the root `Makefile` as the main command surface:

- `make install` installs pnpm dependencies, downloads Go modules, and links the local `vega` CLI.
- `make dev-web` starts the Vite frontend dev server.
- `make dev-server` runs the Go API server.
- `make build` runs the full web, server, and CLI build pipeline.
- `make test` runs all configured test targets; use `make test-cli` for the currently implemented CLI Vitest suite.
- `make lint` runs all lint targets. If adding new package scripts, keep Makefile targets in sync.

## Coding Style & Naming Conventions

TypeScript uses ES modules, React function components, and strict TypeScript configs. Follow the existing two-space indentation style, single quotes, and extension-aware imports used in `apps/web/src/` and `packages/vega-cli/src/`. React components should use `PascalCase`; hooks should use `useCamelCase`; tests should use `*.test.ts` or `*.test.tsx`. Go code must be formatted with `gofmt` and should stay under `apps/server/`; do not add a `package.json` there.

## Testing Guidelines

CLI tests use Vitest and live in `packages/vega-cli/tests/`. Server tests should use Go's standard `testing` package next to the package being tested. Frontend tests are expected to use Vitest and React Testing Library when added. Prefer focused tests for new behavior and run the relevant Make target before opening a PR.

## Commit & Pull Request Guidelines

Recent commits use short Conventional Commit-style subjects such as `feat: init project` and `docs: update structure`. Use `feat:`, `fix:`, `docs:`, `test:`, or `chore:` with a concise imperative summary. PRs should include a clear description, linked issue or requirement when applicable, test results, and screenshots for UI changes.

## Agent-Specific Instructions

For library, framework, SDK, API, CLI, or cloud-service questions, fetch current docs with `npx ctx7@latest library <name> "<question>"`, then `npx ctx7@latest docs <libraryId> "<question>"`. Prefer Makefile targets over ad hoc package commands when modifying this repo.
