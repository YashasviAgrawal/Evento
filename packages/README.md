# Shared packages

Source-only TypeScript shared by `web/` (www.tixit.in) and `dinein/` (dinein.tixit.in).

| Package | What it holds |
| --- | --- |
| `config` | Tailwind preset — the Tixit brand tokens, one source for both apps |
| `session` | API client, in-memory session, cross-app SSO sync, `AuthProvider` / `useAuth` |
| `ui` | Primitives both apps render identically: `cn`, `Button`, `Toast` |

## How apps consume them

There is no install step and nothing is published. Each app maps `@tixit/*` to
`../packages/*/src` in its `tsconfig.json`, and its `next.config.mjs`:

- compiles the files (`experimental.externalDir`), and
- resolves their imports (`react`, `next`, `lucide-react`, …) from **the app's
  own `node_modules`** via `resolve.modules`.

So a package never has its own `node_modules` (never run `npm install` here —
it would create a second React), and each app keeps its independent
`package.json` + lockfile, which is how Hostinger builds them.

Dependencies a package imports are listed as `peerDependencies` in its
`package.json`; every consuming app must have them installed.
