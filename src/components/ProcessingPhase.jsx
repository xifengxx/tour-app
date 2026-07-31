import { useState, useEffect, useRef } from 'react';
import { supabase } from '../lib/supabase';

/**
 * Waiting screen during AI processing. Polls Supabase to detect
 * when the Edge Function has written location data.
 */
export default function ProcessingPhase({
  draftTourId,
  title,
  destName,
  destRegion,
  novelTitle,
  novelAuthor,
  sourceText,
  onCheckDone,
  onSkip,
  onBack,
}) {
  const [pollCount, setPollCount] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const startTimeRef = useRef(Date.now());
  const intervalRef = useRef(null);
  const timerRef = useRef(null);

  // Timer: read from startTimeRef instead of useState to avoid stale closures
  useEffect(() => {
    const tick = () => setElapsed(Math.floor((Date.now() - startTimeRef.current) / 1000));
    tick(); // initial
    timerRef.current = setInterval(tick, 1000);
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, []);

  useEffect(() => {
    const check = async () => {
      if (!draftTourId) return;
      const { data, error } = await supabase
        .from('locations')
        .select('id')
        .eq('tour_id', draftTourId)
        .limit(1);
      if (error) return;
      setPollCount(prev => prev + 1);
      if (data && data.length > 0) {
        if (intervalRef.current) clearInterval(intervalRef.current);
        if (timerRef.current) clearInterval(timerRef.current);
        setTimeout(() => onCheckDone(), 800);
      }
    };

    const initial = setTimeout(check, 3000);
    intervalRef.current = setInterval(check, 5000);

    return () => {
      clearTimeout(initial);
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [draftTourId]); // removed onCheckDone — its reference changes every render, killing the timer

  const formatElapsed = (s) => {
    if (s < 60) return `${s} 秒`;
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return `${m} 分 ${sec} 秒`;
  };

  return (
    <div className="space-y-4">
      <section className="bg-card rounded-2xl p-6 border border-border text-center">
        <div className="mb-4">
          <div className="inline-block w-16 h-16 border-4 border-white/10 border-t-primary rounded-full animate-spin" />
        </div>

        <h2 className="text-white font-bold text-lg mb-2">🤖 AI 正在分析处理</h2>
        <p className="text-muted-foreground text-sm mb-4">服务器正在自动调用 AI 提取地点、生成内容、规划路线</p>

        <div className="flex items-center justify-center gap-4 text-xs text-muted-foreground mb-5">
          <div className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-yellow-500 animate-pulse" />
            处理中
          </div>
          <span>·</span>
          <div>已等待 {formatElapsed(elapsed)}</div>
          <span>·</span>
          <div>已检测 {pollCount} 次</div>
        </div>

        <div className="bg-background rounded-xl px-4 py-3 mb-5 max-w-sm mx-auto">
          <div className="text-muted-foreground text-xs mb-2">⏱ 预估时间</div>
          <div className="flex justify-between text-xs">
            <div className="text-center px-2">
              <div className="text-white font-bold">30–60 秒</div>
              <div className="text-muted-foreground">简单导览</div>
            </div>
            <div className="w-px bg-border" />
            <div className="text-center px-2">
              <div className="text-white font-bold">1–2 分钟</div>
              <div className="text-muted-foreground">完整导览</div>
            </div>
            <div className="w-px bg-border" />
            <div className="text-center px-2">
              <div className="text-white font-bold">2–5 分钟</div>
              <div className="text-muted-foreground">大型导览</div>
            </div>
          </div>
        </div>

        <div className="text-left bg-background rounded-xl p-4 mb-5">
          <h3 className="text-white text-xs font-bold mb-3">📋 AI 自动处理流程</h3>
          <div className="space-y-2">
            {[
              '草稿已保存到数据库',
              'DeepSeek AI 分析源材料，提取地点',
              '高德地图 API 查找精确坐标',
              'AI 生成四层内容（文学/历史/传说/民俗）',
              'AI 规划游览路线',
              '数据写入数据库，页面自动刷新',
            ].map((text, i) => (
              <div key={i} className="flex items-center gap-2 text-xs">
                <span className={i < 2 ? 'text-green-400' : 'text-muted-foreground'}>
                  {i < 2 ? '●' : '○'}
                </span>
                <span className={i < 2 ? 'text-green-400/80' : 'text-muted-foreground'}>{text}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="text-left bg-background rounded-xl p-4 mb-5">
          <h3 className="text-muted-foreground text-xs mb-2">📦 已提交的材料</h3>
          <div className="space-y-1.5 text-xs">
            {title && <div className="text-white"><strong>标题：</strong>{title}</div>}
            {destName && <div className="text-white"><strong>目的地：</strong>{destName}{destRegion ? `（${destRegion}）` : ''}</div>}
            {novelTitle && <div className="text-white"><strong>作品：</strong>{novelTitle}{novelAuthor ? ` — ${novelAuthor}` : ''}</div>}
            {sourceText && <div className="text-muted-foreground"><strong>文本：</strong>已粘贴 {sourceText.length} 字</div>}
            {!sourceText && !novelTitle && <div className="text-yellow-400">⚠️ 未提供源材料，AI 只能做基础分析</div>}
          </div>
        </div>
      </section>

      <div className="flex gap-2">
        <button
          onClick={onBack}
          className="flex-1 py-3 bg-white/5 text-muted-foreground rounded-xl text-sm hover:bg-white/10 transition-colors"
        >
          ← 返回修改
        </button>
        <button
          onClick={onSkip}
          className="flex-1 py-3 bg-white/5 text-muted-foreground rounded-xl text-sm hover:bg-white/10 transition-colors"
        >
          跳过 → 手动编辑
        </button>
      </div>

      <p className="text-muted-foreground text-xs text-center">
        💡 AI 处理完成后页面将自动刷新。<br />
        你也可以关闭此页面，稍后从「我的导览」中查看结果。
      </p>
    </div>
  );
}
