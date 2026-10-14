-- ============================================================
-- tours.status 取值说明（P1-2 路线质量闸门）
-- 在 Supabase SQL Editor 中执行。可重复执行。
--
-- status 是无约束 TEXT 列，本文件只写注释、不加 CHECK 约束：
-- 库里已存在 draft/processing/done/error 之外的历史取值，
-- 加约束会让旧行写入失败，属于不必要的破坏性变更。
-- ============================================================

COMMENT ON COLUMN public.tours.status IS '导览处理与发布状态。取值：draft 草稿（未处理）；processing AI 处理中（由 INSERT/UPDATE 触发器驱动 process-tour）；done 处理完成且路线通过质量闸门，可直接发布；needs_review 内容已落库但存在阻断级路线问题，闸门禁止直接发布，需创作者核实后重新分析或手动调整；error 处理失败，原因见 process_error。';

COMMENT ON COLUMN public.tours.process_report IS '质量报告 JSONB。gate.blocking 为闸门拦下的阻断级问题（数组，含路线标签与原因）；gate.repairs 为自动修复次数；gate.routes/plans 用于发现"路线被静默丢弃"；gate.unpublished 表示该导览原为公开、因未过检被自动收回公开。routeGraph.issues 为校验器发现的全部问题数（含 advisory 级）。';

-- needs_review 的导览数量是闸门的运行指标，建一个部分索引便于观察趋势。
CREATE INDEX IF NOT EXISTS idx_tours_needs_review
  ON public.tours (updated_at DESC)
  WHERE status = 'needs_review';
