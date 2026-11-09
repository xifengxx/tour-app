import { supabase } from './supabase';

const VISITS = 'visits';
const FAVS = 'loc_favorites';
const BUCKET = 'visit-photos';

// ---------- 行印：到访记录 ----------

export async function fetchVisits() {
  const { data, error } = await supabase
    .from(VISITS)
    .select('*')
    .order('visited_at', { ascending: false });
  if (error) throw error;
  return data || [];
}

export async function fetchVisitsOfTour(tourId) {
  const { data, error } = await supabase
    .from(VISITS)
    .select('*')
    .eq('tour_id', tourId)
    .order('visited_at', { ascending: false });
  if (error) throw error;
  return data || [];
}

export async function createVisit({ userId, tourId, locId, locName, visitedAt, photos = [], favoriteFigure = '', quote = '' }) {
  const { data, error } = await supabase.from(VISITS).insert({
    user_id: userId,
    tour_id: tourId,
    loc_id: locId,
    loc_name: locName,
    visited_at: visitedAt || new Date().toISOString(),
    photos,
    favorite_figure: favoriteFigure || null,
    quote: quote || null,
  }).select().single();
  if (error) throw error;
  return data;
}

export async function deleteVisit(id) {
  const { error } = await supabase.from(VISITS).delete().eq('id', id);
  if (error) throw error;
  return true;
}

export async function uploadVisitPhoto(file, userId) {
  const ext = (file.name.split('.').pop() || 'jpg').toLowerCase();
  const path = `${userId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
  const { error } = await supabase.storage.from(BUCKET).upload(path, file, {
    cacheControl: '31536000',
    upsert: false,
    contentType: file.type || 'image/jpeg',
  });
  if (error) throw error;
  const { data } = supabase.storage.from(BUCKET).getPublicUrl(path);
  return data.publicUrl;
}

// ---------- 藏印：地点收藏 ----------

export async function fetchFavorites() {
  const { data, error } = await supabase
    .from(FAVS)
    .select('*')
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data || [];
}

export async function addFavorite({ userId, tourId, locId, locName }) {
  const { data, error } = await supabase.from(FAVS).upsert({
    user_id: userId,
    tour_id: tourId,
    loc_id: locId,
    loc_name: locName,
  }, { onConflict: 'user_id,loc_id' }).select().single();
  if (error) throw error;
  return data;
}

export async function removeFavorite(locId) {
  const { error } = await supabase.from(FAVS).delete().eq('loc_id', locId);
  if (error) throw error;
  return true;
}

// ---------- 本地缓存（避免每次进详情页都查库） ----------

const CACHE_KEY = 'tour-stamps-v1';

export function readStampCache() {
  try {
    return JSON.parse(localStorage.getItem(CACHE_KEY) || '{}');
  } catch {
    return {};
  }
}

export function writeStampCache(next) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(next));
  } catch {
    // 忽略配额错误
  }
}

export function markFavInCache(locId, on) {
  const c = readStampCache();
  c.favs = c.favs || {};
  if (on) c.favs[locId] = true; else delete c.favs[locId];
  writeStampCache(c);
}

export function markVisitInCache(locId, on) {
  const c = readStampCache();
  c.visits = c.visits || {};
  if (on) c.visits[locId] = true; else delete c.visits[locId];
  writeStampCache(c);
}

export function hasFavInCache(locId) {
  return !!readStampCache().favs?.[locId];
}

export function hasVisitInCache(locId) {
  return !!readStampCache().visits?.[locId];
}

// 首次进入页面时用云端数据回填缓存
export function hydrateStampCache({ favs = [], visits = [] }) {
  const c = readStampCache();
  c.favs = {};
  c.visits = {};
  favs.forEach(f => { c.favs[f.loc_id] = true; });
  visits.forEach(v => { c.visits[v.loc_id] = true; });
  writeStampCache(c);
}
