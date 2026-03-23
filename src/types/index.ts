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
