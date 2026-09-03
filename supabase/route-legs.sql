-- v82: 每条路线保存结构化交通分段，AI narrative、审核端和详情页共用同一份约束。
ALTER TABLE public.routes
  ADD COLUMN IF NOT EXISTS legs JSONB NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN public.routes.legs IS '路线相邻站交通分段：mode/duration/distanceM/note';
