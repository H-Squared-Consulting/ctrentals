/**
 * ModalStackContext — coordinates the layout when the global search
 * modal opens alongside another primary surface (right now: the
 * DealDetailModal on /operations/enquiries).
 *
 * Two modals on screen at once normally fight for the center of the
 * page. This context lets each modal declare itself + react to
 * what else is open:
 *
 *   - DealDetailModal calls setDealOpen(true) on mount, (false) on
 *     unmount. It also reports whether IT is the focused surface.
 *   - GlobalSearchModal reads dealOpen → picks a side-docked
 *     placement instead of center when both are open.
 *   - Either modal can call focus('deal' | 'search') on a click
 *     to bring itself to the front; the other gets faded.
 *
 * Mounted once in AppLayout so every page below has access.
 */
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';

export type ModalKey = 'deal' | 'enquiry' | 'search';

interface ModalStackValue {
  dealOpen: boolean;
  enquiryOpen: boolean;
  searchOpen: boolean;
  /** Any centered (non-search) modal currently mounted. Maintained
   *  by ActionModal / DetailModal via push/popPrimary on mount.
   *  Drives the search modal's right-docked placement and tells
   *  centered modals to shift left to make room. */
  primaryOpen: boolean;
  /** Which modal is in the foreground. The other goes faded. null
   *  = nothing open (or only one open — in which case it's
   *  implicitly focused). */
  focused: ModalKey | null;
  setDealOpen: (v: boolean) => void;
  setEnquiryOpen: (v: boolean) => void;
  setSearchOpen: (v: boolean) => void;
  /** Register a centered modal in the stack. Returns the matching
   *  unregister function — call on unmount. */
  pushPrimary: () => void;
  popPrimary: () => void;
  focus: (k: ModalKey) => void;
}

const ModalStackContext = createContext<ModalStackValue | null>(null);

export function ModalStackProvider({ children }: { children: ReactNode }) {
  const [dealOpen, setDealOpenInner]       = useState(false);
  const [enquiryOpen, setEnquiryOpenInner] = useState(false);
  const [searchOpen, setSearchOpenInner]   = useState(false);
  const [primaryCount, setPrimaryCount]    = useState(0);
  const [focused, setFocused]              = useState<ModalKey | null>(null);

  const pushPrimary = useCallback(() => setPrimaryCount(c => c + 1), []);
  const popPrimary  = useCallback(() => setPrimaryCount(c => Math.max(0, c - 1)), []);

  const setDealOpen = useCallback((v: boolean) => {
    setDealOpenInner(v);
    // When a modal opens it becomes the focused one. When it
    // closes, focus falls back to whatever's still open.
    setFocused(prev => {
      if (v) return 'deal';
      if (prev === 'deal') return null;
      return prev;
    });
  }, []);

  const setEnquiryOpen = useCallback((v: boolean) => {
    setEnquiryOpenInner(v);
    setFocused(prev => {
      if (v) return 'enquiry';
      if (prev === 'enquiry') return null;
      return prev;
    });
  }, []);

  const setSearchOpen = useCallback((v: boolean) => {
    setSearchOpenInner(v);
    setFocused(prev => {
      if (v) return 'search';
      if (prev === 'search') return null;
      return prev;
    });
  }, []);

  const focus = useCallback((k: ModalKey) => setFocused(k), []);

  // primaryCount is the authoritative source: any centered modal
  // shell pushes on mount and pops on unmount. The explicit
  // dealOpen / enquiryOpen booleans only feed the focus dance
  // (they identify *which* primary, for the faded-on-search-focus
  // styling — not whether one is open).
  const primaryOpen = primaryCount > 0;

  const value = useMemo<ModalStackValue>(() => ({
    dealOpen, enquiryOpen, searchOpen, primaryOpen, focused,
    setDealOpen, setEnquiryOpen, setSearchOpen, pushPrimary, popPrimary, focus,
  }), [dealOpen, enquiryOpen, searchOpen, primaryOpen, focused,
       setDealOpen, setEnquiryOpen, setSearchOpen, pushPrimary, popPrimary, focus]);

  return <ModalStackContext.Provider value={value}>{children}</ModalStackContext.Provider>;
}

/** Hook used by both modals. Returns `null` when the provider
 *  isn't in scope (e.g. logged-out screens that don't mount
 *  AppLayout) — callers should fall back to single-modal
 *  behaviour in that case. */
export function useModalStack(): ModalStackValue | null {
  return useContext(ModalStackContext);
}
