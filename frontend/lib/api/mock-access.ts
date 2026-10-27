import { db, type MockDb } from "./mock-store";

/** Read-only handle for tests and diagnostics; mutations go through `resolveMockRequest`. */
export function getMockDb(): MockDb {
  return db;
}
