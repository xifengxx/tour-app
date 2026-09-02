import { STATIC_TOURS } from './staticTours';

const tours = [];

async function loadTours() {
  if (tours.length > 0) return tours;
  for (const tour of STATIC_TOURS) {
    const response = await fetch(tour.file);
    if (!response.ok) throw new Error(`加载静态导览失败：${tour.id}`);
    tours.push(await response.json());
  }
  return tours;
}

export { tours, loadTours };
