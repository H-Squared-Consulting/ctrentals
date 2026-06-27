/**
 * LazyBookingModal — code-split wrapper around the heavy BookingModal.
 *
 * BookingModal carries the whole booking editor plus the Communications tab
 * (email composer + management engine), so it's a large module. It only ever
 * shows on demand (open a booking, or "New booking"), yet it was statically
 * imported by the Fab (global, on every page), the calendar, the dashboard and
 * the property editor — which dragged the entire thing into the main bundle and
 * slowed first paint everywhere. Routing every caller through this single lazy
 * boundary lets Vite split BookingModal into its own chunk that loads only when
 * a booking is actually opened. Swap the import, keep the same props.
 */
import { lazy, Suspense, type ComponentProps } from 'react';

const BookingModal = lazy(() => import('../pages/BookingModal'));

export default function LazyBookingModal(props: ComponentProps<typeof BookingModal>) {
  return (
    <Suspense fallback={null}>
      <BookingModal {...props} />
    </Suspense>
  );
}
