/**
 * Doc 07 §15.1 — the single entry point for the canvas self-checks.
 *
 * Usage (from `frontend/`):
 *   node_modules\.bin\esbuild lib\canvas\__tests__\run-checks.mts ^
 *     --bundle --platform=node --format=esm ^
 *     --outfile=lib\canvas\__tests__\checks.mjs
 *   node lib\canvas\__tests__\checks.mjs
 *
 * Runs each suite in its own module scope so a failure reports its origin.
 */
import "./document-checks";
import "./engine-checks";
