/** Handle returned by `observeViewportEntry`; safe to call from effect cleanup. */
export interface ViewportEntryHandle {
  disconnect(): void;
}

/** Chart chunks may start loading slightly before the container scrolls into view. */
const VIEWPORT_ROOT_MARGIN = "200px";

/**
 * Calls `onEnter` once when `element` first approaches the viewport, then detaches itself.
 *
 * Environments without IntersectionObserver (old browsers, non-DOM test environments) invoke
 * `onEnter` immediately: the fallback must never block the chart, only its lazy start depends
 * on the observer being available.
 */
export function observeViewportEntry(element: Element, onEnter: () => void): ViewportEntryHandle {
  if (typeof IntersectionObserver !== "function") {
    onEnter();
    return { disconnect: () => {} };
  }

  const observer = new IntersectionObserver((entries) => {
    if (!entries.some((entry) => entry.isIntersecting)) return;
    observer.disconnect();
    onEnter();
  }, { rootMargin: VIEWPORT_ROOT_MARGIN });
  observer.observe(element);
  return observer;
}
