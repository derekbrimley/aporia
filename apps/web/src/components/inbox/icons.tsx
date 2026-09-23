const base = { width: 15, height: 15, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, "aria-hidden": true };
export const Icon = {
  compose: () => <svg {...base}><path d="M4 20h4L19 9l-4-4L4 16z" /></svg>,
  search: () => <svg {...base}><circle cx="11" cy="11" r="6.5" /><path d="m20 20-4-4" /></svg>,
  file: () => <svg {...base} width={16} height={16}><path d="M7 3h7l5 5v13H7z" /><path d="M14 3v5h5" /></svg>,
  flag: () => <svg {...base} width={14} height={14}><path d="M5 21V4h11l-2 4 2 4H5" /></svg>,
  reply: () => <svg {...base} width={16} height={16}><path d="M9 14 4 9l5-5" /><path d="M4 9h10a6 6 0 0 1 6 6v3" /></svg>,
  send: () => <svg {...base} strokeWidth={2}><path d="M5 12h14M13 6l6 6-6 6" /></svg>,
  close: () => <svg {...base} width={13} height={13} strokeWidth={2}><path d="m6 6 12 12M18 6 6 18" /></svg>,
  quote: () => <svg {...base}><path d="M9 8H6v5h3l-1 4M18 8h-3v5h3l-1 4" /></svg>,
  library: () => <svg {...base} width={17} height={17}><path d="M4 5h5v14H4zM10 5h5v14h-5z" /><path d="m16 6 4-1 3 13-4 1z" /></svg>,
  clip: () => <svg {...base} width={24} height={24} strokeWidth={1.6}><path d="M20 11.5 12.5 19a5 5 0 0 1-7-7l8-8a3.5 3.5 0 0 1 5 5l-8 8a2 2 0 0 1-3-3l7-7" /></svg>,
  lock: () => <svg {...base} width={16} height={16}><rect x="5" y="11" width="14" height="9" rx="2" /><path d="M8 11V8a4 4 0 0 1 8 0v3" /></svg>,
  chevron: () => <svg {...base} width={13} height={13}><path d="m6 9 6 6 6-6" /></svg>,
};
