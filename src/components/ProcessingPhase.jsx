import { useState, useEffect, useRef } from 'react';
import { supabase } from '../lib/supabase';

/**
 * Shown after user saves a draft and triggers AI processing.
 * Polls Supabase to detect when AI has finished writing locations.
 * Provides clear guidance on what's happening and what to do.
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
  const [hasResult, setHasResult] = useState(false);
  const [copied, setCopied] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const intervalRef = useRef(null);
  const timerRef = useRef(null);

  // Poll Supabase every 5 seconds to check if AI has written locations
  useEffect(() => {
    const check = async () => {
      if (!draftTourId) return;
      const { data } = await supabase
        .from('locations')
        .select('id', { count: 'exact', head: true })
        .eq('tour_id', draftTourId);
      const count = data ?? (Array.isArray(data) ? data.length : 0);
      setPollCount(prev => prev + 1);
      if (count > 0) {
        setHasResult(true);
        if (intervalRef.current) clearInterval(intervalRef.current);
        if (timerRef.current) clearInterval(timerRef.current);
        setTimeout(() => onCheckDone(true), 1500);
      }
    };

    // Initial check after 3s
    const initial = setTimeout(check, 3000);
    // Then poll every 5s
    intervalRef.current = setInterval(check, 5000);

    return () => {
      clearTimeout(initial);
      if (intervalRef.current) clearInterval(intervalRef.current);
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [draftTourId, onCheckDone]);

  // Elapsed time counter
  useEffect(() => {
    timerRef.current = setInterval(() => setElapsed(prev => prev + 1), 1000);
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, []);

  const copyId = () => {
    if (!draftTourId) return;
    navigator.clipboard.writeText(draftTourId).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }).catch(() => {});
  };

  const formatElapsed = (s) => {
    if (s < 60) return `${s} 秒`;
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return `${m} 分 ${sec} 秒`;
  };

  if (hasResult) {
    return (
      <div className="space-y-4">
        <section className="bg-green-600/10 border border-green-600/20 rounded-2xl p-8 text-center">
          <div className="text-6xl mb-6">✅</div>
          <h2 className="text-green-400 font-bold text-lg mb-2">AI 处理完成！</h2>
          <p className="text-gray-400 text-sm">正在刷新页面以加载结果...</p>
        </section>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Main processing card */}
      <section className="bg-[#1c1c32] rounded-2xl p-6 border border-white/5 text-center">
        {/* Spinner */}
        <div className="mb-4">
          <div className="inline-block w-16 h-16 border-4 border-white/10 border-t-red-600 rounded-full animate-spin" />
        </div>

        <h2 className="text-white font-bold text-lg mb-2">🤖 AI 正在分析处理</h2>

        {/* Status info */}
        <div className="flex items-center justify-center gap-4 text-xs text-gray-400 mb-5">
          <div className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-yellow-500 animate-pulse" />
            等待 AI 处理
          </div>
          <span>·</span>
          <div>已等待 {formatElapsed(elapsed)}</div>
          <span>·</span>
          <div>已检测 {pollCount} 次</div>
        </div>

        {/* Time estimate */}
        <div className="bg-[#0f0f1a] rounded-xl px-4 py-3 mb-5 max-w-sm mx-auto">
          <div className="text-gray-400 text-xs mb-2">⏱ 预估时间</div>
          <div className="flex justify-between text-xs">
            <div className="text-center">
              <div className="text-white font-bold">1–2 分钟</div>
              <div className="text-gray-500">简单导览<br/>(地点少/文本短)</div>
            </div>
            <div className="w-px bg-white/10" />
            <div className="text-center">
              <div className="text-white font-bold">3–5 分钟</div>
              <div className="text-gray-500">完整导览<br/>(多地点+四层内容)</div>
            </div>
            <div className="w-px bg-white/10" />
            <div className="text-center">
              <div className="text-white font-bold">5–10 分钟</div>
              <div className="text-gray-500">大型导览<br/>(长篇+复杂路线)</div>
            </div>
          </div>
        </div>

        {/* How it works */}
        <div className="text-left bg-[#0f0f1a] rounded-xl p-4 mb-5">
          <h3 className="text-white text-xs font-bold mb-3">📋 处理流程</h3>
          <div className="space-y-2">
            {[
              { done: true, text: '草稿已保存到数据库' },
              { done: true, text: 'Claude 读取源材料（小说文本/标题）' },
              { done: false, text: '提取小说中涉及的地点' },
              { done: false, text: '通过高德地图查找精确坐标' },
              { done: false, text: '生成四层内容（小说场景/历史掌故/民间传说/民俗风情）' },
              { done: false, text: '搜索网络，规划真实徒步路线' },
              { done: false, text: '写入数据库，自动刷新页面' },
            ].map((step, i) => (
              <div key={i} className="flex items-center gap-2 text-xs">
                <span className={step.done ? 'text-green-400' : 'text-gray-600'}>
                  {step.done ? '●' : '○'}
                </span>
                <span className={step.done ? 'text-green-400/80' : 'text-gray-500'}>{step.text}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Tour ID for Claude */}
        {draftTourId && (
          <div className="bg-gradient-to-r from-red-600/10 to-purple-600/10 border border-red-600/20 rounded-xl p-4 mb-5">
            <div className="text-gray-400 text-xs mb-2">将此 ID 发给 Claude 开始处理：</div>
            <div className="flex items-center gap-2 justify-center">
              <code className="text-green-400 text-sm font-mono bg-[#0f0f1a] px-3 py-1.5 rounded-lg select-all">
                {draftTourId}
              </code>
              <button
                onClick={copyId}
                className="px-3 py-1.5 bg-white/10 text-white rounded-lg text-xs hover:bg-white/20 transition-colors"
              >
                {copied ? '✓ 已复制' : '📋 复制'}
              </button>
            </div>
            <div className="text-gray-500 text-xs mt-2">
              在 Claude Code 对话中输入：「处理导览 {draftTourId.substring(0, 8)}...」
            </div>
          </div>
        )}

        {/* Submitted summary */}
        <div className="text-left bg-[#0f0f1a] rounded-xl p-4 mb-5">
          <h3 className="text-gray-400 text-xs mb-2">📦 已提交的材料</h3>
          <div className="space-y-1.5 text-xs">
            {title && <div className="text-white"><strong>标题：</strong>{title}</div>}
            {destName && <div className="text-white"><strong>目的地：</strong>{destName}{destRegion ? `（${destRegion}）` : ''}</div>}
            {novelTitle && <div className="text-white"><strong>作品：</strong>{novelTitle}{novelAuthor ? ` — ${novelAuthor}` : ''}</div>}
            {sourceText && <div className="text-gray-400"><strong>文本：</strong>已粘贴 {sourceText.length} 字</div>}
            {!sourceText && !novelTitle && <div className="text-yellow-400">⚠️ 未提供源材料，AI 只能依据标题和目的地做基础分析</div>}
          </div>
        </div>
      </section>

      {/* Action buttons */}
      <div className="space-y-2">
        {draftTourId && (
          <button
            onClick={copyId}
            className="w-full py-3 bg-red-600 text-white rounded-xl text-sm font-semibold"
          >
            {copied ? '✓ 已复制导览 ID' : '📋 复制导览 ID，发给 Claude'}
          </button>
        )}
        <div className="flex gap-2">
          <button
            onClick={onBack}
            className="flex-1 py-3 bg-white/5 text-gray-400 rounded-xl text-sm"
          >
            ← 返回修改信息
          </button>
          <button
            onClick={onSkip}
            className="flex-1 py-3 bg-white/5 text-gray-400 rounded-xl text-sm"
          >
            跳过 → 手动编辑
          </button>
        </div>
        <button
          onClick={() => window.location.href = '/'}
          className="w-full py-2 text-gray-500 text-xs hover:text-gray-400 transition-colors"
        >
          先回首页看看其他导览 →
        </button>
      </div>

      {/* Auto-detection hint */}
      <p className="text-gray-600 text-xs text-center">
        💡 AI 处理完成后本页将自动刷新，无需手动操作。<br/>
        你也可以随时关闭此页面，稍后从首页重新进入。
      </p>
    </div>
  );
}
