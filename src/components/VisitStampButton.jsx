import { useEffect, useState } from 'react';
import { useAuthOptional } from '../contexts/AuthContext';
import VisitStampModal from './VisitStampModal';
import { supabase } from '../lib/supabase';
import { hasVisitInCache, markVisitInCache } from '../lib/visits';

// 行印：到访记录，重动作，只有主动点才记。带「行」小印与文案。
export default function VisitStampButton({ loc, tourId, compact = false, className = '' }) {
  const { user } = useAuthOptional();
  const goLogin = () => { window.location.assign('/login'); };
  const [open, setOpen] = useState(false);
  const [visited, setVisited] = useState(() => (loc ? hasVisitInCache(loc.id) : false));

  // 登录后以云端为准，缓存只做首屏兜底
  useEffect(() => {
    if (!loc) return;
    let alive = true;
    if (!user) { setVisited(hasVisitInCache(loc.id)); return; }
    supabase
      .from('visits')
      .select('id')
      .eq('loc_id', loc.id)
      .limit(1)
      .then(({ data, error }) => {
        if (!alive || error) return;
        const has = (data || []).length > 0;
        setVisited(has);
        markVisitInCache(loc.id, has);
      });
    return () => { alive = false; };
  }, [loc, user]);

  if (!loc) return null;

  const click = (e) => {
    e.stopPropagation();
    if (!user) { goLogin(); return; }
    setOpen(true);
  };

  return (
    <>
      <button
        type="button"
        onClick={click}
        aria-label={visited ? '已留行印' : '在此留印'}
        title={visited ? '此行已留印，可再记一次' : '行印 · 记下这次到访'}
        className={`shrink-0 inline-flex items-center gap-1.5 px-2 h-6 rounded-full border text-[11px] transition-colors
          ${visited ? 'border-primary/50 text-primary bg-primary/[0.06]' : 'border-border text-muted-foreground hover:border-primary/40 hover:text-foreground'} ${className}`}
      >
        <span className={`font-serif font-bold leading-none ${visited ? 'text-primary' : 'text-muted-foreground/80'}`}>行</span>
        {!compact && <span className="leading-none">{visited ? '已留印' : '留印'}</span>}
      </button>

      {open && (
        <VisitStampModal
          tourId={tourId}
          loc={loc}
          onClose={() => setOpen(false)}
          onSaved={() => setVisited(true)}
        />
      )}
    </>
  );
}
