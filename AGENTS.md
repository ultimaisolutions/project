# Repository Guidelines

## Project Structure & Module Organization

This repository is currently an early scaffold. The root contains environment files, Vercel project metadata in `.vercel/`, and agent-skill configuration in `skills-lock.json` plus tool-specific directories such as `.agents/`, `.claude/`, and `.goose/`. No application source, test suite, or asset directory has been committed yet.

When adding the application, keep runtime code in `src/`, tests in `tests/` or beside modules as `*.test.*`, and static files in `public/` or `assets/`. Group code by feature rather than creating large catch-all utility folders. Update this guide when the chosen framework establishes a different layout.

## Build, Test, and Development Commands

There is currently no package manifest, Makefile, or build configuration, so no canonical build or test commands exist. Contributors should add the relevant scripts with the first application scaffold and document them here. Prefer a small, predictable command surface, for example:

- `npm run dev` — start the local development server.
- `npm run build` — create a production build.
- `npm test` — run the automated test suite.
- `npm run lint` — check formatting and static-analysis rules.

Do not claim a change is verified until the commands actually exist and pass locally.

## Coding Style & Naming Conventions

Follow the formatter and linter configured by the eventual framework. Until then, use two-space indentation for JSON, YAML, JavaScript, and TypeScript; UTF-8 files; and a final newline. Use `camelCase` for variables/functions, `PascalCase` for components/classes, and `kebab-case` for ordinary file and directory names. Keep modules focused and avoid unrelated refactors in feature changes.

## Testing Guidelines

Add tests with each behavior change. Name tests after the unit under test (for example, `src/auth/session.test.ts`) and cover normal, boundary, and failure paths. Bug fixes should include a regression test. Once a test framework is selected, record its coverage command and any enforced threshold here.

## Commit & Pull Request Guidelines

No commit history is available to establish a repository-specific convention. Use concise, imperative subjects such as `Add session validation`; optional Conventional Commit prefixes (`feat:`, `fix:`, `docs:`) are encouraged. Pull requests should explain the change and verification performed, link relevant issues, and include screenshots for visible UI changes. Keep each PR narrowly scoped and call out configuration or migration steps.

## Security & Configuration

Never commit `.env` or `.env.local` values. Provide sanitized examples through `.env.example`, document required variables, and keep Vercel credentials and generated metadata out of review unless intentionally changed.
