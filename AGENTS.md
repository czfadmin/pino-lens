# AGENTS.md

Guidance for AI coding agents working in this repository.

## Project Shape

- This is a dual-target VS Code extension:
  - Desktop extension host (Node.js): [src/desktop/extension.ts](src/desktop/extension.ts)
  - Web extension host (browser/WebWorker): [src/web/extension.ts](src/web/extension.ts)
- Entry points are declared in [package.json](package.json):
  - main -> dist/desktop/extension.js
  - browser -> dist/web/extension.js

## First Commands To Run

- Install deps: pnpm install
- Build all: pnpm run compile
- Build desktop only: pnpm run compile:desktop
- Build web only: pnpm run compile:web
- Test desktop: pnpm run test:desktop
- Test web: pnpm run test:web
- Lint: pnpm run lint

## Development Workflow

- Prefer target-specific watch commands while editing:
  - Desktop: pnpm run watch-desktop:tsc and pnpm run watch-desktop:esbuild
  - Web: pnpm run watch-web:tsc and pnpm run watch-web:esbuild
- Keep desktop and web behavior aligned unless a platform-specific difference is intentional.
- When adding a command, update both extension entries if the feature is expected in both hosts.

## Testing Conventions

- Desktop tests live under [src/desktop/test](src/desktop/test).
- Web tests live under [src/web/test/suite](src/web/test/suite).
- Web tests are bundled through the test bundling flow in [esbuild.js](esbuild.js) and executed via [src/web/test/suite/mochaTestRunner.ts](src/web/test/suite/mochaTestRunner.ts).

## Platform Boundaries

- Desktop build uses ES2022 and Node-oriented runtime settings in [tsconfig.node.json](tsconfig.node.json).
- Web build uses ES2020 + WebWorker libs in [tsconfig.web.json](tsconfig.web.json).
- Do not introduce Node-only APIs into web-targeted code.

## Build And Config Notes

- Bundling for both targets is configured in [esbuild.js](esbuild.js).
- Lint rules are configured in [eslint.config.mjs](eslint.config.mjs); keep style consistent with existing rules (curly braces, strict equality, semicolons).
- There is a helper function for shared library bundling in [esbuild.js](esbuild.js) that references src/shares/**; this path is not present in the current workspace. Verify path and usage before relying on it.

## Before Finishing A Change

- Run the most relevant compile command for changed target(s).
- Run the corresponding tests (desktop or web, or both if shared behavior changed).
- Run pnpm run lint when TypeScript files were edited.
