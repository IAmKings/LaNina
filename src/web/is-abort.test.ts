import { describe, expect, it } from "vitest";

import { isAbort } from "./is-abort";

/** Some runtimes throw DOMException on abort; others (undici-style fetch) throw a plain Error. */
function abortError(): Error {
  const error = new Error("The operation was aborted");
  error.name = "AbortError";
  return error;
}

function abortedSignal(): AbortSignal {
  const controller = new AbortController();
  controller.abort();
  return controller.signal;
}

describe("isAbort", () => {
  it("recognizes every runtime shape of an AbortError", () => {
    expect(isAbort(abortError())).toBe(true);
    expect(isAbort(new DOMException("Aborted", "AbortError"))).toBe(true);
  });

  it("treats an already-aborted owning signal as an abort, whatever the error is", () => {
    expect(isAbort(new Error("network down"), abortedSignal())).toBe(true);
    expect(isAbort(undefined, abortedSignal())).toBe(true);
  });

  it("keeps real failures visible when nothing was aborted", () => {
    const controller = new AbortController();
    expect(isAbort(new Error("Public page request failed"), controller.signal)).toBe(false);
    expect(isAbort(new Error("Public page request failed"))).toBe(false);
    expect(isAbort(new DOMException("Timeout", "TimeoutError"))).toBe(false);
    expect(isAbort("fetch failed")).toBe(false);
    expect(isAbort(undefined)).toBe(false);
  });
});
