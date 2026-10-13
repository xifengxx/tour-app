-- v86a: 路线海拔剖面。process-tour 生成路线后沿站点采样 OpenTopoData。
ALTER TABLE public.routes
  ADD COLUMN IF NOT EXISTS prof JSONB NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN public.routes.prof IS '海拔剖面 [[km, m], ...]，空数组表示未采样';
