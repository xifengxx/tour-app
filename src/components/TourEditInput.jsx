import { ClipboardList, BookOpen, Save, Sparkles, Loader2 } from 'lucide-react';

/**
 * 导览创建/编辑 · 第一阶段：基本信息 + 源材料输入表单。
 * 从 TourEdit.jsx 拆分，纯受控组件（状态由父组件持有）。
 */
export default function TourEditInput({
  title, setTitle, subtitle, setSubtitle, primaryColor, setPrimaryColor,
  destName, setDestName, destRegion, setDestRegion, isPublic, setIsPublic,
  destType, setDestType, destTypes = [], checkResult, setCheckResult, checking,
  novelTitle, setNovelTitle, novelAuthor, setNovelAuthor, novelEra, setNovelEra,
  novelSynopsis, setNovelSynopsis, sourceText, setSourceText,
  draftTourId, saving, handleSaveBasic, handleSaveDraft,
}) {
  const inputCls = "w-full bg-background text-foreground rounded-lg px-3 py-2.5 text-sm border border-border mt-1 outline-none focus:border-primary";
  // 规范名与用户输入只差标点时不必提示「改用」
  const normForUi = s => String(s || '').replace(/[\s·省市区县]/g, '');
  const normAndDiff = (a, b) => normForUi(a) !== normForUi(b);
  return (
    <div className="space-y-4">
      {/* Step indicator · 壹贰叁 */}
      <div className="flex items-center gap-2 mb-2">
        <div className="w-8 h-8 rounded-md bg-primary text-primary-foreground flex items-center justify-center text-sm font-serif font-bold">壹</div>
        <div className="text-foreground font-serif font-semibold text-sm">基本信息与源材料</div>
        <div className="flex-1 h-px bg-border" />
        <div className="w-8 h-8 rounded-md bg-black/[0.04] border border-border text-muted-foreground flex items-center justify-center text-sm font-serif">贰</div>
        <div className="w-8 h-8 rounded-md bg-black/[0.04] border border-border text-muted-foreground flex items-center justify-center text-sm font-serif">叁</div>
      </div>

      {/* Basic info */}
      <section className="bg-card rounded-lg p-5 border border-border space-y-3">
        <h2 className="text-foreground font-serif font-bold text-sm flex items-center gap-1.5">
          <ClipboardList className="h-4 w-4 text-primary" /> 导览信息
        </h2>
        <div>
          <label className="text-muted-foreground text-xs">标题 *</label>
          <input value={title} onChange={e => setTitle(e.target.value)} className={inputCls} placeholder="如：剑出衡山 · 南岳巡礼" />
        </div>
        <div>
          <label className="text-muted-foreground text-xs">副标题</label>
          <input value={subtitle} onChange={e => setSubtitle(e.target.value)} className={inputCls} placeholder="如：跟着赵荣的脚步，登五神峰寻剑神之路" />
        </div>
        <div className="flex gap-3">
          <div className="flex-1">
            <label className="text-muted-foreground text-xs">目的地 *</label>
            <input value={destName} onChange={e => { setDestName(e.target.value); setCheckResult?.(null); }} className={inputCls} placeholder="如：南岳衡山" />
          </div>
          <div className="flex-1">
            <label className="text-muted-foreground text-xs">地区 *</label>
            <input value={destRegion} onChange={e => { setDestRegion(e.target.value); setCheckResult?.(null); }} className={inputCls} placeholder="如：湖南省衡阳市" />
          </div>
        </div>

        {/* 目的地类型：原先硬编码 mountain，城市/湖泊导览也被按山岳动线排 */}
        <div>
          <label className="text-muted-foreground text-xs">目的地类型 *</label>
          <div className="flex flex-wrap gap-1.5 mt-1">
            {destTypes.map(t => (
              <button
                key={t.value}
                type="button"
                onClick={() => setDestType(t.value)}
                className={`px-2.5 py-1 rounded-md text-xs border transition-colors ${
                  destType === t.value
                    ? 'border-primary bg-primary/10 text-primary'
                    : 'border-border text-muted-foreground hover:border-primary/40'
                }`}
              >{t.label}</button>
            ))}
          </div>
          <p className="text-[10px] text-muted-foreground mt-1 leading-relaxed">
            类型决定管线用哪套锚点与动线逻辑。选「山岳」才会按步道、分区、高差规则排；城市与湖泊选错会让路线出现假的登山段。
          </p>
        </div>

        {/* 提交前核对结果 */}
        {checking && (
          <div className="text-[11px] text-muted-foreground flex items-center gap-1.5">
            <Loader2 className="h-3 w-3 animate-spin" /> 正在核对目的地坐标与地区…
          </div>
        )}
        {!checking && checkResult && (
          <div className={`text-[11px] leading-relaxed rounded-md px-2.5 py-2 border ${
            checkResult.level === 'fail' ? 'border-primary/40 bg-primary/[0.06] text-primary'
              : checkResult.level === 'warn' ? 'border-gamboge/40 bg-gamboge/[0.06] text-gamboge'
                : 'border-pine/40 bg-pine/[0.06] text-pine'
          }`}>
            {checkResult.message}
            {checkResult.level !== 'fail' && checkResult.canonical && normAndDiff(checkResult.canonical, destRegion) && (
              <button
                type="button"
                onClick={() => { setDestRegion(checkResult.canonical); setCheckResult?.(null); }}
                className="ml-2 underline underline-offset-2 hover:opacity-80"
              >改用「{checkResult.canonical}」</button>
            )}
          </div>
        )}
        <div className="flex gap-3 items-center">
          <div>
            <label className="text-muted-foreground text-xs">主题色</label>
            <input type="color" value={primaryColor} onChange={e => setPrimaryColor(e.target.value)} className="w-10 h-10 rounded-lg border-0 cursor-pointer mt-1 bg-transparent" />
          </div>
          <label className="flex items-center gap-2 text-muted-foreground text-xs">
            <input type="checkbox" checked={isPublic} onChange={e => setIsPublic(e.target.checked)} className="rounded accent-primary" />
            公开（其他人可见）
          </label>
        </div>
      </section>

      {/* Source materials */}
      <section className="bg-card rounded-lg p-5 border border-border space-y-3">
        <h2 className="text-foreground font-serif font-bold text-sm flex items-center gap-1.5">
          <BookOpen className="h-4 w-4 text-primary" /> 源材料 <span className="text-muted-foreground font-sans font-normal text-xs">— 提供得越多，AI 分析越精准</span>
        </h2>
        <div>
          <label className="text-muted-foreground text-xs">小说 / 作品名称</label>
          <input value={novelTitle} onChange={e => setNovelTitle(e.target.value)} className={inputCls} placeholder="如：笑傲江湖" />
        </div>
        <div className="flex gap-3">
          <div className="flex-1">
            <label className="text-muted-foreground text-xs">作者</label>
            <input value={novelAuthor} onChange={e => setNovelAuthor(e.target.value)} className={inputCls} placeholder="如：金庸" />
          </div>
          <div className="flex-1">
            <label className="text-muted-foreground text-xs">时代背景</label>
            <input value={novelEra} onChange={e => setNovelEra(e.target.value)} className={inputCls} placeholder="如：明代" />
          </div>
        </div>
        <div>
          <label className="text-muted-foreground text-xs">故事梗概</label>
          <textarea value={novelSynopsis} onChange={e => setNovelSynopsis(e.target.value)} rows={3} className={`${inputCls} resize-none`} placeholder="简要概述故事与目的地的关系..." />
        </div>
        <div>
          <label className="text-muted-foreground text-xs">
            小说文本 / 关键章节
            <span className="text-muted-foreground ml-1">（粘贴涉及目的地的章节文字，AI 会从中提取地点和原文引用）</span>
          </label>
          <textarea value={sourceText} onChange={e => setSourceText(e.target.value)} rows={8} className={`${inputCls} resize-none font-mono`} placeholder={"粘贴小说中涉及该目的地的章节，AI 会从中提取地点与原文引用...\n\n留空时 AI 将基于目的地常识生成导览。"} />
        </div>

        <div className="flex gap-2">
          {draftTourId && (
            <button onClick={handleSaveBasic} disabled={saving} className="flex-1 py-3.5 bg-black/[0.05] text-foreground rounded-lg text-sm font-bold hover:bg-black/10 transition-colors disabled:opacity-50 flex items-center justify-center gap-1.5">
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              {saving ? '保存中...' : '保存修改'}
            </button>
          )}
          <button onClick={handleSaveDraft} disabled={saving} className="flex-1 py-3.5 bg-primary text-primary-foreground rounded-lg text-sm font-bold disabled:opacity-50 hover:bg-primary/90 transition-colors shadow-[0_6px_20px_-8px_rgba(194,64,42,0.5)] flex items-center justify-center gap-1.5">
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
            {saving ? '保存中...' : draftTourId ? 'AI 重新分析' : 'AI 分析：生成地点、内容与路线'}
          </button>
        </div>
        <p className="text-muted-foreground text-xs text-center leading-relaxed">
          点击「AI 分析」后全自动完成：<br />
          ① 分析文本提取所有地点 → ② 高德 API 校验精确坐标<br />
          ③ 生成四层内容（小说/历史/传说/民俗）→ ④ 规划游览路线 → ⑤ 写入数据库
        </p>
      </section>
    </div>
  );
}
