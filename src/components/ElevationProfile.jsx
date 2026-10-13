import { useMemo, useRef, useEffect } from 'react';

// v86a: Canvas 海拔剖面图。prof 为 [[km, m], ...]；activeKm 为当前选中站点的沿线里程。
export default function ElevationProfile({ prof, activeKm, stops, height = 80 }) {
  const canvasRef = useRef(null);
  const data = useMemo(() => {
    if (!Array.isArray(prof) || prof.length < 2) return null;
    const kms = prof.map(p => p[0]);
    const eles = prof.map(p => p[1]);
    return {
      totalKm: kms[kms.length - 1],
      minEle: Math.min(...eles),
      maxEle: Math.max(...eles),
      gain: eles.reduce((acc, v, i) => (i > 0 && v > eles[i - 1] ? acc + v - eles[i - 1] : acc), 0),
    };
  }, [prof]);

  // 把站点 lat/lng 映射到沿线里程（km），用于在剖面图上标注位置。
  const stopPositions = useMemo(() => {
    if (!data || !stops?.length) return [];
    const havKm = (a, b) => {
      const dLat = (b[1] - a[1]) * Math.PI / 180, dLng = (b[0] - a[0]) * Math.PI / 180;
      const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[1] * Math.PI / 180) * Math.cos(b[1] * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
      return 2 * 6371 * Math.asin(Math.sqrt(h));
    };
    let cum = 0;
    const result = [{ km: 0 }];
    for (let i = 1; i < stops.length; i++) {
      cum += havKm(stops[i - 1], stops[i]);
      result.push({ km: Math.round(cum * 100) / 100 });
    }
    return result;
  }, [data, stops]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !data) return;
    const dpr = window.devicePixelRatio || 1;
    const W = canvas.offsetWidth, H = height;
    if (canvas.width !== W * dpr || canvas.height !== H * dpr) {
      canvas.width = W * dpr; canvas.height = H * dpr;
    }
    const g = canvas.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, W, H);

    const padL = 34, padR = 8, padT = 6, padB = 14;
    const cw = W - padL - padR, ch = H - padT - padB;
    const { totalKm, minEle, maxEle } = data;
    const eleRange = Math.max(maxEle - minEle, 60);
    const lo = minEle - eleRange * 0.08, hi = maxEle + eleRange * 0.08;
    const X = km => padL + (km / Math.max(totalKm, 0.01)) * cw;
    const Y = ele => padT + (1 - (ele - lo) / (hi - lo)) * ch;

    // 网格线
    g.font = '9px ui-monospace, monospace';
    g.fillStyle = 'rgba(140,130,115,0.5)';
    for (const ele of [hi, lo]) {
      const y = Y(ele);
      g.strokeStyle = 'rgba(140,130,115,0.08)';
      g.beginPath(); g.moveTo(padL, y + .5); g.lineTo(W - padR, y + .5); g.stroke();
      g.textAlign = 'right'; g.fillText(`${Math.round(ele)}m`, padL - 3, y + 3);
    }
    g.textAlign = 'left'; g.fillText('0', padL, H - 2);
    g.textAlign = 'right'; g.fillText(`${totalKm >= 10 ? Math.round(totalKm) : totalKm}km`, W - padR, H - 2);

    // 渐变填充
    const grad = g.createLinearGradient(0, padT, 0, padT + ch);
    grad.addColorStop(0, 'rgba(180,70,45,0.18)');
    grad.addColorStop(1, 'rgba(180,70,45,0.02)');
    g.beginPath(); g.moveTo(X(0), padT + ch);
    prof.forEach(([km, ele]) => g.lineTo(X(km), Y(ele)));
    g.lineTo(X(totalKm), padT + ch);
    g.closePath(); g.fillStyle = grad; g.fill();

    // 线
    g.beginPath();
    prof.forEach(([km, ele], i) => (i ? g.lineTo : g.moveTo).call(g, X(km), Y(ele)));
    g.strokeStyle = '#b4462d'; g.lineWidth = 1.4; g.stroke();

    // 当前位置
    if (typeof activeKm === 'number' && activeKm >= 0 && activeKm <= totalKm) {
      const idx = Math.min(prof.length - 1, Math.round(activeKm / Math.max(totalKm, 0.01) * (prof.length - 1)));
      const [km, ele] = prof[idx];
      const px = X(km), py = Y(ele);
      g.strokeStyle = 'rgba(180,70,45,0.3)'; g.lineWidth = 1;
      g.beginPath(); g.moveTo(px + .5, padT); g.lineTo(px + .5, padT + ch); g.stroke();
      g.fillStyle = '#c2402a'; g.beginPath(); g.arc(px, py, 3.5, 0, 7); g.fill();
      g.strokeStyle = '#fff'; g.lineWidth = 1.5; g.stroke();
    }

    // 站点标记
    stopPositions.forEach((s) => {
      if (s.km > totalKm) return;
      const idx = Math.min(prof.length - 1, Math.round(s.km / Math.max(totalKm, 0.01) * (prof.length - 1)));
      const ele = prof[idx][1];
      g.beginPath(); g.arc(X(s.km), Y(ele), 2.2, 0, 7);
      g.fillStyle = 'rgba(255,255,255,0.8)'; g.fill();
      g.strokeStyle = '#8a7a6b'; g.lineWidth = 1; g.stroke();
    });
  }, [prof, data, activeKm, stopPositions, height]);

  if (!data) return null;
  const gainText = data.gain >= 1000 ? `${(data.gain / 1000).toFixed(1)}km` : `${Math.round(data.gain)}m`;
  return (
    <div className="w-full" style={{ height: height + 4 }}>
      <div className="flex items-center justify-between px-1 pb-0.5">
        <span className="text-[10px] text-foreground/40 font-mono">海拔剖面</span>
        <span className="text-[10px] text-foreground/40 font-mono">
          {data.minEle}–{data.maxEle}m · 爬升 {gainText}
        </span>
      </div>
      <canvas ref={canvasRef} style={{ width: '100%', height }} />
    </div>
  );
}
