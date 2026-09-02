/**
 * 导览分享海报绘制（canvas，「纸上山河」风格，600×1150 竖版）。
 * 设计：古籍双线框 + 朱印品牌 + 衬线大标题 + 楷体点睛句 + 竖排侧签
 *       + 壹贰叁亮点地点（藤黄星）+ 国画五色行程 + 双线框二维码 + 落款。
 *  async：开始前等待 webfont 就绪，保证衬线/楷体在 canvas 生效。
 * @param {HTMLCanvasElement} canvas 目标画布
 * @param {object} tour 导览对象（meta.title/subtitle, source, locations, routes）
 * @param {HTMLCanvasElement} [qrCanvas] 已渲染的二维码 canvas
 */
import { ROUTE_COLORS, cnOrdinal } from './routeColors';

const PAPER = '#f7f3ea';
const IVORY = '#fdfbf5';
const INK = '#1c1a16';
const MUTED = '#6b655a';
const FAINT = '#8f8a7c';
const VERMILION = '#c2402a';
const DAI = '#2f4f4a';
const GAMBOGE = '#c9973f';
const BORDER = '#d8cfba';

const SERIF = '"Noto Serif SC","Songti SC",STSong,Georgia,serif';
const KAI = '"Kaiti SC",STKaiti,KaiTi,"Noto Serif SC",serif';
const SANS = '-apple-system,BlinkMacSystemFont,"PingFang SC",sans-serif';

export async function drawTourPoster(canvas, tour, qrCanvas) {
  // 等 webfont（Noto Serif SC / 楷体）加载完再画，否则 canvas 落到默认字体
  if (typeof document !== 'undefined' && document.fonts?.ready) {
    try {
      await Promise.race([
        Promise.all([
          document.fonts.load(`900 40px "Noto Serif SC"`),
          document.fonts.load(`600 20px "Noto Serif SC"`),
        ]),
        new Promise(r => setTimeout(r, 1500)),
      ]);
    } catch { /* 字体就绪失败则用回退字体继续 */ }
  }

  const W = 600;
  const H = 1150;
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');

  const MAX_Y = H - 400; // 内容区下界，给二维码卡(H-370 起)留间距

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

  const hline = (x1, y, x2, color = BORDER, lw = 1) => {
    ctx.strokeStyle = color;
    ctx.lineWidth = lw;
    ctx.beginPath();
    ctx.moveTo(x1, y);
    ctx.lineTo(x2, y);
    ctx.stroke();
  };

  // 朱印（实心方印 + 白字 + 内描边）
  const drawSeal = (cx, cy, size, char) => {
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(-0.035);
    ctx.fillStyle = VERMILION;
    roundRect(-size / 2, -size / 2, size, size, 4);
    ctx.fill();
    ctx.strokeStyle = 'rgba(253,249,240,0.45)';
    ctx.lineWidth = 1;
    roundRect(-size / 2 + 3, -size / 2 + 3, size - 6, size - 6, 2);
    ctx.stroke();
    ctx.fillStyle = '#fdf9f0';
    ctx.font = `700 ${Math.round(size * 0.56)}px ${SERIF}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(char, 0, 1);
    ctx.restore();
    ctx.textBaseline = 'alphabetic';
  };

  // 混排居中行：parts = [{ text, font, fill, gap }]
  const drawRowCenter = (parts, y) => {
    let total = 0;
    parts.forEach(p => { ctx.font = p.font; total += ctx.measureText(p.text).width + (p.gap || 0); });
    let x = W / 2 - total / 2;
    const prevAlign = ctx.textAlign;
    ctx.textAlign = 'left';
    parts.forEach(p => {
      ctx.font = p.font;
      ctx.fillStyle = p.fill;
      ctx.fillText(p.text, x, y);
      x += ctx.measureText(p.text).width + (p.gap || 0);
    });
    ctx.textAlign = prevAlign;
  };

  // 章节小标：— 文字 —（两侧饰线）
  const sectionHeader = (text, y) => {
    ctx.font = `600 15px ${SERIF}`;
    ctx.textAlign = 'center';
    ctx.fillStyle = VERMILION;
    ctx.fillText(text, W / 2, y);
    const tw = ctx.measureText(text).width;
    hline(W / 2 - tw / 2 - 56, y - 5, W / 2 - tw / 2 - 16);
    hline(W / 2 + tw / 2 + 16, y - 5, W / 2 + tw / 2 + 56, y - 5);
    // 饰线端点小菱形
    ctx.fillStyle = BORDER;
    [[W / 2 - tw / 2 - 60, y - 5], [W / 2 + tw / 2 + 60, y - 5]].forEach(([dx, dy]) => {
      ctx.save();
      ctx.translate(dx, dy);
      ctx.rotate(Math.PI / 4);
      ctx.fillRect(-2.5, -2.5, 5, 5);
      ctx.restore();
    });
  };

  // ── 宣纸底 + 古籍双线框 ──
  ctx.fillStyle = PAPER;
  ctx.fillRect(0, 0, W, H);
  ctx.strokeStyle = BORDER;
  ctx.lineWidth = 2;
  ctx.strokeRect(16, 16, W - 32, H - 32);
  ctx.lineWidth = 1;
  ctx.strokeRect(24, 24, W - 48, H - 48);

  // ── 右侧竖排侧签「纸上山河」（极淡） ──
  ctx.fillStyle = '#ddd5c1';
  ctx.font = `400 17px ${KAI}`;
  ctx.textAlign = 'center';
  '纸上山河'.split('').forEach((ch, i) => {
    ctx.fillText(ch, W - 46, 210 + i * 30);
  });

  // ── 品牌：朱印 + 文学巡礼 ──
  drawSeal(W / 2, 66, 34, '巡');
  ctx.fillStyle = VERMILION;
  ctx.font = `600 15px ${SERIF}`;
  ctx.textAlign = 'center';
  ctx.fillText('文 学 巡 礼', W / 2, 108);

  // ── 大标题（最多 2 行） ──
  ctx.fillStyle = INK;
  ctx.font = `900 38px ${SERIF}`;
  const tLines = wrapText(title, W - 150, 2);
  let y = 162;
  tLines.forEach(l => {
    ctx.fillText(l, W / 2, y);
    y += 50;
  });

  // ── 副标题（楷体点睛句） ──
  y += 12;
  if (subtitle) {
    ctx.fillStyle = MUTED;
    ctx.font = `400 19px ${KAI}`;
    const sLines = wrapText(subtitle, W - 140, 2);
    sLines.forEach(l => {
      ctx.fillText(l, W / 2, y);
      y += 30;
    });
  }

  // ── 统计行：朱砂方点 + 数字 ──
  y += 24;
  const nLoc = (tour.locations || []).length;
  drawRowCenter([
    { text: '■ ', font: `400 10px ${SANS}`, fill: VERMILION },
    { text: `${nLoc}`, font: `700 18px ${SERIF}`, fill: INK },
    { text: ' 文学地点', font: `400 15px ${SERIF}`, fill: MUTED, gap: 18 },
    { text: '■ ', font: `400 10px ${SANS}`, fill: DAI },
    { text: `${routes.length}`, font: `700 18px ${SERIF}`, fill: INK },
    { text: ' 游览路线', font: `400 15px ${SERIF}`, fill: MUTED },
  ], y);
  y += 44;

  // ── 亮点地点：壹贰叁 + 名 + 藤黄星 ──
  sectionHeader('亮 点 地 点', y);
  y += 40;
  for (let i = 0; i < locs.length; i++) {
    if (y > MAX_Y) break;
    const l = locs[i];
    const stars = '★'.repeat(Math.min(l.importance || 1, 5));
    drawRowCenter([
      { text: cnOrdinal(i), font: `600 15px ${SERIF}`, fill: VERMILION, gap: 10 },
      { text: l.name, font: `600 19px ${SERIF}`, fill: INK, gap: 14 },
      { text: stars, font: `400 11px ${SANS}`, fill: GAMBOGE },
    ], y);
    y += 40;
  }

  // ── 行程预览：国画五色点 + 天数 + 标题 ──
  y += 16;
  if (routes.length > 0 && y < MAX_Y) {
    sectionHeader('行 程 预 览', y);
    y += 38;
    for (let i = 0; i < routes.length; i++) {
      if (y > MAX_Y) break;
      const r = routes[i];
      const day = r.day || r.day_label || '';
      const color = ROUTE_COLORS[i % ROUTE_COLORS.length];
      // 色点单独画（圆形），文字混排
      ctx.font = `400 16px ${SANS}`;
      const dayText = day ? `${day}` : '';
      const titleText = r.title || '';
      const dayW = dayText ? ctx.measureText(dayText).width : 0;
      const titleW = ctx.measureText(titleText).width;
      const dotW = 8 + 12; // 圆点 + 间距
      const midW = dayText ? dayW + 10 : 0; // 天数与标题间距
      const total = dotW + dayW + midW + titleW;
      let x = W / 2 - total / 2;
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(x + 4, y - 5, 4, 0, Math.PI * 2);
      ctx.fill();
      x += dotW;
      ctx.textAlign = 'left';
      if (dayText) {
        ctx.font = `600 15px ${SERIF}`;
        ctx.fillStyle = VERMILION;
        ctx.fillText(dayText, x, y);
        x += dayW + 10;
      }
      ctx.font = `400 16px ${SANS}`;
      ctx.fillStyle = INK;
      ctx.fillText(titleText, x, y);
      ctx.textAlign = 'center';
      y += 34;
    }
  }

  // ── 二维码卡（双线框笺纸） ──
  ctx.fillStyle = MUTED;
  ctx.font = `400 16px ${KAI}`;
  ctx.textAlign = 'center';
  ctx.fillText('扫码开启你的文学之旅', W / 2, H - 356);
  const qrCard = { x: W / 2 - 106, y: H - 338, s: 212 };
  ctx.fillStyle = IVORY;
  ctx.fillRect(qrCard.x, qrCard.y, qrCard.s, qrCard.s);
  ctx.strokeStyle = BORDER;
  ctx.lineWidth = 1.5;
  ctx.strokeRect(qrCard.x, qrCard.y, qrCard.s, qrCard.s);
  ctx.lineWidth = 1;
  ctx.strokeRect(qrCard.x + 5, qrCard.y + 5, qrCard.s - 10, qrCard.s - 10);
  if (qrCanvas) {
    try {
      ctx.drawImage(qrCanvas, qrCard.x + 18, qrCard.y + 18, qrCard.s - 36, qrCard.s - 36);
    } catch {
      /* 二维码未就绪时忽略 */
    }
  }

  // ── 落款：小朱印 + 品牌句 ──
  drawSeal(W / 2 - 108, H - 58, 18, '巡');
  ctx.fillStyle = FAINT;
  ctx.font = `400 13px ${SANS}`;
  ctx.textAlign = 'left';
  ctx.fillText('文学巡礼 · 跟着小说游山水', W / 2 - 92, H - 53);
}
