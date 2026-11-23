"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import type { DocView, Layout, Quote } from "./types";
import { Icon } from "./icons";
import { FlagButton } from "./FlagButton";

/** One document: header pill with Contents and search, Replace, Close; body with selection -> Quote in reply. */
function DocumentView(props: { doc: DocView; canQuote: boolean; onQuote: (q: Quote) => void; onReplace: () => void; onClose: () => void; flagsEnabled: boolean; mobile: boolean }) {
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

  // A phone selects text with a long press and drag handles, which fire no mouseup: follow the selection instead.
  useEffect(() => {
    if (!props.mobile) return;
    let t: ReturnType<typeof setTimeout> | undefined;
    const onChange = () => { clearTimeout(t); t = setTimeout(onMouseUp, 250); };
    document.addEventListener("selectionchange", onChange);
    return () => { clearTimeout(t); document.removeEventListener("selectionchange", onChange); };
  }, [props.mobile, doc.id]); // eslint-disable-line react-hooks/exhaustive-deps

  function onMouseUp() {
    const s = window.getSelection();
    const text = s?.toString().trim() ?? "";
    if (!s || !s.rangeCount || !text || !bodyRef.current?.contains(s.anchorNode)) { setSel(null); return; }
    let node: Node | null = s.anchorNode;
    let ref = "";
    while (node && node !== bodyRef.current) { if (node instanceof HTMLElement && node.dataset.ref) { ref = node.dataset.ref; break; } node = node.parentNode; }
    const rect = s.getRangeAt(0).getBoundingClientRect();
    const host = bodyRef.current.getBoundingClientRect();
    // On a phone the system's copy menu sits above the selection, so the button goes below it.
    const y = props.mobile ? rect.bottom - host.top + bodyRef.current.scrollTop + 60 : rect.top - host.top + bodyRef.current.scrollTop;
    setSel({ text: text.slice(0, 1500), ref: ref || doc.shortTitle, x: rect.left - host.left, y });
  }

  return (
    <div className="flex flex-col flex-1 min-h-0 gap-2.5">
      <div className="flex items-center justify-between gap-x-3 gap-y-2 md:min-h-12 px-1 flex-wrap">
        <div className="flex items-center gap-0.5 h-10 pl-3 pr-0.5 rounded-full bg-plum-100 min-w-0 max-w-full">
          <span className="flex text-plum-600"><Icon.file /></span>
          <span className="text-[14px] font-semibold ml-1.5 truncate max-w-[120px] md:max-w-[200px]">{doc.shortTitle}</span>
          <label className="sr-only" htmlFor={`contents-${doc.id}`}>Contents</label>
          <select id={`contents-${doc.id}`} className="ml-2 h-8 min-w-0 bg-transparent border-0 text-[13px] text-ink-muted outline-none max-w-[110px] md:max-w-[190px]" value={current} onChange={(e) => { setCurrent(e.target.value); const a = doc.anchors.find((x) => x.ref === e.target.value); if (a) bodyRef.current?.querySelector(`#${CSS.escape(a.id)}`)?.scrollIntoView({ block: "start" }); }}>
            {doc.anchors.filter((a) => a.level <= 3).map((a) => <option key={a.id} value={a.ref}>{a.ref === a.title ? a.title : `${a.ref} · ${a.title.slice(0, 40)}`}</option>)}
          </select>
          <button type="button" className="btn btn-ghost btn-sm" onClick={props.onReplace}>Replace</button>
          <button type="button" aria-label={`Close ${doc.shortTitle}`} data-tip="Close document" className="btn btn-ghost" style={{ width: 40, padding: 0 }} onClick={props.onClose}><Icon.close /></button>
        </div>
        <div className="pill-input w-full md:w-[220px]"><Icon.search /><input aria-label={`Search in ${doc.shortTitle}`} placeholder={`Search in ${doc.shortTitle.toLowerCase()}`} value={query} onChange={(e) => setQuery(e.target.value)} /></div>
      </div>
      <div ref={bodyRef} onMouseUp={onMouseUp} onKeyUp={onMouseUp} className="relative flex-1 min-h-0 overflow-auto bg-oat-50 rounded-[14px] px-5 py-6 md:px-12 md:py-10" style={{ boxShadow: "var(--shadow-card)" }}>
        <div dangerouslySetInnerHTML={{ __html: html }} />
        {sel && props.canQuote && (
          <button type="button" className="btn btn-primary absolute" style={{ left: Math.max(8, sel.x), top: Math.max(8, sel.y - 52), boxShadow: "0 8px 20px rgba(38,32,42,0.22)", padding: "0 16px" }} onMouseDown={(e) => e.preventDefault()} onMouseUp={(e) => e.stopPropagation()} onClick={() => { props.onQuote({ documentId: doc.id, documentTitle: doc.shortTitle, ref: sel.ref, text: sel.text }); setSel(null); window.getSelection()?.removeAllRanges(); }}>
            <Icon.quote />Quote in reply
          </button>
        )}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <a className="btn btn-sm" href={`/api/documents/${doc.id}/print`} target="_blank" rel="noopener">Download PDF</a>
        <FlagButton targetType="document" targetId={doc.id} enabled={props.flagsEnabled} />
      </div>
    </div>
  );
}

export function DocumentPanel(props: {
  open: (DocView | null)[]; library: { id: string; shortTitle: string; title: string; from: string }[]; layout: Layout; onLayout: (l: Layout) => void;
  onOpen: (id: string, slot: 0 | 1) => void; onClose: (slot: 0 | 1) => void; canQuote: boolean; onQuote: (q: Quote) => void; flagsEnabled: boolean; roleOf: (id: string) => string; nameOf: (id: string) => string;
  /** Phone width: the panel fills the screen, so there is no layout switch and one document at a time. */
  mobile?: boolean;
}) {
  const [picker, setPicker] = useState<{ slot: 0 | 1; mode: "compare" | "replace" } | null>(null);
  const docs = props.open.filter(Boolean) as DocView[];
  return (
    <div className="flex flex-col flex-1 min-h-0" style={{ padding: props.mobile ? "12px 12px calc(12px + env(safe-area-inset-bottom))" : "24px 28px 24px" }}>
      {!props.mobile && <div className="flex items-center justify-between gap-3 mb-2 no-print">
        <div className="flex items-center gap-1 bg-oat-100 rounded-full border border-oat-400 p-0.5" role="group" aria-label="Layout">
          {([["email", "More email", Icon.layoutEmail], ["even", "Even split", Icon.layoutEven], ["docs", "More documents", Icon.layoutDocs]] as const).map(([l, label, LayoutIcon]) => <button key={l} type="button" className="btn btn-sm btn-ghost" aria-label={label} data-tip={label} aria-pressed={props.layout === l} style={{ width: 36, padding: 0, ...(props.layout === l ? { background: "var(--color-plum-100)" } : {}) }} onClick={() => props.onLayout(l)}><LayoutIcon /></button>)}
        </div>
        {docs.length === 1 && <button type="button" className="btn btn-sm" onClick={() => setPicker({ slot: 1, mode: "compare" })}>Compare</button>}
      </div>}
      <div className="flex flex-col flex-1 min-h-0 gap-4">
        {props.open.map((d, i) => d && <DocumentView key={d.id + i} doc={d} canQuote={props.canQuote} onQuote={props.onQuote} flagsEnabled={props.flagsEnabled} mobile={Boolean(props.mobile)} onReplace={() => setPicker({ slot: i as 0 | 1, mode: "replace" })} onClose={() => props.onClose(i as 0 | 1)} />)}
      </div>
      {picker && (
        <div role="dialog" aria-modal="true" aria-label={picker.mode === "compare" ? "Pick a second document" : "Replace this document"} className="fixed inset-0 z-40 flex items-center justify-center" style={{ background: "rgba(38,32,42,0.28)" }} onClick={() => setPicker(null)}>
          <div className="card flex flex-col gap-3" style={{ width: 460, maxWidth: "calc(100vw - 24px)", maxHeight: "calc(100dvh - 24px)", ...(props.mobile ? { padding: 18 } : {}) }} onClick={(e) => e.stopPropagation()}>
            <h2 className="display m-0 text-[22px] font-normal">{picker.mode === "compare" ? "Compare: pick a second document" : "Replace with…"}</h2>
            <ul className="m-0 p-0 list-none flex flex-col gap-1 overflow-auto min-h-0">
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
