import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { getErrorMessage } from '../lib/errorMessage';
import { useAuth } from '../contexts/AuthContext';
import { X, Send, Trash2, MessageCircle } from 'lucide-react';

export default function CommentsModal({ tourId, onClose }) {
  const { user } = useAuth();
  const [comments, setComments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [content, setContent] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error: loadError } = await supabase
      .from('comments')
      .select('*')
      .eq('tour_id', tourId)
      .order('created_at', { ascending: false });
    if (data) setComments(data);
    if (loadError) setError(getErrorMessage(loadError, '评论加载失败'));
    setLoading(false);
  }, [tourId]);

  useEffect(() => { load(); }, [load]);

  const submit = async () => {
    if (!user) { setError('请先登录'); return; }
    const text = content.trim();
    if (!text) return;
    setSubmitting(true);
    setError('');
    const authorName = user.email ? user.email.split('@')[0] : '旅人';
    const { error: err } = await supabase.from('comments').insert({
      tour_id: tourId,
      user_id: user.id,
      author_name: authorName,
      content: text,
    });
    setSubmitting(false);
    if (err) { setError(err.message); return; }
    setContent('');
    load();
  };

  const remove = async (c) => {
    const { error: removeError } = await supabase.from('comments').delete().eq('id', c.id);
    if (removeError) { setError(getErrorMessage(removeError, '删除评论失败')); return; }
    setComments(prev => prev.filter(x => x.id !== c.id));
  };

  const fmt = (iso) =>
    new Date(iso).toLocaleString('zh-CN', {
      month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit',
    });

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-end sm:items-center justify-center" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="comments-modal-title"
        className="bg-card rounded-t-2xl sm:rounded-2xl w-full max-w-lg max-h-[80vh] flex flex-col"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-3 border-b border-border flex-shrink-0">
          <h3 id="comments-modal-title" className="font-serif font-bold text-foreground flex items-center gap-1.5">
            <MessageCircle className="h-4 w-4 text-primary" /> 评论
          </h3>
          <button onClick={onClose} className="relative w-8 h-8 rounded-full bg-black/5 text-foreground flex items-center justify-center hover:bg-black/10 before:absolute before:-inset-1.5 before:content-['']" aria-label="关闭">
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* 评论列表 */}
        <div className="flex-1 overflow-y-auto px-5 py-3 space-y-3">
          {loading ? (
            <p className="text-center text-muted-foreground text-sm py-8">加载中…</p>
          ) : comments.length === 0 ? (
            <p className="text-center text-muted-foreground text-sm py-8">还没有评论，来抢沙发</p>
          ) : (
            comments.map(c => (
              <div key={c.id} className="bg-background rounded-xl p-3 border border-border">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs font-semibold text-foreground">{c.author_name}</span>
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] text-muted-foreground">{fmt(c.created_at)}</span>
                    {user && c.user_id === user.id && (
                      <button onClick={() => remove(c)} className="text-muted-foreground hover:text-primary" aria-label="删除评论">
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                </div>
                <p className="text-sm text-foreground leading-relaxed whitespace-pre-wrap break-words">{c.content}</p>
              </div>
            ))
          )}
        </div>

        {/* 输入 */}
        <div className="p-4 border-t border-border flex-shrink-0">
          {!user ? (
            <p className="text-center text-sm text-muted-foreground">登录后发表评论</p>
          ) : (
            <>
              <div className="flex gap-2">
                <input
                  aria-label="评论内容"
                  value={content}
                  onChange={e => setContent(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && submit()}
                  placeholder="写点什么…"
                  maxLength={500}
                  className="flex-1 bg-background text-foreground rounded-xl px-3 py-2.5 text-sm border border-border focus:border-primary outline-none transition-colors"
                />
                <button
                  onClick={submit}
                  disabled={submitting || !content.trim()}
                  className="px-4 py-2.5 bg-primary text-white rounded-xl text-sm font-semibold hover:bg-primary/90 disabled:opacity-50 flex items-center gap-1"
                >
                  <Send className="h-3.5 w-3.5" />发送
                </button>
              </div>
              {error && <p className="text-xs text-primary mt-2">{error}</p>}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
