import { afterEach, describe, expect, it, vi } from "vitest";

import { observeViewportEntry } from "./viewport-entry";

/**
 * Minimal IntersectionObserver stand-in that records construction options and lets tests decide
 * when (and whether) entries are reported, mirroring the browser contract that the first callback
 * always fires with the current intersection state.
 */
class FakeIntersectionObserver {
  static instances: FakeIntersectionObserver[] = [];

  readonly observedElements: Element[] = [];
  readonly rootMargin: string | undefined;
  disconnected = false;

  constructor(
    private readonly callback: IntersectionObserverCallback,
    options?: IntersectionObserverInit,
  ) {
    this.rootMargin = options?.rootMargin;
    FakeIntersectionObserver.instances.push(this);
  }

  observe(element: Element): void {
    this.observedElements.push(element);
  }

  disconnect(): void {
    this.disconnected = true;
  }

  unobserve(): void {}

  report(isIntersecting: boolean): void {
    if (this.disconnected) return;
    this.callback(
      [{ isIntersecting } as IntersectionObserverEntry],
      this as unknown as IntersectionObserver,
    );
  }
}

function lastFake(): FakeIntersectionObserver {
  const instance = FakeIntersectionObserver.instances.at(-1);
  if (instance === undefined) throw new Error("no observer was constructed");
  return instance;
}

describe("observeViewportEntry", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    FakeIntersectionObserver.instances = [];
  });

  it("observes the element with a 200px root margin and fires once on entering, then detaches", () => {
    vi.stubGlobal("IntersectionObserver", FakeIntersectionObserver);
    const element = {} as Element;
    const onEnter = vi.fn();

    const handle = observeViewportEntry(element, onEnter);

    expect(lastFake().observedElements).toEqual([element]);
    expect(lastFake().rootMargin).toBe("200px");
    expect(onEnter).not.toHaveBeenCalled();

    lastFake().report(false);
    expect(onEnter).not.toHaveBeenCalled();

    lastFake().report(true);
    expect(onEnter).toHaveBeenCalledTimes(1);
    expect(lastFake().disconnected).toBe(true);

    // A late duplicate entry after the internal disconnect must not retrigger the load.
    lastFake().report(true);
    expect(onEnter).toHaveBeenCalledTimes(1);

    handle.disconnect();
    expect(lastFake().disconnected).toBe(true);
  });

  it("never fires after the caller disconnects (effect cleanup)", () => {
    vi.stubGlobal("IntersectionObserver", FakeIntersectionObserver);
    const onEnter = vi.fn();

    const handle = observeViewportEntry({} as Element, onEnter);
    handle.disconnect();

    lastFake().report(true);
    expect(onEnter).not.toHaveBeenCalled();
  });

  it("loads immediately when IntersectionObserver is unavailable, with a safe disconnect", () => {
    // The node test environment has no IntersectionObserver global unless stubbed.
    expect(typeof IntersectionObserver).toBe("undefined");
    const onEnter = vi.fn();

    const handle = observeViewportEntry({} as Element, onEnter);

    expect(onEnter).toHaveBeenCalledTimes(1);
    expect(() => handle.disconnect()).not.toThrow();
  });
});
