import { Check, Globe, Lock, Pencil, RefreshCw, MapPin, Route as RouteIcon, MapPinned, Footprints, Plus } from 'lucide-react';
import { ImportanceStars } from './ContentCard';

/**
 * 导览编辑 · 第三阶段：审核/编辑 AI 生成的地点、内容与路线。
 * 从 TourEdit.jsx 拆分，纯受控组件（状态与 handler 由父组件持有）。
 */
export default function TourEditReview({
  locations, routes, contentLayers, editingLoc, editingLayer, isPublic,
  onSetPhase, setIsPublic, onShowMapSearch, onSetEditingLoc, onSetEditingLayer,
  updateLocation, removeLocation, updateLayerContent,
  addRoute, updateRoute, removeRoute, toggleRouteStop, onReprocess,
}) {
  const inputCls = "bg-background text-foreground rounded-lg px-3 py-2 text-xs border border-border outline-none";
  return (
    <div className="space-y-4">
      {/* Step indicator · 壹贰叁 */}
      <div className="flex items-center gap-2 mb-2">
        <div className="w-8 h-8 rounded-md bg-pine text-white flex items-center justify-center text-xs"><Check className="h-4 w-4" /></div>
        <div className="flex-1 h-px bg-pine/30" />
        <div className="w-8 h-8 rounded-md bg-primary text-primary-foreground flex items-center justify-center text-sm font-serif font-bold">贰</div>
        <div className="text-foreground font-serif font-semibold text-sm">审核地点与内容</div>
        <div className="flex-1 h-px bg-border" />
        <div className="w-8 h-8 rounded-md bg-black/[0.04] border border-border text-muted-foreground flex items-center justify-center text-sm font-serif">叁</div>
      </div>

      {/* 公开/私密切换 + 编辑基本信息 */}
      <div className="flex items-center gap-2 mb-3 flex-wrap">
        <button
          onClick={() => setIsPublic(!isPublic)}
          className={`flex items-center gap-1.5 text-xs px-3 py-2 rounded-lg border transition-colors ${
            isPublic
              ? 'bg-pine/10 border-pine/30 text-pine'
              : 'bg-black/[0.04] border-border text-muted-foreground'
          }`}
        >
          {isPublic
            ? <><Globe className="h-3.5 w-3.5" /> 已公开（所有人可见）</>
            : <><Lock className="h-3.5 w-3.5" /> 私密（仅自己可见）</>}
        </button>
        <button
          onClick={() => onSetPhase('input')}
          className="flex items-center gap-1.5 text-xs px-3 py-2 rounded-lg border border-border bg-black/[0.04] text-muted-foreground hover:bg-black/[0.08] transition-colors"
        >
          <Pencil className="h-3.5 w-3.5" /> 编辑基本信息（标题/目的地等）
        </button>
        <span className="text-[10px] text-muted-foreground">点右上角「保存」后生效</span>
      </div>

      <button
        onClick={onReprocess}
        className="w-full py-2.5 bg-primary/10 text-primary rounded-lg text-xs border border-primary/20 mb-3 hover:bg-primary/20 transition-colors flex items-center justify-center gap-1.5"
      >
        <RefreshCw className="h-3.5 w-3.5" /> AI 重新分析（重新调用 AI，覆盖当前 AI 生成的地点 / 内容 / 路线）
      </button>

      {/* Locations */}
      <section className="bg-card rounded-lg p-5 border border-border">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-foreground font-serif font-bold text-sm flex items-center gap-1.5">
            <MapPin className="h-4 w-4 text-primary" /> 地点 ({locations.length})
          </h2>
          <button onClick={onShowMapSearch} className="px-3 py-1.5 bg-primary text-primary-foreground rounded-lg text-xs flex items-center gap-1 hover:bg-primary/90 transition-colors">
            <Plus className="h-3 w-3" /> 搜索添加
          </button>
        </div>
        {locations.length === 0 ? (
          <div className="text-center py-8">
            <div className="w-12 h-12 mx-auto mb-3 rounded-full border border-border bg-background flex items-center justify-center">
              <MapPinned className="h-5 w-5 text-muted-foreground" />
            </div>
            <p className="text-muted-foreground text-sm mb-2">还没有地点</p>
            <p className="text-muted-foreground text-xs">点击「搜索添加」打开地图搜索，或让 AI 自动生成</p>
          </div>
        ) : (
          <div className="space-y-1 max-h-60 overflow-y-auto">
            {locations.map(loc => (
              <button key={loc.id}
                onClick={() => onSetEditingLoc(editingLoc?.id === loc.id ? null : loc)}
                className={`w-full text-left px-3 py-2 rounded-lg transition-colors ${
                  editingLoc?.id === loc.id ? 'bg-primary/10 border border-primary/20' : 'bg-background hover:bg-secondary'
                }`}>
                <div className="flex items-center justify-between">
                  <span className="text-foreground text-xs flex items-center gap-1.5">
                    <ImportanceStars importance={loc.importance} className="h-2.5 w-2.5" /> {loc.name}
                  </span>
                  <span className="text-muted-foreground text-xs">{loc.lng?.toFixed(4)}, {loc.lat?.toFixed(4)}</span>
                </div>
              </button>
            ))}
          </div>
        )}
      </section>

      {/* Location editor */}
      {editingLoc && (
        <section className="bg-card rounded-lg p-5 border border-border space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-foreground font-serif font-bold text-sm flex items-center gap-1.5">
              <Pencil className="h-3.5 w-3.5 text-primary" /> {editingLoc.name}
            </h3>
            <button onClick={() => removeLocation(editingLoc.id)} className="px-3 py-1 bg-primary/10 text-primary rounded-lg text-xs">删除</button>
          </div>
          <div className="flex gap-2">
            <input value={editingLoc.name} onChange={e => updateLocation(editingLoc.id, { name: e.target.value })} className={`flex-1 ${inputCls}`} />
            <select value={editingLoc.importance} onChange={e => updateLocation(editingLoc.id, { importance: parseInt(e.target.value) })} className={`${inputCls}`}>
              {[1, 2, 3, 4, 5].map(n => <option key={n} value={n}>{n} 星</option>)}
            </select>
            <input value={editingLoc.elevation || ''} onChange={e => updateLocation(editingLoc.id, { elevation: e.target.value })} className={`w-24 ${inputCls}`} placeholder="海拔" />
          </div>
          <input value={(editingLoc.tags || []).join(', ')} onChange={e => updateLocation(editingLoc.id, { tags: e.target.value.split(',').map(t => t.trim()).filter(Boolean) })} className={`w-full ${inputCls}`} placeholder="标签（逗号分隔）" />
          <div>
            <div className="flex gap-1.5 mb-2 flex-wrap">
              {contentLayers.map(layer => {
                const active = editingLayer === layer.id;
                return (
                  <button key={layer.id} onClick={() => onSetEditingLayer(layer.id)}
                    className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs border transition-colors ${
                      active
                        ? 'bg-primary text-primary-foreground border-primary'
                        : 'bg-transparent text-muted-foreground border-border hover:border-primary/40'
                    }`}>
                    {!active && <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: layer.color }} />}
                    {layer.icon} {layer.name}
                  </button>
                );
              })}
            </div>
            <textarea
              value={typeof (editingLoc.layers || {})[editingLayer] === 'string'
                ? (editingLoc.layers || {})[editingLayer]
                : ((editingLoc.layers || {})[editingLayer]?.text || '')}
              onChange={e => updateLayerContent(editingLoc.id, editingLayer, e.target.value)} rows={4}
              className={`w-full ${inputCls} resize-none`} placeholder="此分类内容（AI 可自动填充）" />
          </div>
          <textarea value={editingLoc.reflection || ''} onChange={e => updateLocation(editingLoc.id, { reflection: e.target.value })} rows={2}
            className={`w-full ${inputCls} resize-none`} placeholder="驻足一想（引导旅行者思考的批注）" />
          <div className="flex gap-2">
            <input value={(editingLoc.practical || {}).access || ''} onChange={e => updateLocation(editingLoc.id, { practical: { ...editingLoc.practical, access: e.target.value } })} className={`flex-1 ${inputCls}`} placeholder="到达方式" />
            <input value={(editingLoc.practical || {}).difficulty || ''} onChange={e => updateLocation(editingLoc.id, { practical: { ...editingLoc.practical, difficulty: e.target.value } })} className={`flex-1 ${inputCls}`} placeholder="难度" />
          </div>
        </section>
      )}

      {/* Routes section */}
      <section className="bg-card rounded-lg p-5 border border-border">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-foreground font-serif font-bold text-sm flex items-center gap-1.5">
            <RouteIcon className="h-4 w-4 text-dai" /> 游览路线 ({routes.length})
          </h2>
          <button onClick={addRoute} className="px-3 py-1.5 bg-primary text-primary-foreground rounded-lg text-xs flex items-center gap-1 hover:bg-primary/90 transition-colors">
            <Plus className="h-3 w-3" /> 添加路线
          </button>
        </div>
        {routes.length === 0 ? (
          <div className="text-center py-6">
            <div className="w-12 h-12 mx-auto mb-3 rounded-full border border-border bg-background flex items-center justify-center">
              <Footprints className="h-5 w-5 text-muted-foreground" />
            </div>
            <p className="text-muted-foreground text-sm mb-1">还没有路线</p>
            <p className="text-muted-foreground text-xs">AI 可根据地点自动规划真实徒步路线，你也可以手动创建</p>
          </div>
        ) : (
          routes.map(route => (
            <div key={route.id} className="bg-background rounded-lg p-3 mb-2 border border-border">
              <div className="flex gap-2 items-center mb-2">
                <input value={route.day} onChange={e => updateRoute(route.id, { day: e.target.value })}
                  className="w-20 bg-card text-foreground rounded-lg px-2 py-1.5 text-xs outline-none font-serif" placeholder="第1天" />
                <input value={route.title} onChange={e => updateRoute(route.id, { title: e.target.value })}
                  className="flex-1 bg-card text-foreground rounded-lg px-2 py-1.5 text-xs outline-none" placeholder="路线标题" />
                <button onClick={() => removeRoute(route.id)} className="text-primary text-xs px-2 py-0.5 rounded-full bg-primary/10">删除</button>
              </div>
              <textarea value={route.narrative} onChange={e => updateRoute(route.id, { narrative: e.target.value })} rows={2}
                className="w-full bg-card text-foreground rounded-lg px-2 py-1.5 text-xs outline-none resize-none mb-2 font-kai" placeholder="路线叙事（卷首语）" />
              <div className="flex flex-wrap gap-1">
                {locations.map(loc => {
                  const inRoute = route.stops.includes(loc.id);
                  return (
                    <button key={loc.id} onClick={() => toggleRouteStop(route.id, loc.id)}
                      className={`px-2 py-1 rounded-full text-xs transition-colors ${
                        inRoute ? 'bg-primary text-primary-foreground' : 'bg-card text-muted-foreground border border-border'
                      }`}>{inRoute && '✓ '}{loc.name}</button>
                  );
                })}
              </div>
              {route.stops.length > 0 && (
                <div className="text-muted-foreground text-xs mt-2">
                  途经: {route.stops.map(id => locations.find(l => l.id === id)?.name || id).join(' → ')}
                </div>
              )}
            </div>
          ))
        )}
      </section>
    </div>
  );
}
