export interface Booking {
  id: string;
  partner_id: string;
  property_id: string;
  enquiry_id: string | null;
  guest_name: string;
  guest_email: string | null;
  guest_phone: string | null;
  guest_nationality: string | null;
  guests_total: number;
  guests_adults: number | null;
  guests_children: number | null;
  check_in: string;
  check_out: string;
  platform: string | null;
  manager: string | null;
  total_amount: number | null;
  balance_due: number | null;
  currency: string;
  house_contact: string | null;
  extras: string | null;
  notes: string | null;
  status: BookingStatus;
  /** Distinguishes real bookings from manual Blocks placed by the team
   *  to hold dates off the calendar. Added in the 2026-05-24 migration;
   *  defaults to 'booking' so legacy rows keep their meaning. */
  kind: 'booking' | 'block';
  created_at: string;
  updated_at: string;
  created_by: string | null;
  updated_by: string | null;
}

export type BookingStatus = 'tentative' | 'confirmed' | 'checked_in' | 'checked_out' | 'cancelled';

export interface BookingWithProperty extends Booking {
  property_name: string;
  property_bedrooms: number | null;
  property_suburb: string | null;
}

/** Which self-serve form a token + submission belongs to. */
export type BookingFormType = 'guest' | 'agent';

/** Declared values collected by the self-serve guest/agent forms — a 1:1 side
 *  table off bookings (booking_details). Never holds bookings core columns. */
export interface BookingDetails {
  booking_id: string;
  // guest form
  guest_flight_details: string | null;
  guest_check_in_time: string | null;
  guest_check_out_time: string | null;
  guest_weekend_housekeeping: boolean | null;
  guest_staff_requirements: string | null;
  guest_baby_cot: boolean | null;
  guest_baby_high_chair: boolean | null;
  guest_submitted_at: string | null;
  // agent form
  agent_guest_name: string | null;
  agent_guests_count: number | null;
  agent_check_in: string | null;
  agent_check_out: string | null;
  agent_house: string | null;
  agent_contact_number: string | null;
  agent_flight_details: string | null;
  agent_check_in_time: string | null;
  agent_check_out_time: string | null;
  agent_staff_requirements: string | null;
  agent_rates: string | null;
  agent_payment_terms: string | null;
  agent_other_requests: string | null;
  agent_indemnity_signed: boolean | null;
  agent_breakages_deposit: number | null;
  agent_submitted_at: string | null;
  created_at: string;
  updated_at: string;
}
