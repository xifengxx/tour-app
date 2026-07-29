// Static tour data (pre-loaded from tour.json files)
// In Phase 2, this will be replaced by Supabase queries

const tours = [];

async function loadTours() {
  if (tours.length > 0) return tours;
  const modules = import.meta.glob('/public/data/*.json', { eager: true });
  for (const path of Object.keys(modules)) {
    tours.push(modules[path].default || modules[path]);
  }
  return tours;
}

export { tours, loadTours };
