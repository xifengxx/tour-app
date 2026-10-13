import { describe, expect, it } from "vitest";
import { resolveCoreDestination } from "./destination.ts";

describe("resolveCoreDestination", () => {
  it("从城市 + 景区标题中提取具体山岳目的地", () => {
    const tour = { title: "丽江玉龙雪山之旅。", destination: { name: "丽江" } };
    expect(resolveCoreDestination(tour, tour.destination.name)).toBe("玉龙雪山");
  });

  it("目的地本身已是具体景区时不再改写", () => {
    const tour = { title: "玉龙雪山一日游", destination: { name: "玉龙雪山" } };
    expect(resolveCoreDestination(tour, tour.destination.name)).toBe("玉龙雪山");
  });
});
