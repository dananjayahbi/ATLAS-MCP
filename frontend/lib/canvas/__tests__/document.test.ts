/**
 * Doc 07 §15.1 — vitest entry point for the document contracts (T-DOC-01..03).
 *
 * Assertions live in `document-checks.ts` so the same list can run without a
 * test runner during a local smoke check.
 */
import { describe, expect, it } from "vitest";
import { runDocumentChecks } from "./document-checks";

describe("canvas document", () => {
  it("produces a non-empty check list", () => {
    expect(runDocumentChecks().length).toBeGreaterThan(0);
  });

  for (const result of runDocumentChecks()) {
    it(result.name, () => {
      expect(result.detail ?? "").toBe("");
      expect(result.ok).toBe(true);
    });
  }
});
