import { afterEach, describe, expect, it, vi } from "vitest";
import { gaode } from "./gaode-search.ts";

const limited = () => new Response(JSON.stringify({ info: "CUQPS_HAS_EXCEEDED_THE_LIMIT" }));

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("gaode 限流处理", () => {
  it("限流后按延迟重试并成功", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(limited())
      .mockResolvedValueOnce(new Response(JSON.stringify({
        pois: [{ name: "光明顶", location: "118.15,30.12", type: "风景名胜" }],
      })));
    const pending = gaode("光明顶", "安徽省黄山市");
    await vi.advanceTimersByTimeAsync(1000);
    expect(await pending).toEqual({ lng: 118.15, lat: 30.12, name: "光明顶" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("持续限流时耗尽重试并放弃", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(() => Promise.resolve(limited()));
    const pending = gaode("黄山", "安徽省");
    await vi.advanceTimersByTimeAsync(20000);
    expect(await pending).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(8);
  });
});
