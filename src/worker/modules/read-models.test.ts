import { describe, expect, it } from "vitest";

import { EMPTY_PUBLIC_CHANGES_QUERY, parsePublicChangesQuery } from "./read-models";

function parse(query: string) {
  return parsePublicChangesQuery(new URLSearchParams(query));
}

describe("parsePublicChangesQuery", () => {
  it("treats an empty query as no filter", () => {
    expect(parse("")).toEqual(EMPTY_PUBLIC_CHANGES_QUERY);
    expect(parse("cursor=%7B%7D")).toEqual(EMPTY_PUBLIC_CHANGES_QUERY);
  });

  it("accepts every public category filter and trims nothing silently", () => {
    for (const category of ["climate", "rubber", "agriculture", "shipping"]) {
      expect(parse(`category=${category}`)).toMatchObject({ category });
    }
    expect(parse("category=energy")).toBeNull();
    expect(parse("category=RUBBER")).toBeNull();
  });

  it("accepts a bounded thesis id and rejects malformed ones", () => {
    expect(parse("thesis=RUBBER-TH-01")).toMatchObject({ thesisId: "RUBBER-TH-01" });
    expect(parse("thesis=")).toBeNull();
    expect(parse("thesis=-leading-dash")).toBeNull();
    expect(parse(`thesis=${"x".repeat(129)}`)).toBeNull();
  });

  it("requires canonical UTC bounds inside a valid window", () => {
    const from = "2026-09-01T00:00:00.000Z";
    const to = "2026-09-10T00:00:00.000Z";
    expect(parse(`from=${from}&to=${to}`)).toMatchObject({ from, to });
    expect(parse("from=2026-09-01")).toBeNull();
    expect(parse("from=2026-09-01T00:00:00Z")).toBeNull();
    expect(parse(`from=${to}&to=${from}`)).toBeNull();
  });

  it("rejects unknown and repeated parameters instead of guessing", () => {
    expect(parse("importance=5")).toBeNull();
    expect(parse("category=rubber&category=shipping")).toBeNull();
    expect(parse("thesis=RUBBER-TH-01&thesis=RUBBER-TH-01")).toBeNull();
  });

  it("combines category, thesis and time filters", () => {
    expect(parse("category=rubber&thesis=RUBBER-TH-01&from=2026-09-01T00:00:00.000Z&to=2026-09-10T00:00:00.000Z"))
      .toEqual({
        category: "rubber",
        thesisId: "RUBBER-TH-01",
        from: "2026-09-01T00:00:00.000Z",
        to: "2026-09-10T00:00:00.000Z",
      });
  });
});
