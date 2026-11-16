import { describe, expect, it } from "vitest";
import { CHAINS, resolveChain, suggestChains } from "../src/lib/chains";

const names = (text: string) => suggestChains(text).map((c) => c.name);

describe("suggestChains", () => {
  it("finds a chain from its short forms", () => {
    for (const t of ["mc", "mec", "mac", "Mc Donalds", "mcdonald's", "MEC"]) expect(names(t)[0]).toBe("McDonald's");
    expect(names("kf")[0]).toBe("KFC");
    expect(names("bk")[0]).toBe("Burger King");
    expect(names("burger")[0]).toBe("Burger King");
    expect(names("pop")[0]).toBe("Popeyes");
    expect(names("taco")[0]).toBe("Taco Bell");
    expect(names("dristor")[0]).toBe("Dristor Kebap");
  });

  it("forgives a typo", () => {
    expect(names("mcdonlads")[0]).toBe("McDonald's");
    expect(names("popeyse")[0]).toBe("Popeyes");
    expect(names("burgr king")[0]).toBe("Burger King");
  });

  it("lists everything for an empty text and nothing for an unknown one", () => {
    expect(suggestChains("")).toHaveLength(CHAINS.length);
    expect(names("xyzq")).toEqual([]);
  });
});

describe("resolveChain", () => {
  it("turns a short form into the name to search for", () => {
    expect(resolveChain("mec")).toBe("McDonald's");
    expect(resolveChain(" kfc ")).toBe("KFC");
    expect(resolveChain("popey")).toBe("Popeyes");
    expect(resolveChain("burger")).toBe("Burger King");
  });

  it("leaves other restaurants as typed", () => {
    expect(resolveChain("Fryday")).toBe("Fryday");
    // "ma" could be several things: not ours to decide.
    expect(resolveChain("s")).toBe("s");
  });
});
