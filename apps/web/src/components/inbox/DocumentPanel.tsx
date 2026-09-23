"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import type { DocView, Layout, Quote } from "./types";
import { Icon } from "./icons";
import { FlagButton } from "./FlagButton";

/** One document: header pill with Contents and search, Replace, Close; body with selection -> Quote in reply. */
function DocumentView(props: { doc: DocView; canQuote: boolean; onQuote: (q: Quote) => void; onReplace: () => void; onClose: () => void; flagsEnabled: boolean }) {
  const { doc } = props;
  const bodyRef = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState("");
  const [sel, setSel] = useState<{ text: string; ref: string; x: number; y: number } | null>(null);
  const [current, setCurrent] = useState<string>(doc.anchors[0]?.ref ?? "");

  const html = useMemo(() => {
    if (!query.trim()) return doc.html;
    const esc = query.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    // Highlight matches in text nodes only (never inside tags).
    return doc.html.replace(/>([^<]+)</g, (m, text: string) => `>${text.replace(new RegExp(esc, "gi"), (t) => `<mark>${t}</mark>`)}<`);
  }, [doc.html, query]);

  useEffect(() => {
    const el = bodyRef.current;
    if (!el) return;
    const onScroll = () => {
      const sections = Array.from(el.querySelectorAll<HTMLElement>("section[data-ref]"));
      const top = el.getBoundingClientRect().top + 8;
      let ref = sections[0]?.dataset.ref ?? "";
      for (const s of sections) if (s.getBoundingClientRect().top <= top) ref = s.dataset.ref ?? ref;
      setCurrent(ref);
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, [doc.id]);

  function onMouseUp() {
    const s = window.getSelection();
    const text = s?.toString().trim() ?? "";
    if (!s || !text || !bodyRef.current?.contains(s.anchorNode)) { setSel(null); return; }
    let node: Node | null = s.anchorNode;
    let ref = "";
    while (node && node !== bodyRef.current) { if (node instanceof HTMLElement && node.dataset.ref) { ref = node.dataset.ref; break; } node = node.parentNode; }
    const rect = s.getRangeAt(0).getBoundingClientRect();
    const host = bodyRef.current.getBoundingClientRect();
    setSel({ text: text.slice(0, 1500), ref: ref || doc.shortTitle, x: rect.left - host.left, y: rect.top - host.top + bodyRef.current.scrollTop });
  }

  return (
    <div className="flex flex-col flex-1 min-h-0 gap-2.5">
      <div className="flex items-center justify-between gap-3 h-12 px-1 flex-wrap">
        <div className="flex items-center gap-0.5 h-10 pl-3 pr-0.5 rounded-full bg-plum-100 min-w-0">
          <span className="flex text-plum-600"><Icon.file /></span>
          <span className="text-[14px] font-semibold ml-1.5 truncate max-w-[200px]">{doc.shortTitle}</span>
          <label className="sr-only" htmlFor={`contents-${doc.id}`}>Contents</label>
          <select id={`contents-${doc.id}`} className="ml-2 h-8 bg-transparent border-0 text-[13px] text-ink-muted outline-none max-w-[190px]" value={current} onChange={(e) => { setCurrent(e.target.value); const a = doc.anchors.find((x) => x.ref === e.target.value); if (a) bodyRef.current?.querySelector(`#${CSS.escape(a.id)}`)?.scrollIntoView({ block: "start" }); }}>
            {doc.anchors.filter((a) => a.level <= 3).map((a) => <option key={a.id} value={a.ref}>{a.ref === a.title ? a.title : `${a.ref} · ${a.title.slice(0, 40)}`}</option>)}
          </select>
          <button type="button" className="btn btn-ghost btn-sm" onClick={props.onReplace}>Replace</button>
          <button type="button" aria-label={`Close ${doc.shortTitle}`} className="btn btn-ghost" style={{ width: 40, padding: 0 }} onClick={props.onClose}><Icon.close /></button>
        </div>
        <div className="pill-input" style={{ width: 220 }}><Icon.search /><input aria-label={`Search in ${doc.shortTitle}`} placeholder={`Search in ${doc.shortTitle.toLowerCase()}`} value={query} onChange={(e) => setQuery(e.target.value)} /></div>
      </div>
      <div ref={bodyRef} onMouseUp={onMouseUp} onKeyUp={onMouseUp} className="relative flex-1 min-h-0 overflow-auto bg-oat-50 rounded-[14px]" style={{ padding: "40px 48px", boxShadow: "var(--shadow-card)" }}>
        <div dangerouslySetInnerHTML={{ __html: html }} />
        {sel && props.canQuote && (
          <button type="button" className="btn btn-primary absolute" style={{ left: Math.max(8, sel.x), top: Math.max(8, sel.y - 52), boxShadow: "0 8px 20px rgba(38,32,42,0.22)", padding: "0 16px" }} onMouseDown={(e) => e.preventDefault()} onMouseUp={(e) => e.stopPropagation()} onClick={() => { props.onQuote({ documentId: doc.id, documentTitle: doc.shortTitle, ref: sel.ref, text: sel.text }); setSel(null); window.getSelection()?.removeAllRanges(); }}>
            <Icon.quote />Quote in reply
          </button>
        )}
      </div>
      <div className="flex items-center justify-between">
        <a className="btn btn-sm" href={`/api/documents/${doc.id}/print`} target="_blank" rel="noopener">Download PDF</a>
        <FlagButton targetType="document" targetId={doc.id} enabled={props.flagsEnabled} />
      </div>
    </div>
  );
}

export function DocumentPanel(props: {
  open: (DocView | null)[]; library: { id: string; shortTitle: string; title: string; from: string }[]; layout: Layout; onLayout: (l: Layout) => void;
  onOpen: (id: string, slot: 0 | 1) => void; onClose: (slot: 0 | 1) => void; canQuote: boolean; onQuote: (q: Quote) => void; flagsEnabled: boolean; roleOf: (id: string) => string; nameOf: (id: string) => string;
}) {
  const [picker, setPicker] = useState<{ slot: 0 | 1; mode: "compare" | "replace" } | null>(null);
  const docs = props.open.filter(Boolean) as DocView[];
  return (
    <div className="flex flex-col flex-1 min-h-0" style={{ padding: "24px 28px 24px" }}>
      <div className="flex items-center justify-between gap-3 mb-2 no-print">
        <div className="flex items-center gap-1 bg-oat-100 rounded-full border border-oat-400 p-0.5" role="group" aria-label="Layout">
          {([["email", "More email"], ["even", "Even split"], ["docs", "More documents"]] as const).map(([l, label]) => <button key={l} type="button" className="btn btn-sm btn-ghost" aria-pressed={props.layout === l} style={props.layout === l ? { background: "var(--color-plum-100)" } : {}} onClick={() => props.onLayout(l)}>{label}</button>)}
        </div>
        {docs.length === 1 && <button type="button" className="btn btn-sm" onClick={() => setPicker({ slot: 1, mode: "compare" })}>Compare</button>}
      </div>
      {docs.length === 0 && (
        <div className="flex-1 flex flex-col items-center justify-center gap-2.5 p-6 text-center text-ink-muted rounded-[22px]" style={{ border: "1.5px dashed var(--color-oat-500)" }}>
          <span className="flex items-center justify-center w-[52px] h-[52px] rounded-full bg-plum-200 text-plum-600"><Icon.clip /></span>
          <div className="display text-[20px] text-ink">Attachments open here</div>
          <div className="max-w-[300px] text-[14.5px] leading-[1.5]">Open an attachment to read it next to your inbox. Select text to quote it in a reply.</div>
        </div>
      )}
      <div className="flex flex-col flex-1 min-h-0 gap-4">
        {props.open.map((d, i) => d && <DocumentView key={d.id + i} doc={d} canQuote={props.canQuote} onQuote={props.onQuote} flagsEnabled={props.flagsEnabled} onReplace={() => setPicker({ slot: i as 0 | 1, mode: "replace" })} onClose={() => props.onClose(i as 0 | 1)} />)}
      </div>
      {picker && (
        <div role="dialog" aria-modal="true" aria-label={picker.mode === "compare" ? "Pick a second document" : "Replace this document"} className="fixed inset-0 z-40 flex items-center justify-center" style={{ background: "rgba(38,32,42,0.28)" }} onClick={() => setPicker(null)}>
          <div className="card flex flex-col gap-3" style={{ width: 460, maxWidth: "calc(100vw - 32px)" }} onClick={(e) => e.stopPropagation()}>
            <h2 className="display m-0 text-[22px] font-normal">{picker.mode === "compare" ? "Compare: pick a second document" : "Replace with…"}</h2>
            <ul className="m-0 p-0 list-none flex flex-col gap-1">
              {props.library.filter((l) => !docs.some((d) => d.id === l.id)).map((l) => (
                <li key={l.id} className="flex items-center justify-between gap-3 p-2 rounded-[16px] hover:bg-oat-300">
                  <div className="flex items-center gap-2 min-w-0"><span className="text-plum-600 flex"><Icon.file /></span><div className="min-w-0"><div className="text-[15px] truncate">{l.title}</div><div className="text-[12.5px] text-ink-muted">From {props.nameOf(l.from)} · {props.roleOf(l.from)}</div></div></div>
                  <button type="button" className="btn btn-sm" onClick={() => { props.onOpen(l.id, picker.slot); setPicker(null); }}>Open</button>
                </li>
              ))}
            </ul>
            <div className="flex justify-end"><button type="button" className="btn" onClick={() => setPicker(null)}>Cancel</button></div>
          </div>
        </div>
      )}
    </div>
  );
}
