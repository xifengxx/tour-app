-- P1-6「我的回忆」：行印（到访记录）+ 藏印（地点收藏）
-- tour_id / loc_id 用 TEXT，兼容静态导览的字符串 id，不建 FK

-- 一、行印：一处地点的一次到访记录
CREATE TABLE IF NOT EXISTS visits (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  tour_id TEXT NOT NULL,
  loc_id TEXT NOT NULL,
  loc_name TEXT,
  visited_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  photos JSONB NOT NULL DEFAULT '[]'::jsonb,        -- [{ "url": "...", "caption": "..." }]
  favorite_figure TEXT,                              -- 此行最记住的一个人物
  quote TEXT,                                        -- 自己写的一句话
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_visits_user ON visits(user_id, visited_at DESC);
CREATE INDEX IF NOT EXISTS idx_visits_tour ON visits(user_id, tour_id);

-- 二、藏印：地点级收藏
CREATE TABLE IF NOT EXISTS loc_favorites (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  tour_id TEXT NOT NULL,
  loc_id TEXT NOT NULL,
  loc_name TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id, loc_id)
);

CREATE INDEX IF NOT EXISTS idx_loc_fav_user ON loc_favorites(user_id);

-- 三、RLS：自己的数据只有自己能读写
ALTER TABLE visits ENABLE ROW LEVEL SECURITY;
ALTER TABLE loc_favorites ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "visits 自己读" ON visits;
DROP POLICY IF EXISTS "visits 自己写" ON visits;
DROP POLICY IF EXISTS "visits 自己删" ON visits;
CREATE POLICY "visits 自己读" ON visits FOR SELECT USING (user_id = auth.uid());
CREATE POLICY "visits 自己写" ON visits FOR INSERT WITH CHECK (user_id = auth.uid());
CREATE POLICY "visits 自己删" ON visits FOR DELETE USING (user_id = auth.uid());

DROP POLICY IF EXISTS "藏印 自己读" ON loc_favorites;
DROP POLICY IF EXISTS "藏印 自己写" ON loc_favorites;
DROP POLICY IF EXISTS "藏印 自己删" ON loc_favorites;
CREATE POLICY "藏印 自己读" ON loc_favorites FOR SELECT USING (user_id = auth.uid());
CREATE POLICY "藏印 自己写" ON loc_favorites FOR INSERT WITH CHECK (user_id = auth.uid());
CREATE POLICY "藏印 自己删" ON loc_favorites FOR DELETE USING (user_id = auth.uid());

-- 四、Storage 桶：到访照片
INSERT INTO storage.buckets (id, name, public)
VALUES ('visit-photos', 'visit-photos', true)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "到访照片 本人上传" ON storage.objects;
DROP POLICY IF EXISTS "到访照片 公开读" ON storage.objects;
DROP POLICY IF EXISTS "到访照片 本人删" ON storage.objects;
CREATE POLICY "到访照片 本人上传" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'visit-photos' AND (storage.foldername(name))[1] = auth.uid()::text);
CREATE POLICY "到访照片 公开读" ON storage.objects
  FOR SELECT USING (bucket_id = 'visit-photos');
CREATE POLICY "到访照片 本人删" ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'visit-photos' AND (storage.foldername(name))[1] = auth.uid()::text);
