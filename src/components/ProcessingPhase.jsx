import { useState, useEffect, useRef } from 'react';
import { supabase } from '../lib/supabase';
import SealLogo from './SealLogo';
import { Check, RefreshCw, ArrowLeft, TriangleAlert, ScrollText, Package } from 'lucide-react';

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
  const doneTimeoutRef = useRef(null);
  const onCheckDoneRef = useRef(onCheckDone);

  useEffect(() => {
    onCheckDoneRef.current = onCheckDone;
  }, [onCheckDone]);

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

  // 总超时：Edge Function 正常 1-2 分钟；>4 分钟大概率是 worker 被平台硬杀（status 永远 processing）
  // → 停止死等，给出可操作出口（此前会无限转圈）
  const TIMEOUT_SEC = 240;

  useEffect(() => {
    const check = async () => {
      if (!draftTourId) return;
      // 总超时检测（即使轮询请求本身正常，也要跳出死等）
      if (Math.floor((Date.now() - startTimeRef.current) / 1000) > TIMEOUT_SEC) {
        if (intervalRef.current) clearInterval(intervalRef.current);
        if (timerRef.current) clearInterval(timerRef.current);
        setError('AI 处理超时：服务器处理超过 4 分钟未返回，可能已被中断。请直接「重新处理」，或检查目的地/地区格式后重试。');
        return;
      }
      try {
        // AbortController prevents hung connections when DevTools Network panel is open
        const ac = new AbortController();
        const t = setTimeout(() => ac.abort(), 10000);
        const res = await fetch(
          `${SB_URL}/rest/v1/tours?id=eq.${draftTourId}&select=status,process_error&limit=1`,
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
        let data;
        if (res.ok) {
          data = await res.json();
        } else {
          // process_error 列尚未添加时 PostgREST 返回 400 → 退回只查 status，轮询不中断
          const res2 = await fetch(
            `${SB_URL}/rest/v1/tours?id=eq.${draftTourId}&select=status&limit=1`,
            { headers: { apikey: SB_ANON, Authorization: `Bearer ${tokenRef.current || SB_ANON}` } }
          );
          if (!res2.ok) return;
          data = await res2.json();
        }
        const row = Array.isArray(data) ? data[0] : undefined;
        const status = row?.status;
        if (status === 'error') {
          // Edge Function 处理失败，停止轮询并显示错误（v70 起展示服务端真实原因）
          if (intervalRef.current) clearInterval(intervalRef.current);
          if (timerRef.current) clearInterval(timerRef.current);
          const reason = String(row?.process_error || '').trim();
          setError(reason ? `AI 处理失败：${reason}` : 'AI 处理失败：服务器端出错，请重新处理');
          return;
        }
        if (status === 'done') {
          if (intervalRef.current) clearInterval(intervalRef.current);
          if (timerRef.current) clearInterval(timerRef.current);
          doneTimeoutRef.current = setTimeout(() => onCheckDoneRef.current(), 800);
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
      if (doneTimeoutRef.current) clearTimeout(doneTimeoutRef.current);
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
        <section className="bg-card rounded-lg p-6 border border-primary/30 text-center">
          <div className="w-12 h-12 mx-auto mb-3 rounded-full border border-primary/30 bg-primary/5 flex items-center justify-center">
            <TriangleAlert className="h-5 w-5 text-primary" />
          </div>
          <h2 className="text-foreground font-serif font-bold text-lg mb-2">AI 处理失败</h2>
          <p className="text-primary text-sm mb-5">{error}</p>
          <div className="flex gap-2">
            {onRetry && (
              <button
                onClick={onRetry}
                className="flex-1 py-3 bg-primary text-primary-foreground rounded-lg text-sm font-bold hover:bg-primary/90 transition-colors flex items-center justify-center gap-1.5"
              >
                <RefreshCw className="h-4 w-4" /> 重新处理
              </button>
            )}
            <button
              onClick={onBack}
              className="flex-1 py-3 bg-black/[0.05] text-muted-foreground rounded-lg text-sm hover:bg-black/10 transition-colors flex items-center justify-center gap-1.5"
            >
              <ArrowLeft className="h-4 w-4" /> 返回修改
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
      <section className="bg-card rounded-lg p-6 border border-border text-center relative overflow-hidden">
        {/* 竖排装饰 */}
        <div className="vertical-rl font-kai text-xs text-muted-foreground/50 absolute right-4 top-6 select-none hidden sm:block">
          研墨展卷，静候佳作
        </div>

        {/* 研墨展卷：朱印呼吸 */}
        <div className="mb-4 flex justify-center">
          <div className="anim-seal-pulse">
            <SealLogo size={56} char="墨" />
          </div>
        </div>

        <h2 className="text-foreground font-serif font-black text-lg mb-1.5">研墨展卷中</h2>
        <p className="font-kai text-muted-foreground text-sm mb-5">AI 正在提取地点、研写内容、规划路线</p>

        {/* 墨线流动 */}
        <div className="relative h-[3px] bg-border/70 rounded-full overflow-hidden max-w-xs mx-auto mb-5">
          <div className="absolute inset-y-0 w-1/4 bg-primary rounded-full anim-ink" />
        </div>

        <div className="flex items-center justify-center gap-4 text-xs text-muted-foreground mb-5">
          <div className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-gamboge animate-pulse" />
            处理中
          </div>
          <span>·</span>
          <div>已等待 {formatElapsed(elapsed)}</div>
          <span>·</span>
          <div>已检测 {pollCount} 次</div>
        </div>

        <div className="bg-background rounded-lg px-4 py-3 mb-5 max-w-sm mx-auto border border-border/60">
          <div className="text-muted-foreground text-xs mb-2 font-serif tracking-wide">预估时间</div>
          <div className="flex justify-between text-xs">
            <div className="text-center px-2">
              <div className="text-foreground font-bold">30–60 秒</div>
              <div className="text-muted-foreground">简单导览</div>
            </div>
            <div className="w-px bg-border" />
            <div className="text-center px-2">
              <div className="text-foreground font-bold">1–2 分钟</div>
              <div className="text-muted-foreground">完整导览</div>
            </div>
            <div className="w-px bg-border" />
            <div className="text-center px-2">
              <div className="text-foreground font-bold">2–5 分钟</div>
              <div className="text-muted-foreground">大型导览</div>
            </div>
          </div>
        </div>

        <div className="text-left bg-background rounded-lg p-4 mb-4 border border-border/60">
          <h3 className="text-foreground text-xs font-serif font-bold mb-3 flex items-center gap-1.5">
            <ScrollText className="h-3.5 w-3.5 text-primary" /> AI 自动处理流程
          </h3>
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
                {i < 2
                  ? <Check className="h-3.5 w-3.5 text-pine flex-shrink-0" />
                  : <span className="w-3.5 h-3.5 rounded-full border border-border flex-shrink-0" />}
                <span className={i < 2 ? 'text-pine' : 'text-muted-foreground'}>{text}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="text-left bg-background rounded-lg p-4 border border-border/60">
          <h3 className="text-muted-foreground text-xs font-serif mb-2 flex items-center gap-1.5">
            <Package className="h-3.5 w-3.5 text-dai" /> 已提交的材料
          </h3>
          <div className="space-y-1.5 text-xs">
            {title && <div className="text-foreground"><strong>标题：</strong>{title}</div>}
            {destName && <div className="text-foreground"><strong>目的地：</strong>{destName}{destRegion ? `（${destRegion}）` : ''}</div>}
            {novelTitle && <div className="text-foreground"><strong>作品：</strong>{novelTitle}{novelAuthor ? ` — ${novelAuthor}` : ''}</div>}
            {sourceText && <div className="text-muted-foreground"><strong>文本：</strong>已粘贴 {sourceText.length} 字</div>}
            {!sourceText && !novelTitle && <div className="text-ochre">未提供源材料，AI 只能做基础分析</div>}
          </div>
        </div>
      </section>

      <div className="flex gap-2">
        <button
          onClick={onBack}
          className="flex-1 py-3 bg-black/[0.05] text-muted-foreground rounded-lg text-sm hover:bg-black/10 transition-colors flex items-center justify-center gap-1.5"
        >
          <ArrowLeft className="h-4 w-4" /> 返回修改
        </button>
        <button
          onClick={onSkip}
          className="flex-1 py-3 bg-black/[0.05] text-muted-foreground rounded-lg text-sm hover:bg-black/10 transition-colors"
        >
          跳过 → 手动编辑
        </button>
      </div>

      <p className="text-muted-foreground text-xs text-center">
        AI 处理完成后页面将自动刷新。<br />
        你也可以关闭此页面，稍后从「我的导览」中查看结果。
      </p>
    </div>
  );
}
