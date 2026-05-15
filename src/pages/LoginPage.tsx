import { useState, FormEvent } from 'react';
import { useAuth } from '../contexts/AuthContext';

type Mode = 'sign-in' | 'sign-up';

export function LoginPage() {
  const { signIn, signUp } = useAuth();
  const [mode, setMode] = useState<Mode>('sign-in');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setInfo(null);
    setLoading(true);
    try {
      if (mode === 'sign-in') {
        const { error } = await signIn(email, password);
        if (error) setError(error);
      } else {
        // Surface the most common signup mistake (short password) before
        // hitting the API, so the user gets a faster, clearer message.
        if (password.length < 6) {
          setError('Password must be at least 6 characters.');
          return;
        }
        const { error, needsEmailConfirmation } = await signUp(email, password);
        if (error) {
          setError(error);
        } else if (needsEmailConfirmation) {
          setInfo('Account created. Check your inbox for a confirmation link, then sign in.');
          setMode('sign-in');
          setPassword('');
        } else {
          // Project has email confirmation disabled — user is logged in.
          setInfo('Account created. Redirecting…');
        }
      }
    } finally {
      setLoading(false);
    }
  }

  function switchMode(next: Mode) {
    setMode(next);
    setError(null);
    setInfo(null);
  }

  const isSignUp = mode === 'sign-up';

  return (
    <div className="login-page">
      <div className="login-card">
        <div className="login-header">
          <h1>CT Rentals</h1>
          <p>Admin Portal</p>
        </div>
        <div className="login-tabs">
          <button
            type="button"
            className={`login-tab ${!isSignUp ? 'active' : ''}`}
            onClick={() => switchMode('sign-in')}
          >
            Sign In
          </button>
          <button
            type="button"
            className={`login-tab ${isSignUp ? 'active' : ''}`}
            onClick={() => switchMode('sign-up')}
          >
            Create Account
          </button>
        </div>
        <form onSubmit={handleSubmit}>
          {error && <div className="alert alert-error">{error}</div>}
          {info && <div className="alert alert-success">{info}</div>}
          <div className="form-group">
            <label className="form-label">Email</label>
            <input
              type="email"
              className="form-input"
              value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder="you@example.com"
              autoComplete={isSignUp ? 'email' : 'username'}
              required
            />
          </div>
          <div className="form-group">
            <label className="form-label">Password</label>
            <input
              type="password"
              className="form-input"
              value={password}
              onChange={e => setPassword(e.target.value)}
              placeholder={isSignUp ? 'Pick a password (min. 6 characters)' : 'Your password'}
              autoComplete={isSignUp ? 'new-password' : 'current-password'}
              minLength={isSignUp ? 6 : undefined}
              required
            />
          </div>
          <button
            type="submit"
            className="btn btn-primary"
            style={{ width: '100%', padding: '9px 16px', marginTop: '4px' }}
            disabled={loading}
          >
            {loading
              ? (isSignUp ? 'Creating account…' : 'Signing in…')
              : (isSignUp ? 'Create Account' : 'Sign In')}
          </button>
        </form>
      </div>
    </div>
  );
}
