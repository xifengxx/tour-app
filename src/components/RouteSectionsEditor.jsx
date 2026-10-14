import { useState } from 'react';
import { ChevronDown, ChevronUp, Plus, Trash2 } from 'lucide-react';
import {
  addSection, flattenStops, groupSummary, moveSection, moveStopToSection,
  normalizeSections, removeSection, reorderStopInSection, updateSection,
} from '../lib/routeSections';

/**
 * 主题游分区编辑器（v93）。
 *
 * 分组现在是系统单方面决定的，创作者只能看不能改；
 * 而闸门与分层的设计前提恰恰是"把判断权交回创作者"，所以这里必须能修：
 * 片区改名、改类型、调先后，站点在片区之间移动、片区内调序。
 * 每次变更都同步写回扁平 stops，保证分区站点永远是路线站点的子集。
 */
export default function RouteSectionsEditor({ route, locations = [], onChange }) {
  const [newName, setNewName] = useState('');
  const sections = normalizeSections(route?.sections, route?.stops || []);
  const stops = route?.stops || [];
  const nameOf = (id) => locations.find(l => l.id === id)?.name || id;
  const summary = groupSummary(sections, stops);

  const commit = (next) => onChange({ sections: next, stops: flattenStops(next, stops) });
  const start = () => commit([
    { key: 'sec-核心', name: String(route?.title || '片区一').slice(0, 20), kind: '核心景区', stops, text: '' },
  ]);

  if (!sections.length) {
    return (
      <div className="mt-2 flex items-center justify-between gap-2 bg-background rounded-lg px-2 py-1.5 border border-border/60">
        <span className="text-[11px] text-muted-foreground">
          本路线为线性行程。主题游建议按景区分组：主题 → 景区 → 景区内玩法点
        </span>
        <button type="button" onClick={start} className="shrink-0 px-2 py-1 rounded bg-black/[0.05] text-muted-foreground text-xs hover:bg-black/10">
          按景区分组
        </button>
      </div>
    );
  }

  return (
    <div className="mt-2 space-y-2">
      {sections.map((sec, index) => (
        <div key={sec.key} className="bg-background rounded-lg border border-border/60 p-2">
          <div className="flex items-center gap-1.5">
            <span className="seal-outline text-[10px] px-1 py-0.5 shrink-0">{['壹', '贰', '叁', '肆', '伍', '陆', '柒', '捌'][index] || index + 1}</span>
            <input
              value={sec.name}
              onChange={e => commit(updateSection(sections, sec.key, { name: e.target.value }))}
              aria-label="片区名称"
              className="flex-1 min-w-0 bg-card text-foreground rounded px-2 py-1 text-xs font-serif outline-none"
            />
            <select
              value={sec.kind}
              onChange={e => commit(updateSection(sections, sec.key, { kind: e.target.value }))}
              aria-label="片区类型"
              className="bg-card text-muted-foreground rounded px-1 py-1 text-[11px] outline-none"
            >
              <option value="核心景区">核心景区</option>
              <option value="周边景点">周边景点</option>
            </select>
            <div className="flex items-center gap-0.5 shrink-0">
              <button type="button" title="上移片区" disabled={index === 0} onClick={() => commit(moveSection(sections, sec.key, -1))}
                className="p-1 text-muted-foreground disabled:opacity-30"><ChevronUp className="h-3.5 w-3.5" /></button>
              <button type="button" title="下移片区" disabled={index === sections.length - 1} onClick={() => commit(moveSection(sections, sec.key, 1))}
                className="p-1 text-muted-foreground disabled:opacity-30"><ChevronDown className="h-3.5 w-3.5" /></button>
              <button type="button" title="删除片区（站点退回未归组）" onClick={() => commit(removeSection(sections, sec.key))}
                className="p-1 text-primary"><Trash2 className="h-3.5 w-3.5" /></button>
            </div>
          </div>

          <textarea
            value={sec.text}
            onChange={e => commit(updateSection(sections, sec.key, { text: e.target.value }))}
            rows={2} placeholder="这个景区里怎么玩（60-120 字，详情页按片区展示）"
            className="w-full mt-1.5 bg-card text-foreground rounded px-2 py-1.5 text-xs outline-none resize-none font-kai"
          />

          <div className="flex flex-wrap gap-1 mt-1.5">
            {sec.stops.map((id, si) => (
              <span key={id} className="inline-flex items-center bg-primary/10 text-primary rounded-full text-[11px] pl-2">
                {nameOf(id)}
                <button type="button" title="片区内前移" disabled={si === 0} onClick={() => commit(reorderStopInSection(sections, sec.key, id, -1))}
                  className="px-0.5 disabled:opacity-30"><ChevronUp className="h-3 w-3" /></button>
                <button type="button" title="片区内后移" disabled={si === sec.stops.length - 1} onClick={() => commit(reorderStopInSection(sections, sec.key, id, 1))}
                  className="px-0.5 disabled:opacity-30"><ChevronDown className="h-3 w-3" /></button>
                <button type="button" title="移出本片区" onClick={() => commit(moveStopToSection(sections, id, null))}
                  className="px-1.5">✕</button>
              </span>
            ))}
            {!sec.stops.length && <span className="text-[11px] text-gamboge">该片区还没有游览点，从下方「未归组」里挑</span>}
          </div>
        </div>
      ))}

      {summary.ungrouped.length > 0 && (
        <div className="bg-background rounded-lg border border-dashed border-border p-2">
          <p className="text-[11px] text-muted-foreground mb-1.5">未归组站点（{summary.ungrouped.length}）</p>
          <div className="flex flex-wrap gap-1">
            {summary.ungrouped.map(id => (
              <label key={id} className="inline-flex items-center gap-1 bg-card border border-border rounded-full text-[11px] text-muted-foreground pl-2 pr-1 py-0.5">
                {nameOf(id)}
                <select
                  value=""
                  aria-label={`把 ${nameOf(id)} 归入片区`}
                  onChange={e => { if (e.target.value) commit(moveStopToSection(sections, id, e.target.value)); }}
                  className="bg-transparent text-[11px] outline-none text-primary"
                >
                  <option value="">归入…</option>
                  {sections.map(sec => <option key={sec.key} value={sec.key}>{sec.name}</option>)}
                </select>
              </label>
            ))}
          </div>
        </div>
      )}

      <div className="flex items-center gap-1.5">
        <input value={newName} onChange={e => setNewName(e.target.value)} placeholder="新片区名称，如 云杉坪"
          className="flex-1 min-w-0 bg-background text-foreground rounded px-2 py-1.5 text-xs border border-border outline-none" />
        <button
          type="button"
          onClick={() => { if (newName.trim()) { commit(addSection(sections, newName.trim())); setNewName(''); } }}
          className="px-2 py-1.5 bg-black/[0.05] text-muted-foreground rounded text-xs flex items-center gap-1 hover:bg-black/10"
        >
          <Plus className="h-3 w-3" /> 添加片区
        </button>
      </div>

      {summary.emptySections.length > 0 && (
        <p className="text-[11px] text-gamboge">空片区：{summary.emptySections.join('、')}，保存前建议删掉或放入站点</p>
      )}
    </div>
  );
}
