import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { closeDb } from "../client.js";
import { exportSession, sessionExportZip } from "../export.js";

// Usage: railway run -s web -- pnpm session:export <session-id> [out-dir]
const [id, outDir = process.env.INIT_CWD ?? "."] = process.argv.slice(2).filter((a) => a !== "--");
if (!id) {
  console.error("Usage: pnpm session:export <session-id> [out-dir]");
  process.exit(1);
}
const x = await exportSession(id);
await closeDb();
if (!x) {
  console.error(`No session ${id}`);
  process.exit(1);
}
const { filename, data } = sessionExportZip(x);
const path = join(outDir, filename);
writeFileSync(path, data);
console.log(`Wrote ${path} (${x.tables.messages.length} emails, ${x.tables.events.length} events, ${(data.length / 1024).toFixed(0)} KB)`);
