import { useState, useRef, useEffect } from 'react';
import { QRCodeCanvas } from 'qrcode.react';
import { drawTourPoster } from '../lib/poster';
import { Check, Download, Link2, X } from 'lucide-react';

export default function ShareModal({ tour, tourId, onClose }) {
  const qrRef = useRef(null);
  const posterRef = useRef(null);
  const [copied, setCopied] = useState(false);
  const [saved, setSaved] = useState(false);

  // tourId 用路由参数（静态导览的 tour.id 可能为 undefined，meta.tourId 才是 id）
  const shareUrl = `${window.location.origin}/tour/${tourId || tour.meta?.tourId || tour.id}`;
  const title = tour.meta?.title || tour.title || '';

  // 打开时绘制海报预览
  useEffect(() => {
    if (posterRef.current && qrRef.current) {
      drawTourPoster(posterRef.current, tour, qrRef.current);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const copyLink = () => {
    navigator.clipboard.writeText(shareUrl).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  const downloadPoster = () => {
    const c = posterRef.current;
    if (!c) return;
    drawTourPoster(c, tour, qrRef.current); // 重绘确保含二维码
    const fileName = `${title || 'tour'}-海报.png`;
    c.toBlob(async (blob) => {
      if (!blob) return;
      // 1) 支持 Web Share 的（iOS Safari / 安卓 Chrome）→ 调起系统分享（可分享到微信等）
      if (navigator.canShare && navigator.canShare({ files: [new File([blob], fileName, { type: 'image/png' })] })) {
        try {
          await navigator.share({ files: [new File([blob], fileName, { type: 'image/png' })], title });
          return;
        } catch (e) { /* 用户取消 → 回退下载 */ }
      }
      // 2) 常规下载（blob URL，安卓/桌面生效）
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      a.remove();
      // 3) iOS Safari 兜底：新窗口打开，长按保存
      if (/iphone|ipad|ipod/i.test(navigator.userAgent)) {
        setTimeout(() => window.open(url, '_blank'), 300);
      } else {
        setTimeout(() => URL.revokeObjectURL(url), 5000);
      }
    }, 'image/png');
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-card rounded-2xl p-6 max-w-sm w-full max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-base font-serif font-bold text-foreground">分享「{title}」</h3>
          <button onClick={onClose} className="w-8 h-8 rounded-full bg-black/5 text-foreground flex items-center justify-center hover:bg-black/10" aria-label="关闭">
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* 海报预览 */}
        <div className="rounded-xl border border-border overflow-hidden bg-background mb-4">
          <canvas ref={posterRef} className="w-full h-auto" />
        </div>

        {/* 二维码 */}
        <div className="flex items-center justify-center py-3 bg-background rounded-xl border border-border mb-4">
          <QRCodeCanvas ref={qrRef} value={shareUrl} size={160} bgColor="#f5f4ed" fgColor="#141413" />
        </div>

        <div className="space-y-2">
          <button
            onClick={copyLink}
            className="w-full py-2.5 bg-black/5 text-foreground rounded-xl text-sm font-semibold hover:bg-black/10 transition-colors flex items-center justify-center gap-1.5"
          >
            {copied ? <Check className="h-4 w-4 text-green-700" /> : <Link2 className="h-4 w-4" />}
            {copied ? '链接已复制' : '复制链接'}
          </button>
          <button
            onClick={downloadPoster}
            className="w-full py-2.5 bg-primary text-white rounded-xl text-sm font-semibold hover:bg-primary/90 transition-colors flex items-center justify-center gap-1.5"
          >
            {saved ? <Check className="h-4 w-4" /> : <Download className="h-4 w-4" />}
            {saved ? '海报已下载' : '下载海报'}
          </button>
        </div>
      </div>
    </div>
  );
}
