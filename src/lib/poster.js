/**
 * 导览分享海报绘制（canvas，Claude 风格：羊皮纸 + 陶土 + 衬线）。
 * @param {HTMLCanvasElement} canvas 目标画布
 * @param {object} tour 导览对象（meta.title/subtitle/locations）
 * @param {HTMLCanvasElement} [qrCanvas] 已渲染的二维码 canvas（drawImage 同步绘制）
 */
export function drawTourPoster(canvas, tour, qrCanvas) {
  const W = 600;
  const H = 840;
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');

  // 羊皮纸底
  ctx.fillStyle = '#f5f4ed';
  ctx.fillRect(0, 0, W, H);
  // 顶部陶土条
  ctx.fillStyle = '#c96442';
  ctx.fillRect(0, 0, W, 12);

  const title = tour.meta?.title || tour.title || '文学巡礼';
  const subtitle = tour.meta?.subtitle || tour.subtitle || '';

  // 标题（衬线）
  ctx.textAlign = 'center';
  ctx.fillStyle = '#141413';
  ctx.font = '600 42px Georgia, "Songti SC", "Noto Serif SC", serif';
  ctx.fillText(title, W / 2, 90);

  // 副标题
  if (subtitle) {
    ctx.font = '400 19px -apple-system, BlinkMacSystemFont, "PingFang SC", sans-serif';
    ctx.fillStyle = '#6f6d63';
    ctx.fillText(subtitle, W / 2, 125);
  }

  // 地点列表（Top 6，按 importance 排序）
  const locs = [...(tour.locations || [])]
    .sort((a, b) => (b.importance || 0) - (a.importance || 0))
    .slice(0, 6);
  ctx.textAlign = 'left';
  ctx.font = '400 19px -apple-system, BlinkMacSystemFont, "PingFang SC", sans-serif';
  locs.forEach((l, i) => {
    const stars = '★'.repeat(Math.min(l.importance || 1, 5));
    ctx.fillStyle = '#c96442';
    ctx.fillText(stars, 64, 195 + i * 52);
    ctx.fillStyle = '#141413';
    ctx.fillText(l.name, 150, 195 + i * 52);
  });

  // 品牌 + 二维码
  ctx.textAlign = 'center';
  ctx.fillStyle = '#6f6d63';
  ctx.font = '400 16px -apple-system, BlinkMacSystemFont, "PingFang SC", sans-serif';
  ctx.fillText('文学巡礼 · 跟着小说游山水', W / 2, H - 60);
  if (qrCanvas) {
    try {
      ctx.drawImage(qrCanvas, W / 2 - 90, H - 290, 180, 180);
    } catch (e) {
      /* 二维码 canvas 未就绪时忽略 */
    }
  }
}
