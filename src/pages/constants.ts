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

// ── Pricing Engine ──

export const PRICING_PROPOSAL_STATUS_CONFIG: Record<string, { label: string; color: string; bg: string }> = {
  draft:    { label: 'Draft',    color: '#92400E', bg: '#FEF3C7' },
  live:     { label: 'Live',     color: '#065F46', bg: '#D1FAE5' },
  accepted: { label: 'Accepted', color: '#1E40AF', bg: '#DBEAFE' },
  expired:  { label: 'Expired',  color: '#6B7280', bg: '#F3F4F6' },
  archived: { label: 'Archived', color: '#6B7280', bg: '#F3F4F6' },
};

export const SEASON_TAG_OPTIONS = [
  { value: 'Peak', label: 'Peak' },
  { value: 'High', label: 'High' },
  { value: 'Mid',  label: 'Mid' },
  { value: 'Low',  label: 'Low' },
];

export const CALC_METHOD_OPTIONS = [
  { value: 'margin', label: 'Margin' },
  { value: 'markup', label: 'Markup' },
];

export const SCENARIO_TYPE_OPTIONS = [
  { value: 'direct',   label: 'Direct' },
  { value: 'agent',    label: 'Agent' },
  { value: 'platform', label: 'Platform' },
];

export const PLATFORM_NAME_OPTIONS = [
  { value: 'Airbnb',      label: 'Airbnb' },
  { value: 'Booking.com', label: 'Booking.com' },
  { value: 'VRBO',        label: 'VRBO' },
  { value: 'LekkeSlaap',  label: 'LekkeSlaap' },
  { value: 'Other',       label: 'Other' },
];
