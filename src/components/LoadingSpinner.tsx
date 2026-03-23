import type { CSSProperties } from 'react';

interface LoadingSpinnerProps {
  fullScreen?: boolean;
}

function LoadingSpinner({ fullScreen = false }: LoadingSpinnerProps) {
  return (
    <div className={`loading-spinner ${fullScreen ? 'full-screen' : ''}`}>
      <div className="spinner" />
      {fullScreen && (
        <p style={styles.branding}>CT Rentals</p>
      )}
    </div>
  );
}

const styles: Record<string, CSSProperties> = {
  branding: {
    margin: '1rem 0 0 0',
    fontSize: '0.75rem',
    color: '#9ca3af',
    letterSpacing: '0.1em',
    textTransform: 'uppercase',
  },
};

export default LoadingSpinner;
