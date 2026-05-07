import type { RefObject } from "react";

export function registerStopCardRef(
  stopCardRefs: RefObject<Map<string, HTMLElement>>,
  leaderId: string,
  element: HTMLElement | null,
) {
  if (element) {
    stopCardRefs.current.set(leaderId, element);
  } else {
    stopCardRefs.current.delete(leaderId);
  }
}
