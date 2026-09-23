import fs from "node:fs";
import path from "node:path";

let loaded = false;

/**
 * Loads the repo-root `.env` (walking up from cwd) into process.env for CLIs
 * and the worker. Existing variables win; Next.js loads .env on its own.
 */
export function loadEnv(): void {
  if (loaded) return;
  loaded = true;
  let dir = process.cwd();
  for (let i = 0; i < 6; i++) {
    const file = path.join(dir, ".env");
    if (fs.existsSync(file)) {
      for (const raw of fs.readFileSync(file, "utf8").split("\n")) {
        const line = raw.trim();
        if (!line || line.startsWith("#")) continue;
        const eq = line.indexOf("=");
        if (eq < 0) continue;
        const key = line.slice(0, eq).trim();
        let value = line.slice(eq + 1).trim().replace(/\s+#.*$/, "");
        if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
        if (process.env[key] === undefined && value !== "") process.env[key] = value;
      }
      return;
    }
    const parent = path.dirname(dir);
    if (parent === dir) return;
    dir = parent;
  }
}
