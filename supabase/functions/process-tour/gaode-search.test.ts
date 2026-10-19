import { afterEach, describe, expect, it, vi } from "vitest";
import { gaode, regionMatches } from "./gaode-search.ts";
import { cleanName } from "./gaode-scan.ts";
import { FACILITY_RE } from "./gaode-search.ts";

const limited = () => new Response(JSON.stringify({ info: "CUQPS_HAS_EXCEEDED_THE_LIMIT" }));

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("gaode 限流处理", () => {
  it("清洗高德地点名时移除空括号", () => {
    expect(cleanName("华严寺()")).toBe("华严寺");
  });

  it("道路名不进入地区景点池", () => {
    expect(FACILITY_RE.test("白鹤峰路")).toBe(true);
    expect(FACILITY_RE.test("明月山大米")).toBe(false);
  });

  it("限流后按延迟重试并成功", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify({ geocodes: [] }))) // v86a geocode 首查（非行政区→空，走 POI）
      .mockResolvedValueOnce(limited())
      .mockResolvedValueOnce(new Response(JSON.stringify({
        pois: [{ name: "光明顶", location: "118.15,30.12", type: "风景名胜" }],
      })));
    const pending = gaode("光明顶", "安徽省黄山市");
    await vi.advanceTimersByTimeAsync(1000);
    expect(await pending).toEqual({ lng: 118.15, lat: 30.12, name: "光明顶" });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("持续限流时耗尽重试并放弃", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(() => Promise.resolve(limited()));
    const pending = gaode("黄山", "安徽省");
    await vi.advanceTimersByTimeAsync(20000);
    expect(await pending).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(9); // 1 geocode + 4 retries × 2 queries
  });
});

describe("regionMatches 区域一致性校验（v99.1 五台山漂移回归）", () => {
  it("省市字段与填写地区互含才算匹配", () => {
    expect(regionMatches("山西", { province: "山西省", city: "忻州市" })).toBe(true);
    expect(regionMatches("山西", { province: "江苏省", city: "南京市" })).toBe(false);
    expect(regionMatches("山西大同", { province: "山西省", city: "大同市" })).toBe(true);
    expect(regionMatches("湖北武汉", { province: "湖北省", city: "武汉市" })).toBe(true);
    expect(regionMatches("四川", { province: "四川省", city: "成都市" })).toBe(true);
    expect(regionMatches("", { province: "任意", city: "任意" })).toBe(true);
    expect(regionMatches("内蒙古", { province: "内蒙古自治区", city: "呼和浩特市" })).toBe(true);
  });
});
