-- ============================================================
-- 主题游分区结构（v93）
-- 在 Supabase SQL Editor 中执行，可重复执行。
-- ============================================================

-- 主题游不再是"把散点串成一条线"，而是两层：
--   主题 → 若干就近可连玩的景区（sections）→ 每个景区内部具体可玩的点
-- sections 元素：{ key, name, kind: "核心景区"|"周边景点", stopIds: [locationId...], text }
-- routes.stops 仍是扁平顺序，因此地图连线、交通分段、路线确认指纹等既有消费方不受影响；
-- sections 只是叠在 stops 之上的分组视图（每个分区的 stopIds 必须是 stops 的子集）。
ALTER TABLE public.routes
  ADD COLUMN IF NOT EXISTS sections JSONB NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN public.routes.sections IS '主题游分区：主题→景区→景区内游览点。空数组表示该路线是线性行程（1日/2日）。';

-- 校验分区不引用不存在的站点（只作提示，不阻断写入：重跑顺序与写库顺序之间不做外键）
