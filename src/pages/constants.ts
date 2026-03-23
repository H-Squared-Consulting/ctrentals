export const CT_RENTALS_PARTNER_ID = '3f12d140-8a4d-42a4-8d63-a97e7b2db4a0';

export const PROPERTY_TYPE_OPTIONS = [
  { value: 'short_term_rental', label: 'Short-term Rental' },
  { value: 'hotel', label: 'Hotel' },
  { value: 'guesthouse', label: 'Guesthouse' },
  { value: 'bnb', label: 'B&B' },
  { value: 'apartment', label: 'Apartment' },
  { value: 'villa', label: 'Villa' },
  { value: 'cottage', label: 'Cottage' },
  { value: 'lodge', label: 'Lodge' },
];

export const AVAILABILITY_OPTIONS = [
  { value: 'available', label: 'Available' },
  { value: 'booked', label: 'Booked' },
  { value: 'seasonal', label: 'Seasonal' },
  { value: 'unavailable', label: 'Unavailable' },
];

export const BOOKING_STATUS_CONFIG: Record<string, { label: string; color: string; bg: string }> = {
  tentative:   { label: 'Tentative',    color: '#92400E', bg: '#FEF3C7' },
  confirmed:   { label: 'Confirmed',    color: '#1E40AF', bg: '#DBEAFE' },
  checked_in:  { label: 'Checked In',   color: '#065F46', bg: '#D1FAE5' },
  checked_out: { label: 'Checked Out',  color: '#6B7280', bg: '#F3F4F6' },
  cancelled:   { label: 'Cancelled',    color: '#991B1B', bg: '#FEE2E2' },
};

export const BOOKING_STATUS_OPTIONS = Object.entries(BOOKING_STATUS_CONFIG).map(([value, cfg]) => ({
  value,
  label: cfg.label,
}));

export const PLATFORM_OPTIONS = [
  { value: 'direct', label: 'Direct' },
  { value: 'airbnb', label: 'Airbnb' },
  { value: 'booking_com', label: 'Booking.com' },
  { value: 'vrbo', label: 'VRBO' },
  { value: 'lekkeslaap', label: 'LekkeSlaap' },
  { value: 'repeat', label: 'Repeat Guest' },
  { value: 'other', label: 'Other' },
];
