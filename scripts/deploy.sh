#!/usr/bin/env bash
# 部署顺序检查与执行（v93）
#
# 顺序不能调换，两个方向都会出事故：
#   1. routes.sections 列必须先建。新函数会往该列写值，列不存在时
#      PostgREST 报 400，路线写入失败，导览直接落到 status=error。
#   2. 前端必须先于 Edge Function 上线。新函数会写 status='needs_review'，
#      旧前端只认 done/error，会一路死等到 4 分钟超时，把成功的导览报成"处理超时"。
#
# 用法：
#   scripts/deploy.sh --check     # 只读探测，不做任何变更（默认）
#   scripts/deploy.sh --deploy    # 探测通过后部署 process-tour
set -uo pipefail
cd "$(dirname "$0")/.."
MODE="${1:---check}"

[ -f .env ] && { set -a; . ./.env; set +a; }
URL="${VITE_SUPABASE_URL:-}"
ANON="${VITE_SUPABASE_ANON_KEY:-}"
PROJECT="${SUPABASE_PROJECT_REF:-qxunedraoviaonjdanag}"
FAIL=0

say() { printf '%s\n' "$*"; }
ok()  { say "  ✓ $*"; }
bad() { say "  ✗ $*"; FAIL=1; }

if [ -z "$URL" ] || [ -z "$ANON" ]; then
  say "缺少 VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY"; exit 1
fi

say "1) 数据库前置条件（必须先于函数部署）"
probe() {
  curl -s -m 20 "$URL/rest/v1/routes?select=$1&limit=1" -H "apikey: $ANON" \
    | grep -q "\"code\":\"42703\"" && return 1 || return 0
}
for col in legs prof sections; do
  if probe "$col"; then ok "routes.$col 已存在"; else bad "routes.$col 不存在 → 先在 SQL Editor 执行 supabase/route-$([ $col = sections ] && echo sections || echo $col).sql"; fi
done

say ""
say "2) Supabase CLI 登录状态"
if [ -f "$HOME/.supabase/access-token" ]; then ok "已登录（存在 access-token）"
else bad "未登录 → 先执行 supabase login"; fi

say ""
say "3) 前端"
say "  EdgeOne Pages 是 push 即构建。顺序要求：前端先上线，再部署函数。"

if [ "$MODE" != "--deploy" ]; then
  say ""
  say "检查模式结束（未做任何变更）。加 --deploy 才会在上述检查全部通过时部署函数。"
  [ "$FAIL" = "0" ] && exit 0 || exit 1
fi

say ""
if [ "$FAIL" != "0" ]; then
  say "✗ 前置条件未满足，已中止部署。原因见上面打叉的条目。"
  exit 1
fi
say "→ 部署 process-tour（函数版本会变化，前端已在上的前提下才安全）"
npx supabase functions deploy process-tour --project-ref "$PROJECT" --no-verify-jwt \
  && ok "process-tour 已部署" || bad "部署失败"
say ""
say "下一步：deno run --allow-net --allow-read --allow-env --allow-write scripts/reprocess-tours.ts --dest <目的地>"
