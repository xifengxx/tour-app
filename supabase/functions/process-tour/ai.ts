import { DEEPSEEK_KEY } from "./config.ts";

// v70 截断信号：finish_reason=length → 内容 chunk 上层拆半重试，而非盲目重试同样超长的 prompt
class TruncatedError extends Error {
  truncated = true;
  constructor() { super("finish_reason=length（输出超 max_tokens 截断）"); }
}

export function parseDeepseekJson(text: string) {
  const cleaned = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");
  return JSON.parse(cleaned);
}

// v70：全类型失败统一重试 + 指数退避。v69 只对 JSON 解析失败重试——HTTP 429/5xx、空内容、
// 网络超时全部直接 throw → 一次限流整个导览 status=error（新建导览"经常失败"的主因之一）。
// 超时 120s→60s：Edge Function worker 预算有限，单路 120s 会拖垮整个函数。
export async function deepseek(messages: { role: string; content: string }[], opts: { retries?: number; temperature?: number; maxTokens?: number } = {}) {
  const { retries = 2, temperature = 0.7, maxTokens = 8192 } = opts;
  let lastErr: any;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const r = await fetch("https://api.deepseek.com/v1/chat/completions", { signal: AbortSignal.timeout(60000), // v70: 120s→60s，worker 预算内
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${DEEPSEEK_KEY}` },
        body: JSON.stringify({ model: "deepseek-chat", messages, temperature, max_tokens: maxTokens, response_format: { type: "json_object" } }),
      });
      if (!r.ok) throw new Error(`DeepSeek: ${r.status}`);
      const j = await r.json();
      const choice = j.choices?.[0];
      const text = (choice?.message?.content || "").trim();
      if (!text) throw new Error("DeepSeek 返回空内容");
      if (choice?.finish_reason === "length") throw new TruncatedError();
      // 剥离 ```json ... ``` 代码块后解析，避免模型偶尔包裹 markdown
      return parseDeepseekJson(text);
    } catch (e: any) {
      lastErr = e;
      if (e.truncated) throw e; // 截断交给上层处理（拆半/收紧），不盲目重试
      if (attempt < retries) { await new Promise(r2 => setTimeout(r2, [1000, 3000, 8000][attempt] || 8000)); continue; }
      throw e;
    }
  }
  throw lastErr || new Error("DeepSeek 调用失败");
}

// 有界并发映射：Edge Function 60s 预算内，把互相独立的网络调用并行化（如逐地点 gaode/regeo、内容分块）。
// 限制并发避免打爆高德限流/DeepSeek 限速。结果按下标归位，保持原顺序。
export async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T, i: number) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let idx = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (idx < items.length) {
      const i = idx++;
      out[i] = await fn(items[i], i);
    }
  }));
  return out;
}
