import { useState, useEffect, useRef } from 'react';
import { supabase } from '../lib/supabase';

const SB_URL = import.meta.env.VITE_SUPABASE_URL || '';
const SB_ANON = import.meta.env.VITE_SUPABASE_ANON_KEY || '';

/**
 * Waiting screen during AI processing.
 * 轮询 tours.status：done → 跳转审核；error → 显示失败 + 重试；
 * processing → 继续等待。避免处理失败时无限死等。
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
  onRetry,
}) {
  const [pollCount, setPollCount] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState(null);
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

  // Fetch token once at mount — avoids triggering Supabase auto-refresh on every poll
  const tokenRef = useRef(null);
  useEffect(() => { supabase.auth.getSession().then(s => { tokenRef.current = s.data.session?.access_token; }); }, []);

  useEffect(() => {
    const check = async () => {
      if (!draftTourId) return;
      try {
        // AbortController prevents hung connections when DevTools Network panel is open
        const ac = new AbortController();
        const t = setTimeout(() => ac.abort(), 10000);
        const res = await fetch(
          `${SB_URL}/rest/v1/tours?id=eq.${draftTourId}&select=status&limit=1`,
          {
            signal: ac.signal,
            headers: {
              apikey: SB_ANON,
              Authorization: `Bearer ${tokenRef.current || SB_ANON}`,
            },
          }
        );
        clearTimeout(t);
        setPollCount(prev => prev + 1);
        if (!res.ok) return;
        const data = await res.json();
        const status = Array.isArray(data) ? data[0]?.status : undefined;
        if (status === 'error') {
          // Edge Function 处理失败，停止轮询并显示错误
          if (intervalRef.current) clearInterval(intervalRef.current);
          if (timerRef.current) clearInterval(timerRef.current);
          setError('AI 处理失败：服务器端出错，请重新处理');
          return;
        }
        if (status === 'done') {
          if (intervalRef.current) clearInterval(intervalRef.current);
          if (timerRef.current) clearInterval(timerRef.current);
          setTimeout(() => onCheckDone(), 800);
        }
        // 'processing'（或暂未变更）→ 继续轮询
      } catch {
        // retry on next poll
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

  // ── 处理失败状态：停止轮询，给出错误 + 重试 ──
  if (error) {
    return (
      <div className="space-y-4">
        <section className="bg-card rounded-2xl p-6 border border-red-500/30 text-center">
          <div className="text-4xl mb-3">⚠️</div>
          <h2 className="text-white font-bold text-lg mb-2">AI 处理失败</h2>
          <p className="text-red-400 text-sm mb-5">{error}</p>
          <div className="flex gap-2">
            {onRetry && (
              <button
                onClick={onRetry}
                className="flex-1 py-3 bg-gradient-to-r from-red-600 to-purple-600 text-white rounded-xl text-sm font-bold hover:from-red-700 hover:to-purple-700 transition-colors"
              >
                🔄 重新处理
              </button>
            )}
            <button
              onClick={onBack}
              className="flex-1 py-3 bg-white/5 text-muted-foreground rounded-xl text-sm hover:bg-white/10 transition-colors"
            >
              ← 返回修改
            </button>
          </div>
        </section>
        <p className="text-muted-foreground text-xs text-center">
          重新处理会再次调用 AI（提取地点、生成内容、规划路线）。<br />
          若反复失败，请检查「目的地 / 地区」格式（如：湖南省衡阳市），或改用「跳过 → 手动编辑」。
        </p>
      </div>
    );
  }

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
