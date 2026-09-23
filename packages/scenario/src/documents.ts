import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { marked, type Token, type Tokens } from "marked";
import type { BuiltDocument, DocumentAnchor, DocumentRegisterEntry } from "./schema.js";

/**
 * Builds a deal document from its source into HTML with stable section anchors
 * and an anchor map, so selection, search and "quote in reply" work reliably.
 *
 * Sources are Markdown today. When attorney-approved .docx files exist, run
 * pandoc (`pandoc in.docx -t gfm`) to produce the Markdown, or extend
 * `readSource` to shell out to pandoc directly. Output is deterministic.
 */

const SECTION_RE = /^(\d+(?:\.\d+)*)\.?\s+(.*)$/; // "6.2 Priority of Security Interest"
const EXHIBIT_RE = /^(Exhibit|Schedule|Annex|Appendix)\s+([A-Z0-9]+)\b\s*[:.–-]?\s*(.*)$/i;
const CLAUSE_RE = /^\(([a-z]|[ivx]+|\d+)\)\s+/; // "(b) ..."

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

interface Section {
  anchor: DocumentAnchor;
  tokens: Token[];
}

export function buildDocumentFromMarkdown(entry: DocumentRegisterEntry, markdown: string): BuiltDocument {
  const tokens = marked.lexer(markdown);
  const sections: Section[] = [];
  let preamble: Token[] = [];
  let current: Section | null = null;
  const seen = new Map<string, number>();
  const uniq = (id: string) => {
    const n = seen.get(id) ?? 0;
    seen.set(id, n + 1);
    return n === 0 ? id : `${id}-${n + 1}`;
  };

  for (const tok of tokens) {
    if (tok.type === "heading" && (tok as Tokens.Heading).depth >= 1) {
      const h = tok as Tokens.Heading;
      const text = h.text.trim();
      let ref = text;
      let id = slug(text);
      let m: RegExpMatchArray | null;
      if ((m = text.match(SECTION_RE))) {
        ref = `Section ${m[1]}`;
        id = `sec-${m[1]!.replace(/\./g, "-")}`;
      } else if ((m = text.match(EXHIBIT_RE))) {
        ref = `${m[1]![0]!.toUpperCase()}${m[1]!.slice(1).toLowerCase()} ${m[2]}`;
        id = slug(`${m[1]}-${m[2]}`);
      } else if (h.depth === 1) {
        ref = text;
        id = "title";
      }
      current = { anchor: { id: uniq(id), ref, title: text, level: h.depth }, tokens: [tok] };
      sections.push(current);
    } else if (current) {
      current.tokens.push(tok);
    } else {
      preamble.push(tok);
    }
  }

  const anchors: DocumentAnchor[] = [];
  const htmlParts: string[] = [];
  const textParts: string[] = [];
  if (preamble.length) {
    htmlParts.push(`<section class="doc-preamble">${marked.parser(preamble)}</section>`);
    textParts.push(tokensText(preamble));
  }
  for (const s of sections) {
    anchors.push(s.anchor);
    const [heading, ...rest] = s.tokens;
    const h = heading as Tokens.Heading;
    const headHtml = `<h${h.depth} class="doc-heading" data-ref="${escapeHtml(s.anchor.ref)}">${marked.parseInline(h.text)}</h${h.depth}>`;
    // Clause-level anchors: paragraphs starting "(b) " get data-ref "Section 6.2(b)".
    const bodyHtml = rest
      .map((t) => {
        if (t.type === "paragraph") {
          const p = t as Tokens.Paragraph;
          const m = p.text.match(CLAUSE_RE);
          if (m && s.anchor.ref.startsWith("Section")) {
            const ref = `${s.anchor.ref}(${m[1]})`;
            const id = uniq(`${s.anchor.id}-${m[1]}`);
            anchors.push({ id, ref, title: p.text.slice(0, 80), level: h.depth + 1 });
            return `<p id="${id}" class="doc-clause" data-ref="${escapeHtml(ref)}">${marked.parseInline(p.text)}</p>`;
          }
        }
        return marked.parser([t]);
      })
      .join("");
    htmlParts.push(`<section id="${s.anchor.id}" class="doc-section" data-ref="${escapeHtml(s.anchor.ref)}">${headHtml}${bodyHtml}</section>`);
    textParts.push(tokensText(s.tokens));
  }
  const html = `<article class="deal-document" data-document-id="${entry.id}">${htmlParts.join("\n")}</article>`;
  return {
    id: entry.id,
    title: entry.title,
    html,
    text: textParts.join("\n\n"),
    anchors,
    source_hash: crypto.createHash("sha256").update(markdown).digest("hex").slice(0, 16),
  };
}

function tokensText(tokens: Token[]): string {
  return tokens
    .map((t) => ("text" in t && typeof (t as { text?: string }).text === "string" ? (t as { text: string }).text : (t as { raw?: string }).raw ?? ""))
    .join("\n")
    .replace(/[*_`#>]/g, "")
    .trim();
}

export function readSource(docsDir: string, entry: DocumentRegisterEntry): string {
  const file = path.join(docsDir, entry.source);
  if (entry.source.endsWith(".md")) return fs.readFileSync(file, "utf8");
  if (entry.source.endsWith(".docx")) {
    // Requires pandoc on PATH; used once attorney-approved .docx files exist.
    const { execFileSync } = require("node:child_process") as typeof import("node:child_process");
    return execFileSync("pandoc", [file, "-t", "gfm", "--wrap=none"], { encoding: "utf8" });
  }
  throw new Error(`Unsupported document source ${entry.source}`);
}

export function buildAllDocuments(scenarioDir: string, register: DocumentRegisterEntry[]): BuiltDocument[] {
  const docsDir = path.join(scenarioDir, "documents");
  return register.map((entry) => buildDocumentFromMarkdown(entry, readSource(docsDir, entry)));
}

/** Writes documents/build/<id>.json for each built document. */
export function writeBuiltDocuments(scenarioDir: string, built: BuiltDocument[]): string {
  const outDir = path.join(scenarioDir, "documents", "build");
  fs.mkdirSync(outDir, { recursive: true });
  for (const b of built) fs.writeFileSync(path.join(outDir, `${b.id}.json`), JSON.stringify(b, null, 2));
  fs.writeFileSync(path.join(outDir, "index.json"), JSON.stringify(built.map((b) => ({ id: b.id, title: b.title, source_hash: b.source_hash, anchors: b.anchors.length })), null, 2));
  return outDir;
}

/** Loads built documents, building on the fly when the build directory is missing (dev convenience). */
export function loadBuiltDocuments(scenarioDir: string, register: DocumentRegisterEntry[]): Map<string, BuiltDocument> {
  const outDir = path.join(scenarioDir, "documents", "build");
  const map = new Map<string, BuiltDocument>();
  const stale = !fs.existsSync(path.join(outDir, "index.json"));
  const built = stale ? buildAllDocuments(scenarioDir, register) : register.map((e) => JSON.parse(fs.readFileSync(path.join(outDir, `${e.id}.json`), "utf8")) as BuiltDocument);
  for (const b of built) map.set(b.id, b);
  return map;
}
