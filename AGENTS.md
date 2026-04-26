# multinput — Agent Guidelines

## Project

Collaborative text editor: multiple browsers share one Yjs document over WebSockets, rendered in CodeMirror 6 with per-user colored text and presence awareness.

Stack: TypeScript, Vite, CodeMirror 6, Yjs + y-websocket + y-codemirror.next, Node `ws` server (`server.mjs`). Tests: Playwright (E2E + CSS snapshots) and a Node integration script (`test-collab.mjs`).

## Architecture

Four source modules, each with a single responsibility:

| Module | Responsibility |
|--------|---------------|
| `src/main.ts` | Bootstrap: Y.Doc, WebsocketProvider, DOM wiring, presence list |
| `src/editor.ts` | CodeMirror setup (theme, extensions, yCollab binding) |
| `src/awareness.ts` | User identity (shade selection, name-collision resolution) |
| `src/colors.ts` | Y.Text formatting on insert + CodeMirror mark decorations |

`server.mjs` is a standalone y-websocket-compatible relay (one Y.Doc + Awareness per room). `tests/helpers/ws-server.ts` is its in-process twin for Playwright.

**Keep this architecture flat and simple.** Every module should be understandable in isolation. Prefer fewer abstractions over clever indirection.

## Workflow Rules

### 1. Plan before large changes

If the proposed change touches more than two modules, introduces a new dependency, or reshapes the data flow, **stop and offer to plan first**. Outline the approach, list affected modules, and get confirmation before writing code.

### 2. Test-Driven Development (default)

For any concrete feature or bug fix:

1. Write a failing test first (Playwright E2E in `tests/`, or Node test in `test-collab.mjs`).
2. Confirm it fails.
3. Implement the minimum code to make it pass.
4. Refactor if needed, re-run tests.

**Exception:** when the user is exploring or prototyping something unclear, skip TDD and spike freely. Switch back to TDD once the direction is decided.

### 3. Orchestrator + Sub-agent pattern

The main agent acts as **orchestrator and reviewer**, not implementer:

- Break the task into clear, scoped instructions.
- Dispatch each piece to a sub-agent with explicit requirements (what to change, which files, expected behavior).
- Review the sub-agent's output against the architecture rules below.
- If the result doesn't meet expectations, dispatch another sub-agent with corrective instructions — don't patch inline.

## Code Standards

- Readability over cleverness. A new contributor should understand any module in under 5 minutes.
- No unnecessary abstractions. Don't extract a helper until it's used in two places.
- Preserve the flat module structure. New functionality should fit an existing module or justify a single new one.
- TypeScript strict mode. No `any` unless interfacing with an untyped library boundary.
- CSS lives in `src/style.css`. No CSS-in-JS.

### 4. Keep README.md up-to-date

After completing any change, check whether `README.md` needs updating. If it does, include the update in the same piece of work.

Triggers: new/removed source modules (update file tree and descriptions), changed data flow or dependencies (update Mermaid diagrams), changed npm scripts (update Running section), added/removed libraries (update Key Libraries table), new user-visible behavior (update "What it does").

Match the existing tone — concise, factual, no marketing. Keep Mermaid diagrams accurate. Remove stale sections rather than only appending.

## Running the Project

```
npm run start        # server (background) + vite dev
npm run server       # just the WS server on :1234
npm run dev          # just vite
npm test             # node integration test (needs server on :1234)
npx playwright test  # E2E (starts its own vite + WS server)
```
