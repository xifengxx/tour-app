-- ============================================================
-- AI 处理触发器（INSERT + UPDATE）
-- 在 Supabase Dashboard → SQL Editor 中运行此文件（幂等，可重复执行）
-- 前置条件：已启用 pg_net 扩展（CREATE EXTENSION IF NOT EXISTS pg_net;）
-- ============================================================

-- 触发器函数：服务器端调用 Edge Function
CREATE OR REPLACE FUNCTION trigger_ai_process()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM net.http_post(
    url := 'https://qxunedraoviaonjdanag.supabase.co/functions/v1/process-tour',
    body := json_build_object('tourId', NEW.id)::jsonb,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer sb_publishable_Pp21-3ssB3rSxwFnA-WZZw_eUHmF31E'
    ),
    timeout_milliseconds := 60000
  );
  RETURN NEW;
END;
$$;

-- INSERT 触发器（新导览）：与旧版 ai_process_trigger 等效，若旧版已存在可保留
DROP TRIGGER IF EXISTS ai_process_trigger_insert ON tours;
CREATE TRIGGER ai_process_trigger_insert
  AFTER INSERT ON tours
  FOR EACH ROW
  WHEN (NEW.status = 'processing')
  EXECUTE FUNCTION trigger_ai_process();

-- UPDATE 触发器（重新处理已有导览）：仅当 status 从「非 processing」转入 processing 时触发。
-- 该条件避免死循环 —— Edge Function 内部 setStatus('processing') 时 OLD=NEW=processing，不会再次触发。
DROP TRIGGER IF EXISTS ai_process_trigger_update ON tours;
CREATE TRIGGER ai_process_trigger_update
  AFTER UPDATE ON tours
  FOR EACH ROW
  WHEN (NEW.status = 'processing' AND OLD.status IS DISTINCT FROM 'processing')
  EXECUTE FUNCTION trigger_ai_process();

-- 注意：若库里已存在旧版 INSERT 触发器 ai_process_trigger，建议删除，避免 INSERT 触发两次：
-- DROP TRIGGER IF EXISTS ai_process_trigger ON tours;
