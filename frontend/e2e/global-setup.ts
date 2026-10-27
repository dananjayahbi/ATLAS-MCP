import { execFileSync } from "node:child_process";
import path from "node:path";

/**
 * Doc 10 §4 — the E2E harness must be able to run on a database that a human has
 * already triaged. `seed_demo.py` is idempotent for projects but the triage
 * fixtures are consumed by the tests themselves, so we re-propose them whenever
 * the inbox is empty.
 */

const FRONTEND = __dirname;
const REPO = path.resolve(FRONTEND, "..");
const PYTHON = process.env.ATLAS_PYTHON ?? path.join(REPO, ".venv", "Scripts", "python.exe");
const API = process.env.ATLAS_API_URL ?? "http://127.0.0.1:8471";

async function inboxCount(): Promise<number> {
  try {
    const response = await fetch(`${API}/api/v1/discoveries/`, {
      headers: { Authorization: `Bearer ${process.env.ATLAS_API_TOKEN ?? ""}` },
    });
    if (!response.ok) return 0;
    const body = (await response.json()) as { items?: unknown[] };
    return body.items?.length ?? 0;
  } catch {
    return 0;
  }
}

export default async function globalSetup(): Promise<void> {
  // Create the alpha/beta demo projects if this is a fresh database.
  try {
    execFileSync(PYTHON, [path.join(REPO, "scripts", "seed_demo.py")], {
      cwd: REPO,
      stdio: "pipe",
      env: { ...process.env, PYTHONPATH: path.join(REPO, "backend") },
    });
  } catch {
    // A non-zero exit means "already seeded" in some paths; the tests decide.
  }

  if ((await inboxCount()) > 0) return;

  try {
    execFileSync(PYTHON, [path.join(REPO, "scripts", "seed_discoveries.py")], {
      cwd: REPO,
      stdio: "pipe",
      env: { ...process.env, PYTHONPATH: path.join(REPO, "backend") },
    });
  } catch {
    // Leave the assertion to fail loudly if seeding is impossible.
  }
}
