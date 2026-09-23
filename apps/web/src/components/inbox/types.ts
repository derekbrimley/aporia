export type { InboxView, InboxMessage, InboxThread, AddressBookEntry } from "@/lib/inbox";
export interface DocView { id: string; title: string; shortTitle: string; html: string; anchors: { id: string; ref: string; title: string; level: number }[]; from: string }
export interface Quote { documentId: string; documentTitle: string; ref: string; text: string }
export type Layout = "email" | "even" | "docs";
