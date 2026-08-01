# Repository Guidelines

## Project Overview

This repository contains a Hebrew-first, right-to-left financial dashboard. It runs as an Astro 6 SSR application on Vercel, with React 19 islands for interactive UI, Clerk for authentication, Google Sheets v4 as the read-only analytics source, ECharts 6 for charts, and Prisma Next `0.16.0` for PostgreSQL configuration persistence.

Use Node 24.x (see `.nvmrc`) and Bun 1.3 or newer. Do not replace Bun commands with npm-generated lockfiles.

## Project Structure

- `src/pages/` contains Astro routes and authenticated JSON endpoints under `src/pages/api/`.
- `src/layouts/` contains the public base layout and authenticated application shell.
- `src/components/` contains React islands; dashboard-specific components and styles live in `src/components/dashboard/`.
- `src/lib/` contains focused domain modules for Sheets ingestion, dashboard aggregation, encryption, connection persistence, caching, and HTTP helpers.
- `src/prisma/` contains the Prisma Next source contract and generated contract artifacts. `migrations/` contains committed migration artifacts.
- `src/styles/global.css` defines global design tokens and RTL application styling.
- `tests/` contains Bun unit/SSR tests; `tests/e2e/` contains Playwright tests.

Group new code by feature and keep modules focused. Avoid catch-all utility modules and unrelated refactors.

## Development and Verification Commands

- `bun install` — install dependencies from `bun.lock`.
- `bun run dev` — start Astro locally.
- `bun run check` — run Astro and TypeScript diagnostics.
- `bun test` — run the Bun unit and SSR regression suite.
- `bun run test:watch` — run Bun tests in watch mode.
- `bun run test:e2e` — run desktop and mobile Playwright projects.
- `bun run build` — create the production SSR build.
- `bun run test:all` — run checks, unit tests, E2E tests, and the build.
- `bun run contract:emit` — regenerate Prisma Next contract artifacts.
- `bun run migration:plan` — plan a database migration.
- `bun run migrate` — apply committed migrations.
- `bun run db:verify` — verify the database contract and migrations.

Run `nvm use` before local work when the active Node version is not 24.x. Playwright authentication requires development Clerk credentials and `CLERK_TESTING_TOKEN`; database commands require a valid `DATABASE_URL`.

## Architecture and Coding Conventions

Use TypeScript with the repository's strict Astro configuration, two-space indentation, UTF-8, and final newlines. Use `camelCase` for values and functions, `PascalCase` for React components and types, and `kebab-case` for ordinary files and directories. Follow the existing formatting in Astro, TypeScript, and CSS files.

Astro renders on the server. Never access `window`, `document`, `location`, `history`, or browser storage during module initialization or the React render path; gate browser-only work behind client effects or event handlers. Keep interactive behavior in narrowly scoped React islands and server concerns in Astro routes or `src/lib/` modules.

Preserve `lang="he"` and `dir="rtl"` behavior. Use isolated LTR spans and tabular numerals for dates, currency, percentages, IDs, URLs, and masked secrets. Keep desktop and 390px mobile layouts usable without clipping or horizontal overflow.

Protected routes and `/api/*` must continue to enforce Clerk authentication in middleware. API handlers must derive the user identity from Clerk rather than accepting it from request parameters. Keep API responses typed, same-origin, and limited to the documented non-secret DTOs.

Google Sheets remains read-only and is the only analytics source of truth. Do not add CSV fallbacks, spreadsheet writes, or persistence of worksheet rows. PostgreSQL stores per-user connection configuration only. Preserve the required 15-header worksheet contract, sanitized error codes, and the distinction between blank numeric values and numeric zero.

When changing the Prisma contract, regenerate and commit `src/prisma/contract.*` together with the matching `migrations/` artifacts. Pin every Prisma Next package to the same version.

## Testing Guidelines

Add or update tests with every behavior change. Bug fixes require a regression test that reproduces the reported failure. Cover normal, boundary, and failure paths, especially SSR safety, per-user isolation, sheet parsing, KPI formulas, encryption, and secret-free DTOs.

Use Bun tests for domain logic and server-rendering regressions. Use Playwright for routing, Clerk flows, responsive behavior, keyboard interaction, and browser-only integration. Mock Google Sheets in normal automated tests; reserve live Sheets access for an explicitly configured smoke test.

Before handing off code changes, run at minimum `bun run check`, `bun test`, and `bun run build`. Run `bun run test:e2e` when authentication, routing, responsive UI, or browser behavior changes. Run the relevant Prisma verification commands for contract or migration changes. Report commands that were not run and why.

## Security and Configuration

Never commit `.env`, `.env.local`, Clerk secrets, database credentials, Google API keys, or encryption keys. Keep sanitized variable names and examples in `.env.example`. Required runtime configuration includes Clerk keys, `DATABASE_URL`, and a base64-encoded 32-byte `SETTINGS_ENCRYPTION_KEY`.

Google API keys must remain encrypted with AES-256-GCM and bound to the Clerk user ID as authenticated additional data. Never log, render, or return plaintext or encrypted keys. Preserve masked-key behavior and per-user settings isolation. Do not expose raw Clerk backend user objects.

## Commit and Pull Request Guidelines

Preserve unrelated user changes in a dirty worktree. Use concise, imperative commit subjects; Conventional Commit prefixes such as `feat:`, `fix:`, and `docs:` are welcome. Pull requests should summarize behavior and configuration changes, list verification performed, call out migrations or deployment requirements, and include desktop and mobile screenshots for visible UI changes.
