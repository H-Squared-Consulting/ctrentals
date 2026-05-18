import { createContext, useContext, useState, useEffect, type ReactNode } from 'react';

interface LayoutContextValue {
  pageTitle: string;
  setPageTitle: (title: string) => void;
  pageHeaderSlot: ReactNode | null;
  setPageHeaderSlot: (node: ReactNode | null) => void;
  pageHeaderHidden: boolean;
  setPageHeaderHidden: (hidden: boolean) => void;
  isMobile: boolean;
}

const LayoutContext = createContext<LayoutContextValue | null>(null);

export function LayoutProvider({ children }: { children: ReactNode }) {
  const [pageTitle, setPageTitle] = useState('Properties');
  const [pageHeaderSlot, setPageHeaderSlot] = useState<ReactNode | null>(null);
  const [pageHeaderHidden, setPageHeaderHidden] = useState(false);
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia('(max-width: 768px)');
    setIsMobile(mq.matches);
    const handler = (e: MediaQueryListEvent) => setIsMobile(e.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);

  return (
    <LayoutContext.Provider value={{ pageTitle, setPageTitle, pageHeaderSlot, setPageHeaderSlot, pageHeaderHidden, setPageHeaderHidden, isMobile }}>
      {children}
    </LayoutContext.Provider>
  );
}

export function useLayout(): LayoutContextValue {
  const context = useContext(LayoutContext);
  if (!context) throw new Error('useLayout must be used within a LayoutProvider');
  return context;
}
