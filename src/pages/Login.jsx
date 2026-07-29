import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';

export default function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isRegister, setIsRegister] = useState(false);
  const [error, setError] = useState('');
  const [msg, setMsg] = useState('');
  const { signIn, signUp } = useAuth();
  const navigate = useNavigate();

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setMsg('');

    if (!email || !password) {
      setError('请填写邮箱和密码');
      return;
    }
    if (password.length < 6) {
      setError('密码至少 6 位');
      return;
    }

    const { data, error: err } = isRegister
      ? await signUp(email, password)
      : await signIn(email, password);

    if (err) {
      setError(err.message);
    } else if (isRegister) {
      setMsg('注册成功！请检查邮箱验证链接。');
    } else {
      navigate('/');
    }
  };

  return (
    <div className="min-h-screen bg-[#0f0f1a] flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <h1 className="text-2xl font-bold text-white mb-2">文学巡礼</h1>
          <p className="text-gray-400 text-sm">{isRegister ? '创建账号，开始你的文学之旅' : '登录你的账号'}</p>
        </div>

        <form onSubmit={handleSubmit} className="bg-[#1c1c32] rounded-2xl p-6 border border-white/5">
          <div className="mb-4">
            <label className="block text-gray-400 text-xs mb-1.5">邮箱</label>
            <input
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder="your@email.com"
              className="w-full bg-[#0f0f1a] text-white rounded-xl px-4 py-3 text-sm border border-white/10 focus:border-red-600 outline-none transition-colors"
            />
          </div>

          <div className="mb-6">
            <label className="block text-gray-400 text-xs mb-1.5">密码</label>
            <input
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              placeholder="至少 6 位"
              className="w-full bg-[#0f0f1a] text-white rounded-xl px-4 py-3 text-sm border border-white/10 focus:border-red-600 outline-none transition-colors"
            />
          </div>

          {error && (
            <div className="bg-red-600/10 border border-red-600/20 rounded-xl p-3 mb-4 text-red-400 text-xs">{error}</div>
          )}
          {msg && (
            <div className="bg-green-600/10 border border-green-600/20 rounded-xl p-3 mb-4 text-green-400 text-xs">{msg}</div>
          )}

          <button
            type="submit"
            className="w-full py-3 bg-red-600 text-white rounded-xl text-sm font-semibold hover:bg-red-700 transition-colors"
          >
            {isRegister ? '注册' : '登录'}
          </button>

          <button
            type="button"
            onClick={() => { setIsRegister(!isRegister); setError(''); setMsg(''); }}
            className="w-full mt-3 py-2 text-gray-500 text-xs hover:text-gray-400 transition-colors"
          >
            {isRegister ? '已有账号？去登录' : '没有账号？去注册'}
          </button>
        </form>
      </div>
    </div>
  );
}
