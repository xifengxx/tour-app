-- P2 社交功能：收藏 + 评论
-- tour_id 用 TEXT（兼容静态导览的字符串 id 如 nanyue-hengshan，不建 FK）

CREATE TABLE IF NOT EXISTS favorites (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  tour_id TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(user_id, tour_id)
);

CREATE TABLE IF NOT EXISTS comments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tour_id TEXT NOT NULL,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  author_name TEXT DEFAULT '旅人',
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_favorites_user ON favorites(user_id);
CREATE INDEX IF NOT EXISTS idx_comments_tour ON comments(tour_id);

ALTER TABLE favorites ENABLE ROW LEVEL SECURITY;
ALTER TABLE comments ENABLE ROW LEVEL SECURITY;

-- 可见性：自己的 OR 导览公开 OR 静态导览（不在 tours 表）→ 视为公开
CREATE POLICY "favorites 可见" ON favorites FOR SELECT USING (
  user_id = auth.uid()
  OR NOT EXISTS (SELECT 1 FROM tours WHERE id::text = tour_id)
  OR EXISTS (SELECT 1 FROM tours WHERE id::text = tour_id AND is_public = true)
);
CREATE POLICY "favorites 插入" ON favorites FOR INSERT WITH CHECK (user_id = auth.uid());
CREATE POLICY "favorites 删除" ON favorites FOR DELETE USING (user_id = auth.uid());

CREATE POLICY "comments 可见" ON comments FOR SELECT USING (
  user_id = auth.uid()
  OR NOT EXISTS (SELECT 1 FROM tours WHERE id::text = tour_id)
  OR EXISTS (SELECT 1 FROM tours WHERE id::text = tour_id AND is_public = true)
);
CREATE POLICY "comments 插入" ON comments FOR INSERT WITH CHECK (
  user_id = auth.uid() AND length(content) BETWEEN 1 AND 500
);
CREATE POLICY "comments 删除" ON comments FOR DELETE USING (user_id = auth.uid());
