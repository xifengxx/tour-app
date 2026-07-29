import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';

const STATIC_DATA = {
  'nanyue-hengshan': '/data/henshan.json',
  'huashan-xiaoao': '/data/huashan.json',
};

/**
 * Loads tour data — tries Supabase first, falls back to static JSON.
 */
export function useTourData(tourId) {
  const [tour, setTour] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [source, setSource] = useState(null); // 'supabase' | 'static'

  useEffect(() => {
    if (!tourId) { setLoading(false); return; }
    let cancelled = false;

    async function load() {
      setLoading(true);

      // Try Supabase first
      const { data: supabaseTour, error: sbErr } = await supabase
        .from('tours')
        .select('*, locations(*), routes(*), content_layers(*), tips(*)')
        .eq('id', tourId)
        .single();

      if (!sbErr && supabaseTour) {
        if (!cancelled) {
          setTour(normalizeTour(supabaseTour));
          setSource('supabase');
          setLoading(false);
        }
        return;
      }

      // Fall back to static JSON
      const file = STATIC_DATA[tourId];
      if (file) {
        try {
          const res = await fetch(file);
          const data = await res.json();
          if (!cancelled) {
            setTour(data);
            setSource('static');
            setLoading(false);
          }
        } catch (e) {
          if (!cancelled) { setError(e.message); setLoading(false); }
        }
      } else {
        if (!cancelled) { setError('Tour not found'); setLoading(false); }
      }
    }

    load();
    return () => { cancelled = true; };
  }, [tourId]);

  return { tour, loading, error, source };
}

/**
 * Normalize Supabase flat tables → nested tour object matching static JSON shape.
 */
function normalizeTour(row) {
  const layers = (row.content_layers || []).map(l => ({
    id: l.layer_key,
    name: l.name,
    icon: l.icon,
    color: l.color,
  }));

  const locations = (row.locations || []).map(loc => ({
    id: loc.id,
    name: loc.name,
    lat: loc.lat,
    lng: loc.lng,
    elevation: loc.elevation,
    importance: loc.importance,
    tags: loc.tags,
    layers: loc.layers,
    reflection: loc.reflection,
    practical: loc.practical,
  }));

  const routes = (row.routes || []).map(r => ({
    id: r.id,
    day: r.day_label,
    title: r.title,
    stops: r.stops,
    narrative: r.narrative,
  }));

  return {
    id: row.id,
    userId: row.user_id,
    meta: {
      title: row.title,
      subtitle: row.subtitle || '',
    },
    theme: row.theme || { primaryColor: '#c0392b' },
    source: row.source || {},
    destination: row.destination || {},
    contentLayers: layers,
    locations,
    routes,
    tips: (row.tips || []).map(t => ({ text: t.text })),
  };
}

/**
 * Export tour back to Supabase flat-table format (for saving).
 */
export function denormalizeTour(tour) {
  return {
    title: tour.meta?.title || '',
    subtitle: tour.meta?.subtitle || '',
    theme: tour.theme || {},
    source: tour.source || {},
    destination: tour.destination || {},
    is_public: tour.isPublic || false,
  };
}
