import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

/**
 * Unit tests for the rules in app/lib.
 *
 * No database, no network, no secrets: anything that would reach Postgres,
 * Microsoft Graph or the Anthropic API is mocked inside the test that needs it.
 *
 * `server-only` throws on import outside a React Server Components bundle,
 * which is its job in the app. Here there is no bundle, so it is swapped for
 * an empty module.
 */
const root = fileURLToPath(new URL("./", import.meta.url));

export default defineConfig({
  resolve: {
    alias: [
      { find: /^server-only$/, replacement: `${root}tests/stubs/server-only.ts` },
      { find: /^@\//, replacement: root },
    ],
  },
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
    restoreMocks: true,
    unstubEnvs: true,
    unstubGlobals: true,
  },
});
