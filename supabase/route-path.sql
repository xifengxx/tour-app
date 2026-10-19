-- v99: 路线真实路径（高德步行/驾车几何 + 站点沿线里程）
-- routes.path = { geom: [[lng,lat],...], stopKm: [0,...], totalKm, planned, fellBack }
-- 缺省 null = 旧数据/回退，前端用站点直连。
ALTER TABLE public.routes ADD COLUMN IF NOT EXISTS path JSONB;
