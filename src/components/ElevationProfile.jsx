import { useMemo, useRef, useEffect } from 'react';

// 海拔剖面图。prof 为 [[km, m], ...]；activeKm 由父组件驱动，用于和地图路线进度联动。
export default function ElevationProfile({ prof, activeKm, stops, height = 132, onProgressChange }) {
  const canvasRef = useRef(null);
  const layoutRef = useRef(null);
  const hoverKmRef = useRef(null);

  const data = useMemo(() => {
    if (!Array.isArray(prof) || prof.length < 2) return null;
    const kms = prof.map(p => p[0]);
    const eles = prof.map(p => p[1]);
    return {
      totalKm: kms[kms.length - 1],
      minEle: Math.min(...eles),
      maxEle: Math.max(...eles),
      maxPoint: prof[eles.indexOf(Math.max(...eles))],
      minPoint: prof[eles.indexOf(Math.min(...eles))],
      gain: eles.reduce((acc, v, i) => (i > 0 && v > eles[i - 1] ? acc + v - eles[i - 1] : acc), 0),
    };
  }, [prof]);

  // 把站点 lat/lng 映射到沿线里程（km），用于在剖面图上标注位置。
  const stopPositions = useMemo(() => {
    if (!data || !stops?.length) return [];
    const havKm = (a, b) => {
      const dLat = (b[1] - a[1]) * Math.PI / 180;
      const dLng = (b[0] - a[0]) * Math.PI / 180;
      const h = Math.sin(dLat / 2) ** 2
        + Math.cos(a[1] * Math.PI / 180) * Math.cos(b[1] * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
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

  const pointAt = km => {
    if (!data) return [0, 0];
    const clamped = Math.max(0, Math.min(km, data.totalKm));
    for (let i = 1; i < prof.length; i++) {
      const [fromKm, fromEle] = prof[i - 1];
      const [toKm, toEle] = prof[i];
      if (clamped <= toKm) {
        const t = (clamped - fromKm) / Math.max(toKm - fromKm, 0.0001);
        return [clamped, fromEle + (toEle - fromEle) * t];
      }
    }
    return [data.totalKm, prof[prof.length - 1][1]];
  };

  const gainAt = km => {
    if (!data) return 0;
    const clamped = Math.max(0, Math.min(km, data.totalKm));
    let gain = 0;
    let prevIndex = 0;
    while (prevIndex + 1 < prof.length && prof[prevIndex + 1][0] <= clamped) {
      gain += Math.max(0, prof[prevIndex + 1][1] - prof[prevIndex][1]);
      prevIndex += 1;
    }
    const prev = prof[prevIndex];
    return gain + Math.max(0, pointAt(clamped)[1] - prev[1]);
  };

  const draw = (progressKm = activeKm, hoverKm = hoverKmRef.current) => {
    const canvas = canvasRef.current;
    if (!canvas || !data) return;
    const dpr = window.devicePixelRatio || 1;
    const W = canvas.offsetWidth;
    const H = height;
    if (canvas.width !== W * dpr || canvas.height !== H * dpr) {
      canvas.width = W * dpr;
      canvas.height = H * dpr;
    }
    const g = canvas.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, W, H);

    const padL = 40, padR = 12, padT = 18, padB = 18;
    const cw = W - padL - padR;
    const ch = H - padT - padB;
    const { totalKm, minEle, maxEle } = data;
    const eleRange = Math.max(maxEle - minEle, 60);
    const lo = minEle - eleRange * 0.08;
    const hi = maxEle + eleRange * 0.08;
    const X = km => padL + (km / Math.max(totalKm, 0.01)) * cw;
    const Y = ele => padT + (1 - (ele - lo) / (hi - lo)) * ch;
    layoutRef.current = { padL, cw, totalKm };

    g.font = '9px ui-monospace, monospace';
    g.fillStyle = 'rgba(140,130,115,0.5)';
    for (const ele of [hi, (hi + lo) / 2, lo]) {
      const y = Y(ele);
      g.strokeStyle = ele === (hi + lo) / 2 ? 'rgba(140,130,115,0.05)' : 'rgba(140,130,115,0.08)';
      g.beginPath();
      g.moveTo(padL, y + .5);
      g.lineTo(W - padR, y + .5);
      g.stroke();
      g.textAlign = 'right';
      g.fillText(`${Math.round(ele).toLocaleString('en-US')}m`, padL - 5, y + 3);
    }
    g.textAlign = 'left';
    g.fillText('0', padL, H - 2);
    g.textAlign = 'right';
    g.fillText(`${totalKm >= 10 ? Math.round(totalKm) : totalKm}km`, W - padR, H - 2);

    g.beginPath();
    prof.forEach(([km, ele], i) => (i ? g.lineTo : g.moveTo).call(g, X(km), Y(ele)));
    g.strokeStyle = 'rgba(125,108,92,0.22)';
    g.lineWidth = 1.2;
    g.setLineDash([2, 3]);
    g.stroke();
    g.setLineDash([]);

    const boundedReveal = Math.max(0, Math.min(progressKm ?? totalKm, totalKm));
    const revealEle = pointAt(boundedReveal)[1];
    if (boundedReveal > 0) {
      const grad = g.createLinearGradient(0, padT, 0, padT + ch);
      grad.addColorStop(0, 'rgba(178,64,42,0.26)');
      grad.addColorStop(0.55, 'rgba(178,64,42,0.11)');
      grad.addColorStop(1, 'rgba(178,64,42,0.02)');
      g.beginPath();
      g.moveTo(X(0), padT + ch);
      prof.forEach(([km, ele]) => {
        if (km <= boundedReveal) g.lineTo(X(km), Y(ele));
      });
      g.lineTo(X(boundedReveal), Y(revealEle));
      g.lineTo(X(boundedReveal), padT + ch);
      g.closePath();
      g.fillStyle = grad;
      g.fill();

      g.beginPath();
      prof.forEach(([km, ele], i) => {
        if (km <= boundedReveal) (i ? g.lineTo : g.moveTo).call(g, X(km), Y(ele));
      });
      g.lineTo(X(boundedReveal), Y(revealEle));
      g.strokeStyle = '#b24028';
      g.lineWidth = 2;
      g.lineCap = 'round';
      g.lineJoin = 'round';
      g.shadowColor = 'rgba(178,64,40,0.18)';
      g.shadowBlur = 5;
      g.shadowOffsetY = 1;
      g.stroke();
      g.shadowColor = 'transparent';
      g.shadowBlur = 0;
      g.shadowOffsetY = 0;
    }

    if (data.maxPoint) {
      const mx = X(data.maxPoint[0]);
      const my = Y(data.maxPoint[1]);
      g.fillStyle = '#b24028';
      g.beginPath();
      g.arc(mx, my, 2.8, 0, 7);
      g.fill();
      g.strokeStyle = '#fff';
      g.lineWidth = 1.2;
      g.stroke();
      g.font = '600 9px ui-monospace, monospace';
      g.fillStyle = '#8f3a24';
      g.textAlign = Math.abs(mx - padL) < 42 ? 'left' : (Math.abs(mx - (W - padR)) < 48 ? 'right' : 'center');
      g.fillText(`${Math.round(data.maxPoint[1]).toLocaleString('en-US')}m`, mx, Math.max(padT + 2, my - 7));
    }

    const cursorKm = hoverKm ?? (typeof activeKm === 'number' ? Math.max(0, Math.min(activeKm, totalKm)) : totalKm);
    if (cursorKm >= 0 && cursorKm <= totalKm) {
      const [km, ele] = pointAt(cursorKm);
      const px = X(km);
      const py = Y(ele);
      g.strokeStyle = hoverKm != null ? 'rgba(180,70,45,0.5)' : 'rgba(180,70,45,0.3)';
      g.lineWidth = 1;
      g.beginPath();
      g.moveTo(px + .5, padT);
      g.lineTo(px + .5, padT + ch);
      g.stroke();
      g.fillStyle = '#c2402a';
      g.beginPath();
      g.arc(px, py, 3.8, 0, 7);
      g.fill();
      g.strokeStyle = '#fff';
      g.lineWidth = 1.5;
      g.stroke();

      const label = `${km.toFixed(km < 10 ? 1 : 0)}km · ${Math.round(ele).toLocaleString('en-US')}m · +${Math.round(gainAt(km)).toLocaleString('en-US')}m`;
      g.font = '600 10px ui-monospace, monospace';
      const labelWidth = g.measureText(label).width + 12;
      const labelX = Math.max(padL + 2, Math.min(px - labelWidth / 2, W - padR - labelWidth));
      const labelY = Math.max(padT - 10, py - 24);
      g.fillStyle = 'rgba(253,249,240,0.94)';
      g.fillRect(labelX, labelY, labelWidth, 16);
      g.strokeStyle = 'rgba(178,64,42,0.22)';
      g.lineWidth = 1;
      g.strokeRect(labelX + .5, labelY + .5, labelWidth - 1, 15);
      g.fillStyle = '#8f3a24';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText(label, labelX + labelWidth / 2, labelY + 8.5);
      g.textBaseline = 'alphabetic';
    }

    stopPositions.forEach(s => {
      if (s.km > totalKm) return;
      const ele = pointAt(s.km)[1];
      const x = X(s.km);
      const y = Y(ele);
      const passed = s.km <= boundedReveal + 0.01;
      g.strokeStyle = 'rgba(138,122,107,0.22)';
      g.lineWidth = 1;
      g.beginPath();
      g.moveTo(x + .5, y + 5);
      g.lineTo(x + .5, padT + ch);
      g.stroke();
      g.beginPath();
      g.arc(x, y, 2.4, 0, 7);
      g.fillStyle = passed ? 'rgba(255,255,255,0.8)' : 'rgba(255,255,255,0.45)';
      g.fill();
      g.strokeStyle = passed ? '#7d6c5c' : 'rgba(125,108,92,0.45)';
      g.lineWidth = 1.1;
      g.stroke();
    });
  };

  useEffect(() => {
    if (!data) return;
    draw(activeKm);
  }, [data, activeKm, stopPositions, height]);

  const movePointer = event => {
    const layout = layoutRef.current;
    if (!layout) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const km = Math.max(0, Math.min(
      ((event.clientX - rect.left - layout.padL) / layout.cw) * layout.totalKm,
      layout.totalKm
    ));
    hoverKmRef.current = km;
    draw(activeKm, km);
    onProgressChange?.(km);
  };

  const hidePointer = () => {
    hoverKmRef.current = null;
    draw(activeKm);
  };

  if (!data) return null;
  const gainText = data.gain >= 1000 ? `${(data.gain / 1000).toFixed(1)}km` : `${Math.round(data.gain)}m`;
  return (
    <div className="w-full">
      <div className="flex items-baseline justify-between px-1 pb-1">
        <span className="text-[10px] font-medium text-foreground/60">海拔剖面</span>
        <span className="text-[10px] text-foreground/50 font-mono">
          {data.minEle.toLocaleString('en-US')}–{data.maxEle.toLocaleString('en-US')}m · 爬升 {gainText} · {data.totalKm.toFixed(1)}km
        </span>
      </div>
      <canvas
        ref={canvasRef}
        className="w-full cursor-crosshair touch-none rounded-md bg-foreground/[0.02]"
        style={{ height }}
        onPointerDown={movePointer}
        onPointerMove={movePointer}
        onPointerLeave={hidePointer}
      />
    </div>
  );
}
