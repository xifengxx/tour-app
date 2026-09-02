import { afterEach, describe, expect, it, vi } from "vitest";
import { postRows, setStatus } from "./http.ts";

afterEach(() => vi.restoreAllMocks());

describe("postRows", () => {
  it("空行列表不发起请求", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch");
    await postRows("tours", []);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("数据库写入失败抛出可读错误", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("conflict", { status: 409 }));
    await expect(postRows("tours", [{ title: "测试" }])).rejects.toThrow("POST tours: 409");
  });
});

describe("setStatus", () => {
  it("状态写入失败不阻断流程", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("network down"));
    await expect(setStatus("t1", "error", "boom")).resolves.toBeUndefined();
  });
});
