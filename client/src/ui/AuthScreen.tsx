import { useState } from 'react';
import { signUp, signIn } from '../firebase/auth';
import { BackgroundNPCs } from './BackgroundNPCs';
import { playClickSound } from '../utils/sounds';

interface AuthScreenProps {
  onAuthSuccess: () => void;
}

export function AuthScreen({ onAuthSuccess }: AuthScreenProps) {
  const [isLogin, setIsLogin] = useState(true);
  const [email, setEmail] = useState(() => {
    // Load saved email from localStorage on mount
    return localStorage.getItem('rememberedEmail') || '';
  });
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [rememberMe, setRememberMe] = useState(() => {
    // Check if we have a saved email (means remember me was checked before)
    return !!localStorage.getItem('rememberedEmail');
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    playClickSound();
    setError('');
    setLoading(true);

    try {
      if (isLogin) {
        await signIn(email, password);
        // Save email to localStorage if "Remember Me" is checked
        if (rememberMe) {
          localStorage.setItem('rememberedEmail', email);
        } else {
          // Remove saved email if unchecked
          localStorage.removeItem('rememberedEmail');
        }
      } else {
        if (!displayName.trim()) {
          setError('Please enter a display name');
          setLoading(false);
          return;
        }
        await signUp(email, password, displayName.trim());
        // Also save email for sign up if remember me is checked
        if (rememberMe) {
          localStorage.setItem('rememberedEmail', email);
        } else {
          localStorage.removeItem('rememberedEmail');
        }
      }
      onAuthSuccess();
    } catch (err: any) {
      console.error('Auth error:', err);
      // Parse Firebase error messages
      if (err.code === 'auth/email-already-in-use') {
        setError('Email already in use');
      } else if (err.code === 'auth/weak-password') {
        setError('Password should be at least 6 characters');
      } else if (err.code === 'auth/invalid-email') {
        setError('Invalid email address');
      } else if (err.code === 'auth/user-not-found' || err.code === 'auth/wrong-password') {
        setError('Invalid email or password');
      } else if (err.code === 'auth/invalid-credential') {
        setError('Invalid email or password');
      } else {
        setError(err.message || 'Authentication failed');
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900 flex items-center justify-center p-4 relative">
      {/* Background NPCs */}
      <BackgroundNPCs />
      
      {/* Animated background elements */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none" style={{ zIndex: 1 }}>
        <div className="absolute top-1/4 left-1/4 w-64 h-64 bg-purple-500/10 rounded-full blur-3xl animate-pulse" />
        <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-cyan-500/10 rounded-full blur-3xl animate-pulse delay-1000" />
      </div>

      <div className="relative w-full max-w-md" style={{ zIndex: 10 }}>
        {/* Logo/Title */}
        <div className="text-center mb-8">
          <h1 className="text-4xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-cyan-400 to-purple-400 font-pixel mb-2">
            Orb Chat
          </h1>
          <p className="text-gray-400 text-sm">Walk, Talk, Collect Orbs!</p>
        </div>

        {/* Auth Card */}
        <div className="bg-gray-800/80 backdrop-blur-xl rounded-2xl border border-gray-700/50 shadow-2xl p-8">
          {/* Toggle */}
          <div className="flex mb-6 bg-gray-900/50 rounded-lg p-1">
            <button
              type="button"
              onClick={() => {
                playClickSound();
                setIsLogin(true);
              }}
              className={`flex-1 py-2 px-4 rounded-md text-sm font-medium transition-all ${
                isLogin 
                  ? 'bg-gradient-to-r from-cyan-500 to-purple-500 text-white shadow-lg' 
                  : 'text-gray-400 hover:text-white'
              }`}
            >
              Sign In
            </button>
            <button
              type="button"
              onClick={() => {
                playClickSound();
                setIsLogin(false);
              }}
              className={`flex-1 py-2 px-4 rounded-md text-sm font-medium transition-all ${
                !isLogin 
                  ? 'bg-gradient-to-r from-cyan-500 to-purple-500 text-white shadow-lg' 
                  : 'text-gray-400 hover:text-white'
              }`}
            >
              Sign Up
            </button>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            {!isLogin && (
              <div>
                <label className="block text-gray-300 text-sm mb-2">Display Name</label>
                <input
                  type="text"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  placeholder="Your in-game name"
                  maxLength={20}
                  className="w-full px-4 py-3 bg-gray-900/50 border border-gray-600 rounded-lg 
                           text-white placeholder-gray-500 focus:outline-none focus:ring-2 
                           focus:ring-cyan-500 focus:border-transparent transition-all"
                />
              </div>
            )}

            <div>
              <label className="block text-gray-300 text-sm mb-2">Email</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                required
                className="w-full px-4 py-3 bg-gray-900/50 border border-gray-600 rounded-lg 
                         text-white placeholder-gray-500 focus:outline-none focus:ring-2 
                         focus:ring-cyan-500 focus:border-transparent transition-all"
              />
            </div>

            <div>
              <label className="block text-gray-300 text-sm mb-2">Password</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                required
                minLength={6}
                className="w-full px-4 py-3 bg-gray-900/50 border border-gray-600 rounded-lg 
                         text-white placeholder-gray-500 focus:outline-none focus:ring-2 
                         focus:ring-cyan-500 focus:border-transparent transition-all"
              />
            </div>

            {/* Remember Me checkbox - only show on login */}
            {isLogin && (
              <div className="flex items-center">
                <input
                  type="checkbox"
                  id="rememberMe"
                  checked={rememberMe}
                  onChange={(e) => {
                    playClickSound();
                    setRememberMe(e.target.checked);
                    // If unchecking, remove saved email
                    if (!e.target.checked) {
                      localStorage.removeItem('rememberedEmail');
                    }
                  }}
                  className="w-4 h-4 text-cyan-500 bg-gray-900/50 border-gray-600 rounded 
                           focus:ring-2 focus:ring-cyan-500 focus:ring-offset-0 cursor-pointer"
                />
                <label htmlFor="rememberMe" className="ml-2 text-gray-300 text-sm cursor-pointer">
                  Remember me
                </label>
              </div>
            )}

            {error && (
              <div className="p-3 bg-red-500/20 border border-red-500/50 rounded-lg">
                <p className="text-red-400 text-sm text-center">{error}</p>
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full py-3 bg-gradient-to-r from-cyan-500 to-purple-500 text-white 
                       rounded-lg font-medium shadow-lg hover:shadow-cyan-500/25 
                       disabled:opacity-50 disabled:cursor-not-allowed transition-all
                       hover:scale-[1.02] active:scale-[0.98]"
            >
              {loading ? (
                <span className="flex items-center justify-center gap-2">
                  <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                  </svg>
                  {isLogin ? 'Signing in...' : 'Creating account...'}
                </span>
              ) : (
                isLogin ? 'Sign In' : 'Create Account'
              )}
            </button>
          </form>
        </div>

        {/* Footer */}
        <p className="text-center text-gray-500 text-xs mt-6">
          Walk around, chat, collect orbs, and customize your character!
        </p>
      </div>
    </div>
  );
}
