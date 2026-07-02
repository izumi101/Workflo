import { rankBetween } from "./rank.js";

describe("rankBetween", () => {
  it("returns a first key when both ends are open", () => {
    const first = rankBetween(null, null);
    expect(typeof first).toBe("string");
    expect(first.length).toBeGreaterThan(0);
  });

  it("appending after an existing key (open upper end) sorts strictly after it", () => {
    const first = rankBetween(null, null);
    const second = rankBetween(first, null);
    expect(second > first).toBe(true);
  });

  it("prepending before an existing key (open lower end) sorts strictly before it", () => {
    const first = rankBetween(null, null);
    const before = rankBetween(null, first);
    expect(before < first).toBe(true);
  });

  it("inserting between two keys sorts strictly between them (lexicographically)", () => {
    const a = rankBetween(null, null);
    const c = rankBetween(a, null);
    const b = rankBetween(a, c);
    expect(a < b).toBe(true);
    expect(b < c).toBe(true);
  });

  it("never returns a value equal to either neighbor", () => {
    const a = rankBetween(null, null);
    const c = rankBetween(a, null);
    const b = rankBetween(a, c);
    expect(b).not.toBe(a);
    expect(b).not.toBe(c);
  });

  it("repeated midpoint insertion keeps producing strictly ordered, distinct keys", () => {
    let low = rankBetween(null, null);
    let high = rankBetween(low, null);
    const seen = new Set([low, high]);
    for (let i = 0; i < 20; i++) {
      const mid = rankBetween(low, high);
      expect(mid > low).toBe(true);
      expect(mid < high).toBe(true);
      expect(seen.has(mid)).toBe(false);
      seen.add(mid);
      high = mid; // keep narrowing the same gap
    }
  });
});
