import type { InboxMessage } from "./types";

const fmt = (iso: string) => new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });

/** A forwarded email, quoted beneath the note, the way a mail client shows it. */
export function Forwarded({ message, nameOf, docTitle, onOpenDoc }: {
  message: InboxMessage; nameOf: (id: string) => string; docTitle: (id: string) => string; onOpenDoc?: (id: string) => void;
}) {
  const who = (id: string) => (id === "associate" ? "You" : nameOf(id));
  return (
    <div className="quote flex flex-col gap-2" aria-label="Forwarded message">
      <div className="text-[12px] text-ink-muted flex flex-col gap-0.5">
        <span className="font-semibold uppercase tracking-[0.08em]">Forwarded message</span>
        <span>From {who(message.from)} · {fmt(message.at)}</span>
        <span>Subject: {message.subject}</span>
        <span>To {message.to.map(who).join(", ")}{message.cc.length > 0 && <> · Cc {message.cc.map(who).join(", ")}</>}</span>
      </div>
      <div className="email-body text-[14.5px]">{message.body}</div>
      {message.attachments.length > 0 && (
        <div className="text-[12.5px] text-ink-muted">
          Attachments:{" "}
          {message.attachments.map((d, i) => (
            <span key={d}>{i > 0 && ", "}{onOpenDoc ? <button type="button" className="underline" onClick={() => onOpenDoc(d)}>{docTitle(d)}</button> : docTitle(d)}</span>
          ))}
        </div>
      )}
    </div>
  );
}
