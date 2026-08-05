/**
 * 导览分享海报绘制（canvas，Claude 风格，600×1150 竖版）。
 * 设计：品牌 + 大标题 + 点睛副标题 + 红印章 + 数字统计 + 亮点地点 + 行程预览 + 扫码 CTA。
 * @param {HTMLCanvasElement} canvas 目标画布
 * @param {object} tour 导览对象（meta.title/subtitle, source, locations, routes）
 * @param {HTMLCanvasElement} [qrCanvas] 已渲染的二维码 canvas
 */
export function drawTourPoster(canvas, tour, qrCanvas) {
  const W = 600;
  const H = 1150;
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');

  const SERIF = 'Georgia,"Songti SC","Noto Serif SC",serif';
  const SANS = '-apple-system,BlinkMacSystemFont,"PingFang SC",sans-serif';
  const MAX_Y = H - 340; // 内容区下界，CTA(H-300) 与其间距 40px

  const title = tour.meta?.title || tour.title || '文学巡礼';
  const subtitle = tour.meta?.subtitle || tour.subtitle || '';
  const locs = [...(tour.locations || [])]
    .sort((a, b) => (b.importance || 0) - (a.importance || 0))
    .slice(0, 5);
  const routes = (tour.routes || []).filter(r => r.id !== 'extra').slice(0, 4);

  const wrapText = (text, maxWidth, maxLines) => {
    const lines = [];
    let line = '';
    for (const ch of String(text)) {
      const test = line + ch;
      if (ctx.measureText(test).width > maxWidth && line) {
        lines.push(line);
        line = ch;
        if (lines.length >= maxLines) break;
      } else {
        line = test;
      }
    }
    if (line && lines.length < maxLines) lines.push(line);
    return lines.slice(0, maxLines);
  };

  const roundRect = (x, y, w, h, r) => {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  };

  // 底 + 顶部陶土条
  ctx.fillStyle = '#f7f3ea';
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = '#c2402a';
  ctx.fillRect(0, 0, W, 10);

  // 品牌
  ctx.textAlign = 'left';
  ctx.font = `600 18px ${SERIF}`;
  ctx.fillStyle = '#c2402a';
  ctx.fillText('文 学 巡 礼', 48, 56);

  // 大标题（最多 2 行）
  ctx.textAlign = 'center';
  ctx.fillStyle = '#1c1a16';
  ctx.font = `600 42px ${SERIF}`;
  const tLines = wrapText(title, W - 170, 2);
  let y = 104;
  tLines.forEach((l, i) => {
    ctx.fillText(l, W / 2, y);
    y += 52;
  });

  // 印章（标题右侧）——标题过长时跳过，避免盖住标题
  const titleMaxWidth = Math.max(...tLines.map(l => ctx.measureText(l).width));
  const sealX = W / 2 + 155;
  const drawSeal = titleMaxWidth < 2 * (sealX - 10 - W / 2); // 标题右缘(300+w/2)不碰印章左侧(sealX-10)
  if (drawSeal) {
    ctx.fillStyle = '#c2402a';
    roundRect(sealX, 86, 46, 46, 6);
    ctx.fill();
    ctx.fillStyle = '#f7f3ea';
    ctx.font = `700 22px ${SERIF}`;
    ctx.textAlign = 'center';
    ctx.fillText('文', sealX + 23, 86 + 31);
  }

  // 副标题（点睛句，陶土色）
  y += 38;
  if (subtitle) {
    ctx.fillStyle = '#c2402a';
    ctx.font = `400 21px ${SANS}`;
    const sLines = wrapText(subtitle, W - 130, 2);
    sLines.forEach((l, i) => ctx.fillText(l, W / 2, y + i * 32));
    y += sLines.length * 32 + 16;
  } else {
    y += 16;
  }

  // 分隔线
  ctx.strokeStyle = '#ddd4c0';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(70, y);
  ctx.lineTo(W - 70, y);
  ctx.stroke();
  y += 38;

  // 统计
  ctx.fillStyle = '#6b655a';
  ctx.font = `400 17px ${SANS}`;
  const statLine = `★ ${(tour.locations || []).length} 个文学地点  ·  🗺 ${routes.length} 条路线`;
  ctx.fillText(statLine, W / 2, y);
  y += 42;

  // 亮点地点：星号与名字间用实测宽度留足间隙
  ctx.textAlign = 'left';
  ctx.fillStyle = '#c2402a';
  ctx.font = `600 17px ${SANS}`;
  ctx.fillText('✨ 亮点地点', 48, y);
  y += 38;
  ctx.font = `400 20px ${SANS}`;
  for (const l of locs) {
    if (y > MAX_Y) break;
    const stars = '★'.repeat(Math.min(l.importance || 1, 5));
    ctx.fillStyle = '#c2402a';
    ctx.fillText(stars, 48, y);
    const starsW = ctx.measureText(stars).width;
    ctx.fillStyle = '#1c1a16';
    ctx.fillText(l.name, 48 + starsW + 20, y); // 星号右侧固定留 20px
    y += 46;
  }

  // 行程预览
  y += 22;
  if (y < MAX_Y) {
    ctx.fillStyle = '#c2402a';
    ctx.font = `600 17px ${SANS}`;
    ctx.fillText('🗺 行程预览', 48, y);
    y += 36;
    ctx.font = `400 18px ${SANS}`;
    for (const r of routes) {
      if (y > MAX_Y) break;
      const label = (r.day || r.day_label) ? `${r.day || r.day_label} · ${r.title}` : r.title;
      ctx.fillStyle = '#1c1a16';
      ctx.fillText(label, 48, y);
      y += 34;
    }
  }

  // 底部：CTA + 二维码 + 品牌（固定位置，与内容区间距充裕）
  ctx.textAlign = 'center';
  ctx.fillStyle = '#6b655a';
  ctx.font = `400 16px ${SANS}`;
  ctx.fillText('扫码开启你的文学之旅', W / 2, H - 300);
  if (qrCanvas) {
    try {
      ctx.drawImage(qrCanvas, W / 2 - 92, H - 286, 184, 184);
    } catch (e) {
      /* 二维码未就绪时忽略 */
    }
  }
  ctx.fillStyle = '#8f8a7c';
  ctx.font = `400 14px ${SANS}`;
  ctx.fillText('文学巡礼 · 跟着小说游山水', W / 2, H - 40);
}
