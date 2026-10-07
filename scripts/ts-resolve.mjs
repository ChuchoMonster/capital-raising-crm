/**
 * Let Node run the app's TypeScript directly.
 *
 * Two things the app relies on that plain Node ESM does not do: an import
 * without a file extension, and the `@/` alias for the project root. Both are
 * the bundler's job under Next, and a script that calls app code has no
 * bundler. Rather than keep a second copy of that code in .mjs — which is how
 * a backfill ends up producing something the app would not have produced —
 * this teaches the resolver the same two rules.
 *
 *   node --import ./scripts/ts-resolve.mjs \
 *        --conditions=react-server --experimental-strip-types \
 *        --env-file=.env.local scripts/<something>.ts
 */
import { register } from "node:module";
import { pathToFileURL } from "node:url";

const ROOT = pathToFileURL(process.cwd() + "/").href;

register(
  "data:text/javascript," +
    encodeURIComponent(`
      const ROOT = ${JSON.stringify(ROOT)};
      export async function resolve(specifier, context, next) {
        let s = specifier;
        if (s.startsWith("@/")) s = new URL(s.slice(2), ROOT).href;
        try { return await next(s, context); } catch (e) {
          /* Extensionless: try the file, then the directory index. */
          for (const suffix of [".ts", ".tsx", "/index.ts", "/index.tsx"]) {
            try { return await next(s + suffix, context); } catch { /* keep trying */ }
          }
          throw e;
        }
      }
    `),
  import.meta.url,
);
