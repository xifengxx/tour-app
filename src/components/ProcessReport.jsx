import { useState } from 'react';
import { AlertTriangle, ChevronDown, ClipboardList, ShieldAlert, Wrench } from 'lucide-react';

/**
 * AI 处理质量报告（P1-1）。
 *
 * process-tour 一直在诊断路线缺陷（交通衔接缺失、路线被静默丢弃、地点被坐标校验剔除），
 * 但结果只写进 tours.process_report，审核页从不读取——创作者看不到，就只能把问题
 * 反馈给开发者改启发式。本组件把那份报告交回给能当场修路线的人。
 */

const LEVEL_STYLE = {
  blocking: { wrap: 'border-l-2 border-l-destructive bg-destructive/[0.05]', icon: ShieldAlert, iconCls: 'text-destructive' },
  warning: { wrap: 'border-l-2 border-l-gamboge bg-gamboge/[0.07]', icon: AlertTriangle, iconCls: 'text-gamboge' },
  auto: { wrap: 'border-l-2 border-l-pine/50 bg-pine/[0.05]', icon: Wrench, iconCls: 'text-pine' },
  info: { wrap: 'border-l-2 border-l-border bg-muted/40', icon: ClipboardList, iconCls: 'text-muted-foreground' },
};

function Line({ level, text }) {
  const style = LEVEL_STYLE[level] || LEVEL_STYLE.info;
  const Icon = style.icon;
  return (
    <li className={`${style.wrap} rounded-r px-2.5 py-1.5 flex gap-2 items-start text-xs`}>
      <Icon className={`h-3.5 w-3.5 mt-0.5 shrink-0 ${style.iconCls}`} aria-hidden="true" />
      <span className="text-foreground/90 leading-relaxed break-words">{text}</span>
    </li>
  );
}

/** 单条路线的缺陷列表，嵌在路线卡片里，让告警和它描述的路线同屏。 */
export function RouteIssueList({ issues }) {
  if (!issues?.length) return null;
  const blocking = issues.filter(i => i.level === 'blocking').length;
  return (
    <div className="mt-2" role="status" aria-label={`该路线有 ${issues.length} 个待核实问题`}>
      <p className={`text-xs font-serif mb-1 ${blocking ? 'text-destructive' : 'text-gamboge'}`}>
        {blocking ? `需核实后才能发布：${blocking} 项` : '待核实'}
        {issues.length - blocking > 0 && ` · ${issues.length - blocking} 项交通衔接由系统按距离/高差推断`}
      </p>
      <ul className="space-y-1 list-none">
        {issues.map((issue, i) => <Line key={i} level={issue.level === 'blocking' ? 'blocking' : 'warning'} text={issue.text} />)}
      </ul>
    </div>
  );
}

function Metric({ label, value, hint }) {
  return (
    <div className="bg-background border border-border rounded px-2 py-1.5">
      <div className="text-[10px] text-muted-foreground">{label}</div>
      <div className="text-xs text-foreground font-serif">{value}</div>
      {hint && <div className="text-[10px] text-muted-foreground">{hint}</div>}
    </div>
  );
}

export default function ProcessReport({ summary, className = '' }) {
  // 有任何待核实项就默认展开：只收起完全干净的报告。
  // 若把"需核实"的告警折叠起来，它和不存在没有区别——这正是 process_report 过去的下场。
  const [open, setOpen] = useState((summary?.blockingCount || 0) > 0 || (summary?.reviewCount || 0) > 0);
  if (!summary?.available) return null;

  const { metrics, general, routeIssues, blockingCount, reviewCount, unpublished } = summary;
  const routedIssues = (routeIssues || []).filter(r => r.issues?.length);
  const knowledgeWeak = !['curated', 'official', 'creator-confirmed'].includes(metrics.knowledgeSource)
    || (metrics.knowledgeConfidence != null && Number(metrics.knowledgeConfidence) < 0.85);
  const blockingGeneral = general.filter(w => w.level === 'blocking');
  const rest = general.filter(w => w.level !== 'blocking');

  return (
    <section className={`bg-card rounded-lg border border-border ${className}`}>
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        aria-expanded={open}
        className="w-full flex items-center gap-2 px-4 py-3 text-left"
      >
        <ClipboardList className="h-4 w-4 text-dai shrink-0" aria-hidden="true" />
        <h2 className="text-foreground font-serif font-bold text-sm flex-1">AI 处理报告</h2>
        {blockingCount > 0 ? (
          <span className="text-[11px] px-2 py-0.5 rounded-full bg-destructive/10 text-destructive">
            {blockingCount} 项需核实后才能发布
          </span>
        ) : reviewCount > 0 ? (
          <span className="text-[11px] px-2 py-0.5 rounded-full bg-gamboge/10 text-gamboge">
            {reviewCount} 项待核实
          </span>
        ) : (
          <span className="text-[11px] px-2 py-0.5 rounded-full bg-pine/10 text-pine">无明显结构问题</span>
        )}
        <ChevronDown className={`h-4 w-4 text-muted-foreground transition-transform ${open ? 'rotate-180' : ''}`} aria-hidden="true" />
      </button>

      {open && (
        <div className="px-4 pb-4 space-y-3">
          {blockingCount > 0 && (
            <div className="border-l-2 border-l-destructive bg-destructive/[0.05] rounded-r px-2.5 py-2 flex gap-2 items-start">
              <ShieldAlert className="h-3.5 w-3.5 mt-0.5 text-destructive shrink-0" aria-hidden="true" />
              <p className="text-xs text-foreground/90 leading-relaxed">
                闸门拦下 <b>{blockingCount}</b> 个阻断级路线问题，本导览需核实后才能发布。
                {unpublished && '该导览原先是公开的，因未过检已自动转为私有，核实后请重新开启公开。'}
                可直接删除对应路线、调整站点顺序，或重新分析。
              </p>
            </div>
          )}

          {summary.repairs > 0 && (
            <p className="text-[11px] text-pine">
              闸门已自动修复 {summary.repairs} 处（重排顺序或按容量精简站点），行程文案按修复后的站点生成。
            </p>
          )}

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5">
            <Metric label="地点" value={`${metrics.locations} 个`} hint={metrics.rejected ? `坐标校验剔除 ${metrics.rejected}` : undefined} />
            <Metric label="路线" value={`${metrics.routes} 条`} hint={metrics.plans && metrics.plans !== metrics.routes ? `计划 ${metrics.plans} 条` : undefined} />
            <Metric label="交通问题" value={`${metrics.graphIssues} 处`} hint={metrics.graphChecked ? `已校验 ${metrics.graphChecked} 条` : undefined} />
            <Metric label="预计总时长" value={metrics.estimatedHours != null ? `${metrics.estimatedHours} 小时` : '未估算'} hint="全部路线合计" />
          </div>

          <p className="text-[11px] text-muted-foreground">
            路线知识来源：<span className="text-foreground font-serif">{metrics.knowledgeSource}</span>
            {metrics.knowledgeDestination && `（匹配「${metrics.knowledgeDestination}」）`}
            {metrics.knowledgeConfidence != null && ` · 置信度 ${metrics.knowledgeConfidence}`}
          </p>

          {knowledgeWeak && (
            <div className="border-l-2 border-l-gamboge bg-gamboge/[0.07] rounded-r px-2.5 py-2 flex gap-2 items-start">
              <AlertTriangle className="h-3.5 w-3.5 mt-0.5 text-gamboge shrink-0" aria-hidden="true" />
              <p className="text-xs text-foreground/90 leading-relaxed">
                该目的地的分区/步道/交通资料<b>尚未经人工核实</b>，系统按距离与高差推断交通方式。
                请逐条确认下方衔接是否成立；不成立的路线建议直接删除或手工调整站点。
              </p>
            </div>
          )}

          {routedIssues.length > 0 && (
            <div>
              <p className="text-xs text-muted-foreground mb-1">按路线定位（同一条路线的站点顺序与交通衔接需逐条确认）</p>
              <ul className="space-y-2 list-none">
                {routedIssues.map(route => (
                  <li key={route.routeId || route.label}>
                    <p className="text-xs font-serif text-dai mb-1">
                      {route.label}{route.title ? ` · ${route.title}` : ''}
                      {!route.routeId && <span className="text-muted-foreground">（该路线已不在当前列表）</span>}
                    </p>
                    <ul className="space-y-1 list-none">
                      {route.issues.map((issue, i) => (
                        <Line key={i} level={issue.level === 'blocking' ? 'blocking' : 'warning'} text={issue.text} />
                      ))}
                    </ul>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {(blockingGeneral.length > 0 || rest.length > 0) && (
            <ul className="space-y-1 list-none">
              {blockingGeneral.map((w, i) => <Line key={`b${i}`} level="blocking" text={w.text} />)}
              {rest.map((w, i) => <Line key={`r${i}`} level={w.level} text={w.text} />)}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}
