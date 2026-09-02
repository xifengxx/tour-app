const env = (name: string) => typeof Deno === "undefined" ? undefined : Deno.env.get(name);

export const GAODE_KEY = env("GAODE_KEY") || "";
export const SUPABASE_URL = env("SUPABASE_URL")!;
export const SR_KEY = env("SB_SERVICE_ROLE_KEY")!;
export const DEEPSEEK_KEY = env("DEEPSEEK_API_KEY")!;

export const hdr = {
  apikey: SR_KEY,
  Authorization: `Bearer ${SR_KEY}`,
  "Content-Type": "application/json",
  Prefer: "return=representation",
};
