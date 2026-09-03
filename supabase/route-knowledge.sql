-- ============================================================
-- 目的地路线知识层（v78）
-- 这张表是“动态搜索 + 结构化路线规划”的落库地基。
-- route-research 后续把官网/权威资料解析出的 zones/trails/edges 写到这里；
-- process-tour 优先读取本表，读不到时才回退到内置 CURATED_TRAILS。
-- 表只允许 service_role 访问：启用 RLS 且不建 anon policy。
-- ============================================================

CREATE TABLE IF NOT EXISTS public.destination_route_knowledge (
  destination_name TEXT PRIMARY KEY,
  aliases TEXT[] NOT NULL DEFAULT '{}',
  model JSONB NOT NULL,
  source TEXT NOT NULL DEFAULT 'curated',
  confidence NUMERIC NOT NULL DEFAULT 0.90 CHECK (confidence >= 0 AND confidence <= 1),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.destination_route_knowledge IS '目的地结构化路线知识：zones/trails/edges 由外部研究或人工策展维护';
COMMENT ON COLUMN public.destination_route_knowledge.model IS '结构化路线模型，当前至少包含 trails；未来扩展 zones/edges/routes';
COMMENT ON COLUMN public.destination_route_knowledge.source IS '数据来源，如 official/osm/manual/research';
COMMENT ON COLUMN public.destination_route_knowledge.confidence IS '证据置信度，0-1';

ALTER TABLE public.destination_route_knowledge ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_destination_route_knowledge_aliases
  ON public.destination_route_knowledge USING GIN (aliases);
CREATE INDEX IF NOT EXISTS idx_destination_route_knowledge_model
  ON public.destination_route_knowledge USING GIN (model jsonb_path_ops);

-- 初始种子来自原 CURATED_TRAILS。函数运行时数据库优先，未命中则回退内置数据。
INSERT INTO public.destination_route_knowledge
  (destination_name, aliases, model, source, confidence)
VALUES
(
  '泰山',
  ARRAY['泰山', '泰山风景名胜区', '泰安泰山'],
  $json${
    "zones": [],
    "trails": [
      {
        "id": "taishan-hongmen",
        "aliases": ["泰山", "泰山风景名胜区", "泰安泰山"],
        "stops": [
          {"name": "红门", "aliases": ["红门宫", "红门游客中心"]},
          {"name": "一天门"}, {"name": "万仙楼"}, {"name": "斗母宫"},
          {"name": "经石峪"}, {"name": "中天门"}, {"name": "五大夫松"},
          {"name": "十八盘"}, {"name": "南天门"}, {"name": "天街"},
          {"name": "碧霞祠", "aliases": ["碧霞元君祠"]},
          {"name": "玉皇顶"}, {"name": "日观峰"}
        ],
        "notes": "经典红门徒步线：红门→中天门→十八盘→南天门→天街→碧霞祠→玉皇顶；中天门/南天门可索道分段。"
      }
    ],
    "edges": []
  }$json$,
  'curated',
  0.90
),
(
  '华山',
  ARRAY['华山', '西岳华山', '华山风景名胜区'],
  $json${
    "zones": [],
    "trails": [
      {
        "id": "huashan-yuquanyuan",
        "aliases": ["华山", "西岳华山", "华山风景名胜区"],
        "stops": [
          {"name": "玉泉院"}, {"name": "千尺幢"}, {"name": "百尺峡"},
          {"name": "老君犁沟"}, {"name": "北峰"}, {"name": "苍龙岭"},
          {"name": "金锁关"}, {"name": "东峰"}, {"name": "南峰"}, {"name": "西峰"}
        ],
        "notes": "徒步参考“自古华山一条路”：玉泉院→北峰→金锁关→东南西峰；索道常见西上北下。"
      }
    ],
    "edges": []
  }$json$,
  'curated',
  0.90
),
(
  '北岳恒山',
  ARRAY['北岳恒山', '恒山', '恒山风景名胜区', '大同恒山'],
  $json${
    "zones": [],
    "trails": [
      {
        "id": "hengshan-main",
        "aliases": ["北岳恒山", "恒山", "恒山风景名胜区", "大同恒山"],
        "stops": [
          {"name": "游客中心", "aliases": ["北岳恒山", "恒山"]},
          {"name": "三清殿", "aliases": ["恒山三清殿"], "lat": 39.651853, "lng": 113.725842, "required": true},
          {"name": "三元宫", "lat": 39.651753, "lng": 113.72432},
          {"name": "真武庙", "aliases": ["真武殿"], "lat": 39.662628, "lng": 113.734905, "required": true},
          {"name": "虎风口", "lat": 39.665722, "lng": 113.733802, "required": true},
          {"name": "果老岭", "aliases": ["果老先迹", "北岳恒山-果老岭"], "lat": 39.667709, "lng": 113.73262, "required": true},
          {"name": "苦甜井"}, {"name": "崇灵门"},
          {"name": "会仙府", "lat": 39.670322, "lng": 113.732116, "required": true},
          {"name": "琴棋台"},
          {"name": "天峰岭", "lat": 39.672792, "lng": 113.732809, "required": true},
          {"name": "悬空寺", "lat": 39.661139, "lng": 113.715781, "required": true},
          {"name": "金龙峡", "aliases": ["金龙峡栈道"], "lat": 39.664756, "lng": 113.713587},
          {"name": "翠屏山", "aliases": ["翠屏山-三清殿", "翠屏山三清殿"], "lat": 39.665923, "lng": 113.707197}
        ],
        "notes": "恒山主游线按实际换乘组织：游客中心/山脚三清殿→真武庙→虎风口→果老岭→会仙府→天峰岭；下山后专车到悬空寺/金龙峡。"
      }
    ],
    "edges": []
  }$json$,
  'curated',
  0.92
),
(
  '南岳衡山',
  ARRAY['南岳衡山', '衡山', '南岳衡山风景名胜区'],
  $json${
    "zones": [],
    "trails": [
      {
        "id": "hengshan-nanyue",
        "aliases": ["南岳衡山", "衡山", "南岳衡山风景名胜区"],
        "stops": [
          {"name": "南岳大庙"}, {"name": "忠烈祠"}, {"name": "半山亭"},
          {"name": "磨镜台"}, {"name": "福严寺"}, {"name": "南台寺"},
          {"name": "南天门"}, {"name": "上封寺"}, {"name": "祝融峰"}
        ],
        "notes": "经典上行参考：南岳大庙/胜利坊→忠烈祠→半山亭→磨镜台/福严寺→南天门→上封寺→祝融峰。"
      }
    ],
    "edges": []
  }$json$,
  'curated',
  0.90
),
(
  '嵩山',
  ARRAY['嵩山', '中岳嵩山', '太室山', '少室山'],
  $json${
    "zones": [
      {"id": "taishi", "name": "太室山", "aliases": ["太室山", "嵩山"]},
      {"id": "shaoshi", "name": "少室山", "aliases": ["少室山", "嵩山"]}
    ],
    "trails": [
      {
        "id": "songshan-taishi",
        "zoneId": "taishi",
        "aliases": ["嵩山", "中岳嵩山", "太室山"],
        "scenicName": "太室山",
        "stops": [
          {"name": "嵩阳书院"}, {"name": "老母洞"}, {"name": "中岳行宫"},
          {"name": "三皇口"}, {"name": "峻极峰", "aliases": ["太室山", "太室山主峰"]}
        ],
        "notes": "太室山经典线：嵩阳书院→老母洞→中岳行宫→三皇口→峻极峰。"
      },
      {
        "id": "songshan-shaoshi",
        "zoneId": "shaoshi",
        "aliases": ["嵩山", "少室山", "三皇寨", "少林寺"],
        "scenicName": "少室山",
        "stops": [
          {"name": "少林寺"}, {"name": "塔林"}, {"name": "三皇寨"}, {"name": "悬空栈道"}
        ],
        "notes": "少室山景区线：少林寺/塔林与三皇寨/悬空栈道分属同一游览区，但需按索道或徒步衔接，不与太室山峻极峰混排。"
      }
    ],
    "edges": []
  }$json$,
  'curated',
  0.92
)
ON CONFLICT (destination_name) DO UPDATE SET
  aliases = EXCLUDED.aliases,
  model = EXCLUDED.model,
  source = EXCLUDED.source,
  confidence = EXCLUDED.confidence,
  updated_at = now();
