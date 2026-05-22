/**
 * AcceptInvitePage — the landing page for the Supabase invite email.
 *
 * Flow:
 *   1. URL arrives as /accept-invite?token_hash=…&type=invite (set by the
 *      Supabase email template — see GitHub issue #1 § 5).
 *   2. We call supabase.auth.verifyOtp() to swap the one-time hash for a
 *      real session. The user is now signed in.
 *   3. The session gives us their email. We show a "set your password"
 *      form pre-filled (read-only) with that email.
 *   4. On submit we call the accept-invite edge function with the chosen
 *      password. The function re-verifies the session, checks the
 *      admin_invites allow-list, sets the password, marks the invite
 *      accepted, and returns { ok: true }.
 *   5. We navigate to /dashboard. The user is in.
 *
 * Failure paths:
 *   - No token in URL          → redirect to /login.
 *   - verifyOtp fails           → "expired or invalid" message + Login button.
 *   - Email isn't on allow-list → same generic message (don't leak detail).
 *   - Already accepted          → "already used" message + Login button.
 */

import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';

type Status =
  | 'verifying'   // hitting Supabase verifyOtp on mount
  | 'invalid'     // verifyOtp failed → bad / expired / used hash
  | 'set-password'
  | 'saving'      // accept-invite call in flight
  | 'denied'      // edge function rejected (not on allow-list, expired, etc.)
  | 'done';       // success — navigation imminent

interface DeniedDetail {
  reason: string;
  message: string;
}

const DENIED_MESSAGES: Record<string, string> = {
  'not-invited':         "We can't find an invite for this email. Ask Jordon for a new one.",
  'expired':             'This invite has expired. Ask Jordon for a new one.',
  'already-accepted':    'This invite has already been used. Try signing in.',
  'password-too-short':  'Password must be at least 8 characters.',
};
const DEFAULT_DENIED = 'Something went wrong completing your invite. Try the link again, or contact Jordon.';

export default function AcceptInvitePage() {
  const { supabase } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();

  const [status, setStatus] = useState<Status>('verifying');
  const [email, setEmail] = useState<string>('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [denied, setDenied] = useState<DeniedDetail | null>(null);

  // 1. Verify the token from the URL on mount.
  useEffect(() => {
    const tokenHash = params.get('token_hash') || params.get('token');
    const type = (params.get('type') || 'invite') as 'invite';
    if (!tokenHash) {
      navigate('/login', { replace: true });
      return;
    }
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type });
      if (cancelled) return;
      if (error || !data?.user?.email) {
        setStatus('invalid');
        return;
      }
      setEmail(data.user.email);
      setStatus('set-password');
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (status !== 'set-password') return;
    if (password.length < 8) {
      setDenied({ reason: 'password-too-short', message: DENIED_MESSAGES['password-too-short'] });
      return;
    }
    if (password !== confirm) {
      setDenied({ reason: 'password-mismatch', message: "Passwords don't match." });
      return;
    }
    setStatus('saving');
    setDenied(null);

    // Call the edge function. We rely on the verifyOtp session being set
    // so the SDK auto-attaches the Authorization header.
    const { data, error } = await supabase.functions.invoke('accept-invite', {
      body: { password },
    });

    if (error || !data?.ok) {
      const reason: string = data?.reason || error?.message || 'unknown';
      setDenied({ reason, message: DENIED_MESSAGES[reason] || DEFAULT_DENIED });
      setStatus('denied');
      return;
    }

    setStatus('done');
    navigate('/dashboard', { replace: true });
  }

  // ── Render ──
  if (status === 'verifying') {
    return (
      <div className="login-page">
        <div className="login-card">
          <div className="login-header">
            <h1>CT Rentals</h1>
            <p>Checking your invite…</p>
          </div>
          <div style={{ display: 'flex', justifyContent: 'center', padding: 20 }}>
            <div className="spinner" />
          </div>
        </div>
      </div>
    );
  }

  if (status === 'invalid' || status === 'denied') {
    const heading = status === 'invalid'
      ? 'Invite invalid or expired'
      : 'Sorry — can\'t complete this invite';
    const message = status === 'invalid'
      ? 'This link is no longer valid. Ask Jordon for a new one.'
      : (denied?.message || DEFAULT_DENIED);
    return (
      <div className="login-page">
        <div className="login-card">
          <div className="login-header">
            <h1>CT Rentals</h1>
            <p>Admin Portal</p>
          </div>
          <div className="alert alert-error">{heading}</div>
          <p style={{ fontSize: '0.875rem', color: 'var(--text-secondary)', margin: '0 0 16px' }}>
            {message}
          </p>
          <button
            type="button"
            className="btn btn-primary"
            style={{ width: '100%', padding: '9px 16px' }}
            onClick={() => navigate('/login', { replace: true })}
          >
            Back to login
          </button>
        </div>
      </div>
    );
  }

  // set-password / saving
  return (
    <div className="login-page">
      <div className="login-card">
        <div className="login-header">
          <h1>CT Rentals</h1>
          <p>Set up your account</p>
        </div>
        <form onSubmit={handleSubmit}>
          {denied && <div className="alert alert-error">{denied.message}</div>}
          <div className="form-group">
            <label className="form-label">Email</label>
            <input
              type="email"
              className="form-input"
              value={email}
              readOnly
              disabled
              style={{ background: 'var(--border-light)', cursor: 'not-allowed' }}
            />
          </div>
          <div className="form-group">
            <label className="form-label">Password</label>
            <input
              type="password"
              className="form-input"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="At least 8 characters"
              autoComplete="new-password"
              minLength={8}
              required
            />
          </div>
          <div className="form-group">
            <label className="form-label">Confirm password</label>
            <input
              type="password"
              className="form-input"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              placeholder="Repeat your password"
              autoComplete="new-password"
              minLength={8}
              required
            />
          </div>
          <button
            type="submit"
            className="btn btn-primary"
            style={{ width: '100%', padding: '9px 16px', marginTop: '4px' }}
            disabled={status === 'saving'}
          >
            {status === 'saving' ? 'Creating account…' : 'Create Account'}
          </button>
        </form>
      </div>
    </div>
  );
}
