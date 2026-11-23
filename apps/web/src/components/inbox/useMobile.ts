"use client";
import { useSyncExternalStore } from "react";

/** Phone width: below Tailwind's md breakpoint, where the inbox shows one pane at a time. */
export const MOBILE_QUERY = "(max-width: 767px)";

function subscribe(onChange: () => void) {
  const mq = window.matchMedia(MOBILE_QUERY);
  mq.addEventListener("change", onChange);
  return () => mq.removeEventListener("change", onChange);
}

/** True on a phone-width screen. Always false on the server, where the inbox isn't rendered anyway. */
export function useMobile() {
  return useSyncExternalStore(subscribe, () => window.matchMedia(MOBILE_QUERY).matches, () => false);
}
