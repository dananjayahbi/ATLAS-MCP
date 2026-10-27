/**
 * Doc 07 §15.1 — local smoke runner for the document contracts.
 *
 * Runs the same check list as `vitest` without loading PostCSS/Tailwind, so it
 * works even when the Vite config chain is broken.
 *
 *   node --experimental-strip-types lib/canvas/__tests__/run-checks.mts
 */
import { runDocumentChecks } from "./document-checks.ts";

const results = runDocumentChecks();
for (const result of results) {
  const status = result.ok ? "PASS" : "FAIL";
  console.log(`${status}  ${result.name}${result.ok ? "" : ` — ${result.detail ?? ""}`}`);
}
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exitCode = failed.length === 0 ? 0 : 1;
