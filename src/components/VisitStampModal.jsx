import { useState, useRef } from 'react';
import { Stamp, ImagePlus, X, Loader2 } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { createVisit, uploadVisitPhoto, markVisitInCache } from '../lib/visits';

export default function VisitStampModal({ tourId, loc, onClose, onSaved }) {
  const { user } = useAuth();
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [files, setFiles] = useState([]);
  const [figure, setFigure] = useState('');
  const [quote, setQuote] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const fileRef = useRef(null);

  const figures = (loc?.figures || []).map(f => f.name);

  const pickFiles = (e) => {
    const next = Array.from(e.target.files || []).slice(0, 3 - files.length);
    if (!next.length) return;
    setFiles(prev => [...prev, ...next.map(f => ({ file: f, url: URL.createObjectURL(f) }))]);
    e.target.value = '';
  };

  const dropPhoto = (idx) => {
    setFiles(prev => {
      URL.revokeObjectURL(prev[idx].url);
      return prev.filter((_, i) => i !== idx);
    });
  };

  const save = async () => {
    if (!user) { setErr('请先登录再留印'); return; }
    setBusy(true); setErr('');
    try {
      const photos = [];
      for (const p of files) {
        const url = await uploadVisitPhoto(p.file, user.id);
        photos.push({ url, caption: '' });
      }
      await createVisit({
        userId: user.id,
        tourId,
        locId: loc.id,
        locName: loc.name,
        visitedAt: new Date(`${date}T12:00:00+08:00`).toISOString(),
        photos,
        favoriteFigure: figure,
        quote,
      });
      markVisitInCache(loc.id, true);
      onSaved?.(loc);
      onClose?.();
    } catch (e) {
      setErr(e?.message || '留印失败，请稍后再试');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[60] bg-black/60 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-card rounded-lg border border-border w-full max-w-md max-h-[86vh] overflow-y-auto p-6 anim-rise" onClick={e => e.stopPropagation()}>
        <button className="float-right w-8 h-8 rounded-full bg-black/[0.05] hover:bg-black/10 flex items-center justify-center" onClick={onClose} aria-label="关闭">
          <X className="h-4 w-4" />
        </button>

        <div className="flex items-center gap-2 mb-1">
          <span className="w-7 h-7 rounded-sm border-2 border-primary text-primary font-serif font-bold flex items-center justify-center text-[13px]">行</span>
          <div className="font-serif font-bold text-lg text-foreground">在此留印</div>
        </div>
        <div className="text-muted-foreground text-xs mb-4">只有你主动记一次，才算到过。留印不会自动发生。</div>

        <div className="text-sm text-foreground mb-4 pb-4 border-b border-border">
          <span className="text-muted-foreground">地点：</span>{loc?.name}
          {loc?.elevation && <span className="text-muted-foreground text-xs"> · {loc.elevation}</span>}
        </div>

        <label className="block text-xs text-muted-foreground mb-1">哪一天到的</label>
        <input type="date" value={date} onChange={e => setDate(e.target.value)}
          className="w-full mb-4 bg-secondary/40 border border-border rounded-md px-3 py-2 text-sm" />

        <div className="flex items-center justify-between mb-1">
          <span className="text-xs text-muted-foreground">照片（最多 3 张）</span>
          <span className="text-xs text-muted-foreground">{files.length}/3</span>
        </div>
        <div className="grid grid-cols-3 gap-2 mb-4">
          {files.map((p, i) => (
            <div key={p.url} className="relative aspect-square rounded-md overflow-hidden border border-border">
              <img src={p.url} alt="" className="w-full h-full object-cover" />
              <button onClick={() => dropPhoto(i)} className="absolute top-1 right-1 w-5 h-5 rounded-full bg-black/60 text-white flex items-center justify-center" aria-label="删除照片">
                <X className="h-3 w-3" />
              </button>
            </div>
          ))}
          {files.length < 3 && (
            <button onClick={() => fileRef.current?.click()}
              className="aspect-square rounded-md border border-dashed border-border flex flex-col items-center justify-center gap-1 text-muted-foreground hover:border-primary/50 hover:text-primary transition-colors">
              <ImagePlus className="h-4 w-4" />
              <span className="text-[11px]">添加</span>
            </button>
          )}
        </div>
        <input ref={fileRef} type="file" accept="image/*" multiple className="hidden" onChange={pickFiles} />

        {figures.length > 0 && (
          <>
            <label className="block text-xs text-muted-foreground mb-1">此行最记住的人</label>
            <div className="flex flex-wrap gap-2 mb-4">
              {figures.map(name => (
                <button key={name} onClick={() => setFigure(figure === name ? '' : name)}
                  className={`px-2.5 py-1 rounded-full border text-xs transition-colors ${figure === name ? 'border-primary text-primary bg-primary/[0.06]' : 'border-border text-muted-foreground hover:border-primary/40'}`}>
                  {name}
                </button>
              ))}
            </div>
          </>
        )}

        <label className="block text-xs text-muted-foreground mb-1">留一句话</label>
        <textarea rows={3} value={quote} onChange={e => setQuote(e.target.value)} maxLength={200}
          placeholder="当时想到的，一句话就够"
          className="w-full bg-secondary/40 border border-border rounded-md px-3 py-2 text-sm leading-relaxed resize-none" />

        {err && <div className="mt-3 text-xs text-primary">{err}</div>}

        <div className="flex gap-2 mt-5">
          <button onClick={onClose} className="flex-1 py-2 rounded-md border border-border text-sm text-muted-foreground hover:bg-black/[0.03]">取消</button>
          <button onClick={save} disabled={busy}
            className="flex-1 py-2 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:opacity-90 disabled:opacity-60 flex items-center justify-center gap-1.5">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Stamp className="h-4 w-4" />}
            {busy ? '正在留印' : '盖下行印'}
          </button>
        </div>
      </div>
    </div>
  );
}
