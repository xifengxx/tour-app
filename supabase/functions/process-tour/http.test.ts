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

  it("needs_review 与质量报告一起写入", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("[]", { status: 200 }));
    await setStatus("t1", "needs_review", null, { gate: { blocking: [{ label: "2日全景游", message: "超容量" }] } });
    const body = JSON.parse(String(fetchMock.mock.calls[0][1].body));
    expect(body.status).toBe("needs_review");
    expect(body.process_report.gate.blocking).toHaveLength(1);
    expect(body.process_error).toBeNull();
  });

  it("闸门拦截公开导览时同时收回 is_public", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("[]", { status: 200 }));
    await setStatus("t1", "needs_review", null, {}, { is_public: false });
    const body = JSON.parse(String(fetchMock.mock.calls[0][1].body));
    expect(body.is_public).toBe(false);
  });

  it("未传 extra 时不写入多余字段（不改变公开状态）", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("[]", { status: 200 }));
    await setStatus("t1", "done", null, { locations: 9 });
    const body = JSON.parse(String(fetchMock.mock.calls[0][1].body));
    expect(Object.keys(body).sort()).toEqual(["process_error", "process_report", "status"]);
  });
});
