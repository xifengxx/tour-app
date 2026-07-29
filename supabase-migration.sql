-- ============================================================
-- 文学巡礼 (Literary Tour) — Supabase 数据库迁移
-- 在 Supabase SQL Editor 中运行此文件
-- ============================================================

-- 启用 UUID 扩展
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================================
-- 导览项目
-- ============================================================
CREATE TABLE IF NOT EXISTS tours (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  subtitle TEXT DEFAULT '',
  theme JSONB DEFAULT '{"primaryColor": "#c0392b"}',
  source JSONB DEFAULT '{}',
  destination JSONB DEFAULT '{}',
  is_public BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- ============================================================
-- 内容层定义
-- ============================================================
CREATE TABLE IF NOT EXISTS content_layers (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tour_id UUID REFERENCES tours(id) ON DELETE CASCADE,
  layer_key TEXT NOT NULL,
  name TEXT NOT NULL,
  icon TEXT DEFAULT '',
  color TEXT DEFAULT '#888',
  sort_order INTEGER DEFAULT 0,
  UNIQUE(tour_id, layer_key)
);

-- ============================================================
-- 地点
-- ============================================================
CREATE TABLE IF NOT EXISTS locations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tour_id UUID REFERENCES tours(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  lat DOUBLE PRECISION NOT NULL,
  lng DOUBLE PRECISION NOT NULL,
  elevation TEXT DEFAULT '',
  importance INTEGER DEFAULT 3 CHECK (importance BETWEEN 1 AND 5),
  tags TEXT[] DEFAULT '{}',
  layers JSONB DEFAULT '{}',
  reflection TEXT DEFAULT '',
  practical JSONB DEFAULT '{}',
  sort_order INTEGER DEFAULT 0
);

-- ============================================================
-- 路线
-- ============================================================
CREATE TABLE IF NOT EXISTS routes (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tour_id UUID REFERENCES tours(id) ON DELETE CASCADE,
  day_label TEXT DEFAULT '',
  title TEXT NOT NULL,
  stops TEXT[] DEFAULT '{}',
  narrative TEXT DEFAULT '',
  sort_order INTEGER DEFAULT 0
);

-- ============================================================
-- 实用贴士
-- ============================================================
CREATE TABLE IF NOT EXISTS tips (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tour_id UUID REFERENCES tours(id) ON DELETE CASCADE,
  text TEXT NOT NULL,
  sort_order INTEGER DEFAULT 0
);

-- ============================================================
-- 更新时间触发器
-- ============================================================
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER tours_updated_at
  BEFORE UPDATE ON tours
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ============================================================
-- 索引
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_tours_user_id ON tours(user_id);
CREATE INDEX IF NOT EXISTS idx_tours_is_public ON tours(is_public);
CREATE INDEX IF NOT EXISTS idx_locations_tour_id ON locations(tour_id);
CREATE INDEX IF NOT EXISTS idx_routes_tour_id ON routes(tour_id);
CREATE INDEX IF NOT EXISTS idx_content_layers_tour_id ON content_layers(tour_id);

-- ============================================================
-- Row Level Security
-- ============================================================
ALTER TABLE tours ENABLE ROW LEVEL SECURITY;
ALTER TABLE content_layers ENABLE ROW LEVEL SECURITY;
ALTER TABLE locations ENABLE ROW LEVEL SECURITY;
ALTER TABLE routes ENABLE ROW LEVEL SECURITY;
ALTER TABLE tips ENABLE ROW LEVEL SECURITY;

-- tours: 公开的任何人可读，自己的可读写
CREATE POLICY "Public tours are viewable by everyone"
  ON tours FOR SELECT
  USING (is_public = true OR user_id = auth.uid());

CREATE POLICY "Users can insert their own tours"
  ON tours FOR INSERT
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users can update their own tours"
  ON tours FOR UPDATE
  USING (user_id = auth.uid());

CREATE POLICY "Users can delete their own tours"
  ON tours FOR DELETE
  USING (user_id = auth.uid());

-- content_layers
CREATE POLICY "Layers viewable with tour"
  ON content_layers FOR SELECT
  USING (
    EXISTS (SELECT 1 FROM tours WHERE id = tour_id AND (is_public = true OR user_id = auth.uid()))
  );

CREATE POLICY "Users can manage layers of own tours"
  ON content_layers FOR ALL
  USING (
    EXISTS (SELECT 1 FROM tours WHERE id = tour_id AND user_id = auth.uid())
  );

-- locations
CREATE POLICY "Locations viewable with tour"
  ON locations FOR SELECT
  USING (
    EXISTS (SELECT 1 FROM tours WHERE id = tour_id AND (is_public = true OR user_id = auth.uid()))
  );

CREATE POLICY "Users can manage locations of own tours"
  ON locations FOR ALL
  USING (
    EXISTS (SELECT 1 FROM tours WHERE id = tour_id AND user_id = auth.uid())
  );

-- routes
CREATE POLICY "Routes viewable with tour"
  ON routes FOR SELECT
  USING (
    EXISTS (SELECT 1 FROM tours WHERE id = tour_id AND (is_public = true OR user_id = auth.uid()))
  );

CREATE POLICY "Users can manage routes of own tours"
  ON routes FOR ALL
  USING (
    EXISTS (SELECT 1 FROM tours WHERE id = tour_id AND user_id = auth.uid())
  );

-- tips
CREATE POLICY "Tips viewable with tour"
  ON tips FOR SELECT
  USING (
    EXISTS (SELECT 1 FROM tours WHERE id = tour_id AND (is_public = true OR user_id = auth.uid()))
  );

CREATE POLICY "Users can manage tips of own tours"
  ON tips FOR ALL
  USING (
    EXISTS (SELECT 1 FROM tours WHERE id = tour_id AND user_id = auth.uid())
  );
