-- P1-5 行前「案头」：地点级的两份带出处资料
-- 在 Supabase SQL Editor 里执行（幂等，可重复跑）
--
-- timeline 每项：{ era, label, function, change, evidence, order? }
--   era      时期名（"东晋"/"晚清"/"1959"），同 era 会在时间轴上合并成一段
--   label    一句话标题（"僧人择此结庐"）
--   function 这一站在当时承担什么功能
--   change   因何而变（要写清触发因素，不是泛泛的"历史变迁"）
--   evidence 依据（书名/卷次/碑刻）。写不出出处就别填，前端会显示「依据待考」
--   order    可选排序权重；缺省按路线顺序
--
-- figures 每项：{ name, role, relation, works[], evidence }
--   name     真实人物姓名
--   role     身份（"东晋高僧，净土宗初祖"）
--   relation 与此地的具体关系（"在此结白莲社"），不要写泛泛的"曾游历"
--   works    相关作品名（书名号内文字），用于人物—地点—作品关系图
--   evidence 依据

--
-- shot 每项：{ title, position, direction, formula, time, avoid }
--   title     机位名（"栈道入口回望"）
--   position  站哪（具体站位，不是"找个好角度"）
--   direction 朝哪、镜头怎么摆
--   formula   构图公式（比例 + 三分点 + 画幅）
--   time      时段（光线方向与最佳窗口）
--   avoid     避开什么（禁拍区 / 天气 / 人流）

ALTER TABLE public.locations
  ADD COLUMN IF NOT EXISTS timeline jsonb DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS figures  jsonb DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS shot     jsonb DEFAULT '[]'::jsonb;

COMMENT ON COLUMN public.locations.timeline IS 'P1-5 案头：时期演变 [{era,label,function,change,evidence,order}]';
COMMENT ON COLUMN public.locations.figures  IS 'P1-5 案头：关联人物 [{name,role,relation,works,evidence}]';
COMMENT ON COLUMN public.locations.shot     IS 'P1-7 机位：站位/朝向/构图公式/时段/避开 [{title,position,direction,formula,time,avoid}]';

-- 只允许数组，避免管线写成对象后前端 map 崩
ALTER TABLE public.locations
  DROP CONSTRAINT IF EXISTS locations_timeline_is_array,
  DROP CONSTRAINT IF EXISTS locations_figures_is_array,
  DROP CONSTRAINT IF EXISTS locations_shot_is_array;

ALTER TABLE public.locations
  ADD CONSTRAINT locations_timeline_is_array
    CHECK (timeline IS NULL OR jsonb_typeof(timeline) = 'array'),
  ADD CONSTRAINT locations_figures_is_array
    CHECK (figures IS NULL OR jsonb_typeof(figures) = 'array'),
  ADD CONSTRAINT locations_shot_is_array
    CHECK (shot IS NULL OR jsonb_typeof(shot) = 'array');
