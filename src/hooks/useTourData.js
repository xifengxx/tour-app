import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '../lib/supabase';
import { STATIC_DATA } from '../lib/staticTours';

/**
 * Loads tour data — tries Supabase first, falls back to static JSON.
 */
export function useTourData(tourId) {
  const [tour, setTour] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [source, setSource] = useState(null); // 'supabase' | 'static'
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  // Returns the loaded tour, or null on failure. Safe to call repeatedly.
  const load = useCallback(async () => {
    if (!tourId) { setLoading(false); return null; }
    setLoading(true);
    try {
      // Try Supabase first
      const { data: supabaseTour, error: sbErr } = await supabase
        .from('tours')
        .select('*, locations(*), routes(*), content_layers(*), tips(*)')
        .eq('id', tourId)
        .single();

      if (!sbErr && supabaseTour) {
        const t = normalizeTour(supabaseTour);
        if (mountedRef.current) {
          setTour(t);
          setSource('supabase');
          setError(null);
          setLoading(false);
        }
        return t;
      }

      // Fall back to static JSON
      const file = STATIC_DATA[tourId];
      if (file) {
        const res = await fetch(file);
        const data = await res.json();
        if (mountedRef.current) {
          setTour(data);
          setSource('static');
          setError(null);
          setLoading(false);
        }
        return data;
      }
      if (mountedRef.current) { setError('Tour not found'); setLoading(false); }
      return null;
    } catch (e) {
      if (mountedRef.current) { setError(e.message); setLoading(false); }
      return null;
    }
  }, [tourId]);

  useEffect(() => { load(); }, [load]);

  return { tour, loading, error, source, reload: load };
}

/**
 * Normalize Supabase flat tables → nested tour object matching static JSON shape.
 */
export function normalizeTour(row) {
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
    legs: r.legs || [],
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
    destination: {
      ...(row.destination || {}),
      bounds: row.destination?.bounds || computeBounds(locations),
    },
    contentLayers: layers,
    locations,
    routes,
    tips: (row.tips || []).map(t => ({ text: t.text })),
  };
}

/**
 * Derive map bounds from location coordinates (drafts created in the app
 * don't store destination.bounds). Returns null when no usable coords.
 */
export function computeBounds(locations) {
  const pts = locations.filter(l => l.lat && l.lng);
  if (pts.length === 0) return null;
  const lats = pts.map(l => l.lat);
  const lngs = pts.map(l => l.lng);
  return [
    [Math.min(...lats), Math.min(...lngs)],
    [Math.max(...lats), Math.max(...lngs)],
  ];
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
