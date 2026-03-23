import { type CSSProperties } from 'react';
import { useNavigate } from 'react-router-dom';

function AccessDenied({ message = null }: { message?: string | null }) {
  const navigate = useNavigate();

  return (
    <div style={s.container}>
      <div style={s.card}>
        <div style={s.icon}>🔒</div>
        <h2 style={s.title}>Access Denied</h2>
        <p style={s.message}>
          {message || "You don't have permission to access this page."}
        </p>
        <div style={s.actions}>
          <button onClick={() => navigate(-1)} style={s.backButton}>Go Back</button>
          <button onClick={() => navigate('/')} style={s.homeButton}>Go to Home</button>
        </div>
        <p style={s.helpText}>
          If you believe you should have access, please contact your administrator.
        </p>
      </div>
    </div>
  );
}

const s: Record<string, CSSProperties> = {
  container: { display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '60vh', padding: '2rem' },
  card: { background: 'white', borderRadius: '12px', padding: '3rem', textAlign: 'center', maxWidth: '400px', boxShadow: '0 4px 20px rgba(0,0,0,0.08)' },
  icon: { fontSize: '4rem', marginBottom: '1rem' },
  title: { margin: '0 0 0.75rem 0', fontSize: '1.5rem', fontWeight: 600, color: '#1f2937' },
  message: { margin: '0 0 1rem 0', fontSize: '1rem', color: '#6b7280', lineHeight: 1.5 },
  actions: { display: 'flex', gap: '0.75rem', justifyContent: 'center', marginBottom: '1.5rem' },
  backButton: { padding: '0.625rem 1.25rem', fontSize: '0.875rem', fontWeight: 500, background: 'white', border: '1px solid #e5e7eb', borderRadius: '8px', cursor: 'pointer', color: '#374151' },
  homeButton: { padding: '0.625rem 1.25rem', fontSize: '0.875rem', fontWeight: 500, background: '#0F4C75', border: 'none', borderRadius: '8px', cursor: 'pointer', color: 'white' },
  helpText: { margin: 0, fontSize: '0.8125rem', color: '#9ca3af' },
};

export default AccessDenied;
