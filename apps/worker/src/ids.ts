import crypto from "node:crypto";

/** Deterministic UUID from parts, so a retried job produces the same message id. */
export function derivedUuid(...parts: string[]): string {
  const h = crypto.createHash("sha256").update(parts.join("\u0000")).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-${((parseInt(h[16]!, 16) & 0x3) | 0x8).toString(16)}${h.slice(17, 20)}-${h.slice(20, 32)}`;
}
