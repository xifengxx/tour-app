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
      {/* Step indicator */}
      <div className="flex items-center gap-2 mb-2">
        <div className="w-8 h-8 rounded-full bg-green-600 text-white flex items-center justify-center text-xs">✓</div>
        <div className="flex-1 h-px bg-green-600/30" />
        <div className="w-8 h-8 rounded-full bg-primary text-white flex items-center justify-center text-xs font-bold">2</div>
        <div className="text-foreground font-semibold text-sm">审核地点与内容</div>
        <div className="flex-1 h-px bg-black/10" />
        <div className="w-8 h-8 rounded-full bg-black/5 text-muted-foreground flex items-center justify-center text-xs">3</div>
      </div>

      {/* 公开/私密切换 + 编辑基本信息 */}
      <div className="flex items-center gap-2 mb-3 flex-wrap">
        <button
          onClick={() => setIsPublic(!isPublic)}
          className={`flex items-center gap-2 text-xs px-3 py-2 rounded-xl border transition-colors ${
            isPublic
              ? 'bg-green-600/10 border-green-600/30 text-green-700'
              : 'bg-black/5 border-border text-muted-foreground'
          }`}
        >
          {isPublic ? '🌍 已公开（所有人可见）' : '🔒 私密（仅自己可见）'}
        </button>
        <button
          onClick={() => onSetPhase('input')}
          className="flex items-center gap-2 text-xs px-3 py-2 rounded-xl border border-border bg-black/5 text-muted-foreground hover:bg-black/10 transition-colors"
        >
          📝 编辑基本信息（标题/目的地等）
        </button>
        <span className="text-[10px] text-muted-foreground">点右上角「保存」后生效</span>
      </div>

      <button
        onClick={onReprocess}
        className="w-full py-2.5 bg-primary/10 text-primary rounded-xl text-xs border border-primary/20 mb-3 hover:bg-primary/20 transition-colors"
      >
        🔄 AI 重新分析（重新调用 AI，覆盖当前 AI 生成的地点 / 内容 / 路线）
      </button>

      {/* Locations */}
      <section className="bg-card rounded-2xl p-5 border border-border">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-foreground font-bold text-sm">📍 地点 ({locations.length})</h2>
          <button onClick={onShowMapSearch} className="px-3 py-1.5 bg-primary text-white rounded-xl text-xs">+ 搜索添加</button>
        </div>
        {locations.length === 0 ? (
          <div className="text-center py-8">
            <div className="text-4xl mb-3">🗺️</div>
            <p className="text-muted-foreground text-sm mb-2">还没有地点</p>
            <p className="text-muted-foreground text-xs">点击「搜索添加」打开地图搜索，或让 AI 自动生成</p>
          </div>
        ) : (
          <div className="space-y-1 max-h-60 overflow-y-auto">
            {locations.map(loc => (
              <button key={loc.id}
                onClick={() => onSetEditingLoc(editingLoc?.id === loc.id ? null : loc)}
                className={`w-full text-left px-3 py-2 rounded-xl transition-colors ${
                  editingLoc?.id === loc.id ? 'bg-primary/10 border border-primary/20' : 'bg-background hover:bg-secondary'
                }`}>
                <div className="flex items-center justify-between">
                  <span className="text-foreground text-xs">{'⭐'.repeat(loc.importance || 1)} {loc.name}</span>
                  <span className="text-muted-foreground text-xs">{loc.lng?.toFixed(4)}, {loc.lat?.toFixed(4)}</span>
                </div>
              </button>
            ))}
          </div>
        )}
      </section>

      {/* Location editor */}
      {editingLoc && (
        <section className="bg-card rounded-2xl p-5 border border-border space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-foreground font-bold text-sm">✏️ {editingLoc.name}</h3>
            <button onClick={() => removeLocation(editingLoc.id)} className="px-3 py-1 bg-primary/10 text-primary rounded-xl text-xs">删除</button>
          </div>
          <div className="flex gap-2">
            <input value={editingLoc.name} onChange={e => updateLocation(editingLoc.id, { name: e.target.value })} className={`flex-1 ${inputCls}`} />
            <select value={editingLoc.importance} onChange={e => updateLocation(editingLoc.id, { importance: parseInt(e.target.value) })} className={`${inputCls}`}>
              {[1, 2, 3, 4, 5].map(n => <option key={n} value={n}>{'⭐'.repeat(n)}</option>)}
            </select>
            <input value={editingLoc.elevation || ''} onChange={e => updateLocation(editingLoc.id, { elevation: e.target.value })} className={`w-24 ${inputCls}`} placeholder="海拔" />
          </div>
          <input value={(editingLoc.tags || []).join(', ')} onChange={e => updateLocation(editingLoc.id, { tags: e.target.value.split(',').map(t => t.trim()).filter(Boolean) })} className={`w-full ${inputCls}`} placeholder="标签（逗号分隔）" />
          <div>
            <div className="flex gap-1 mb-2 flex-wrap">
              {contentLayers.map(layer => (
                <button key={layer.id} onClick={() => onSetEditingLayer(layer.id)}
                  className="px-2 py-1 rounded-full text-xs"
                  style={{
                    background: editingLayer === layer.id ? layer.color : 'transparent',
                    color: editingLayer === layer.id ? '#fff' : '#888',
                    border: editingLayer === layer.id ? 'none' : '1px solid rgba(255,255,255,0.1)',
                  }}>{layer.icon} {layer.name}</button>
              ))}
            </div>
            <textarea
              value={typeof (editingLoc.layers || {})[editingLayer] === 'string'
                ? (editingLoc.layers || {})[editingLayer]
                : ((editingLoc.layers || {})[editingLayer]?.text || '')}
              onChange={e => updateLayerContent(editingLoc.id, editingLayer, e.target.value)} rows={4}
              className={`w-full ${inputCls} resize-none`} placeholder="此分类内容（AI 可自动填充）" />
          </div>
          <textarea value={editingLoc.reflection || ''} onChange={e => updateLocation(editingLoc.id, { reflection: e.target.value })} rows={2}
            className={`w-full ${inputCls} resize-none`} placeholder="💭 停下来想一想" />
          <div className="flex gap-2">
            <input value={(editingLoc.practical || {}).access || ''} onChange={e => updateLocation(editingLoc.id, { practical: { ...editingLoc.practical, access: e.target.value } })} className={`flex-1 ${inputCls}`} placeholder="到达方式" />
            <input value={(editingLoc.practical || {}).difficulty || ''} onChange={e => updateLocation(editingLoc.id, { practical: { ...editingLoc.practical, difficulty: e.target.value } })} className={`flex-1 ${inputCls}`} placeholder="难度" />
          </div>
        </section>
      )}

      {/* Routes section */}
      <section className="bg-card rounded-2xl p-5 border border-border">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-foreground font-bold text-sm">🗺 游览路线 ({routes.length})</h2>
          <button onClick={addRoute} className="px-3 py-1.5 bg-primary text-white rounded-xl text-xs">+ 添加路线</button>
        </div>
        {routes.length === 0 ? (
          <div className="text-center py-6">
            <div className="text-4xl mb-3">🥾</div>
            <p className="text-muted-foreground text-sm mb-1">还没有路线</p>
            <p className="text-muted-foreground text-xs">AI 可根据地点自动规划真实徒步路线，你也可以手动创建</p>
          </div>
        ) : (
          routes.map(route => (
            <div key={route.id} className="bg-background rounded-xl p-3 mb-2 border border-border">
              <div className="flex gap-2 items-center mb-2">
                <input value={route.day} onChange={e => updateRoute(route.id, { day: e.target.value })}
                  className="w-20 bg-card text-foreground rounded-lg px-2 py-1.5 text-xs outline-none" placeholder="第1天" />
                <input value={route.title} onChange={e => updateRoute(route.id, { title: e.target.value })}
                  className="flex-1 bg-card text-foreground rounded-lg px-2 py-1.5 text-xs outline-none" placeholder="路线标题" />
                <button onClick={() => removeRoute(route.id)} className="text-primary text-xs px-2 py-0.5 rounded-full bg-primary/10">删除</button>
              </div>
              <textarea value={route.narrative} onChange={e => updateRoute(route.id, { narrative: e.target.value })} rows={2}
                className="w-full bg-card text-foreground rounded-lg px-2 py-1.5 text-xs outline-none resize-none mb-2" placeholder="路线叙事" />
              <div className="flex flex-wrap gap-1">
                {locations.map(loc => {
                  const inRoute = route.stops.includes(loc.id);
                  return (
                    <button key={loc.id} onClick={() => toggleRouteStop(route.id, loc.id)}
                      className={`px-2 py-1 rounded-full text-xs transition-colors ${
                        inRoute ? 'bg-primary text-white' : 'bg-card text-muted-foreground'
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
