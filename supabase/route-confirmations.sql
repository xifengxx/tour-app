-- v83: 创作者路线确认。这不是发布审核；AI 处理完成后导览仍可直接发布。
-- 确认的作用是把“用户看过并认可”的路线沉淀为可复用目的地知识。
CREATE TABLE IF NOT EXISTS public.route_confirmations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  tour_id UUID NOT NULL REFERENCES public.tours(id) ON DELETE CASCADE,
  route_id TEXT NOT NULL,
  route_label TEXT NOT NULL DEFAULT '',
  destination_name TEXT NOT NULL,
  destination_aliases TEXT[] NOT NULL DEFAULT '{}',
  stops TEXT[] NOT NULL DEFAULT '{}',
  legs JSONB NOT NULL DEFAULT '[]'::jsonb,
  route_model JSONB NOT NULL,
  warnings JSONB NOT NULL DEFAULT '[]'::jsonb,
  notes TEXT NOT NULL DEFAULT '',
  route_fingerprint TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'creator-confirmed',
  confidence NUMERIC NOT NULL DEFAULT 0.85 CHECK (confidence >= 0 AND confidence <= 1)
);

COMMENT ON TABLE public.route_confirmations IS '创作者对单条 AI/手工路线的确认记录，用于生成可复用目的地路线知识';
COMMENT ON COLUMN public.route_confirmations.route_model IS '确认时刻的 zones/trails/edges 快照，供 process-tour 复用';
COMMENT ON COLUMN public.route_confirmations.route_fingerprint IS '路线站点指纹；路线修改后旧确认不会自动生效';

CREATE INDEX IF NOT EXISTS idx_route_confirmations_destination
  ON public.route_confirmations (destination_name, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_route_confirmations_tour
  ON public.route_confirmations (tour_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_route_confirmations_route
  ON public.route_confirmations (route_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_route_confirmations_model
  ON public.route_confirmations USING GIN (route_model jsonb_path_ops);

ALTER TABLE public.route_confirmations ENABLE ROW LEVEL SECURITY;

CREATE POLICY route_confirmations_select_own
  ON public.route_confirmations FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY route_confirmations_insert_own_tour
  ON public.route_confirmations FOR INSERT
  TO authenticated
  WITH CHECK (
    user_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.tours t
      WHERE t.id = tour_id AND t.user_id = auth.uid()
    )
  );

CREATE POLICY route_confirmations_delete_own
  ON public.route_confirmations FOR DELETE
  TO authenticated
  USING (user_id = auth.uid());
