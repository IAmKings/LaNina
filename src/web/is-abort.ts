/**
 * Decides whether a caught rejection means "the caller cancelled this request".
 *
 * An aborted `fetch` surfaces as a `DOMException` named `AbortError` in browsers, but runtimes
 * disagree: some throw a plain `Error` with the same name, and an unmount race can also arrive
 * after the signal has already flipped. Checking the name plus the owning signal covers every
 * shape, so component cleanup stays silent instead of rendering a misleading error state.
 */
export function isAbort(error: unknown, signal?: AbortSignal): boolean {
  if (signal?.aborted === true) return true;
  const name = (error as { readonly name?: unknown } | null | undefined)?.name;
  return name === "AbortError";
}
