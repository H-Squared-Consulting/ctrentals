-- Management phase — owner / guest / agent email flow. Three tables:
-- email_templates (editable {{var}} wording), staff_settings (per-person
-- signature+bank, keyed by NT/HH/JH/GH initials), management_actions (sparse
-- sent-marks; sequence+due dates computed on the fly). RLS mirrors price_tiers
-- (authenticated-only, permissive USING(true)).

CREATE TABLE IF NOT EXISTS email_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  partner_id uuid NOT NULL,
  key text NOT NULL,
  audience text NOT NULL CHECK (audience IN ('owner','guest','agent')),
  channel_variant text CHECK (channel_variant IN ('direct','platform','agent')),
  label text NOT NULL,
  subject text NOT NULL,
  body text NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by text,
  UNIQUE (partner_id, key)
);
CREATE INDEX IF NOT EXISTS idx_email_templates_partner ON email_templates (partner_id);
ALTER TABLE email_templates ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON email_templates TO authenticated;
DROP POLICY IF EXISTS email_templates_select ON email_templates;
CREATE POLICY email_templates_select ON email_templates FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS email_templates_insert ON email_templates;
CREATE POLICY email_templates_insert ON email_templates FOR INSERT TO authenticated WITH CHECK (true);
DROP POLICY IF EXISTS email_templates_update ON email_templates;
CREATE POLICY email_templates_update ON email_templates FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS email_templates_delete ON email_templates;
CREATE POLICY email_templates_delete ON email_templates FOR DELETE TO authenticated USING (true);

CREATE TABLE IF NOT EXISTS staff_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  partner_id uuid NOT NULL,
  initials text NOT NULL,
  display_name text NOT NULL,
  reply_email text,
  reply_phone text,
  signature text,
  bank_sa text,
  bank_uk text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by text,
  UNIQUE (partner_id, initials)
);
ALTER TABLE staff_settings ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON staff_settings TO authenticated;
DROP POLICY IF EXISTS staff_settings_select ON staff_settings;
CREATE POLICY staff_settings_select ON staff_settings FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS staff_settings_insert ON staff_settings;
CREATE POLICY staff_settings_insert ON staff_settings FOR INSERT TO authenticated WITH CHECK (true);
DROP POLICY IF EXISTS staff_settings_update ON staff_settings;
CREATE POLICY staff_settings_update ON staff_settings FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS staff_settings_delete ON staff_settings;
CREATE POLICY staff_settings_delete ON staff_settings FOR DELETE TO authenticated USING (true);

CREATE TABLE IF NOT EXISTS management_actions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  partner_id uuid NOT NULL,
  booking_id uuid NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  action_key text NOT NULL,
  status text NOT NULL DEFAULT 'sent' CHECK (status IN ('pending','sent','skipped')),
  channel text CHECK (channel IN ('email','whatsapp')),
  due_date date,
  sent_at timestamptz,
  sent_by text,
  note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (booking_id, action_key)
);
CREATE INDEX IF NOT EXISTS idx_mgmt_actions_booking ON management_actions (booking_id);
CREATE INDEX IF NOT EXISTS idx_mgmt_actions_partner ON management_actions (partner_id);
ALTER TABLE management_actions ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON management_actions TO authenticated;
DROP POLICY IF EXISTS management_actions_select ON management_actions;
CREATE POLICY management_actions_select ON management_actions FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS management_actions_insert ON management_actions;
CREATE POLICY management_actions_insert ON management_actions FOR INSERT TO authenticated WITH CHECK (true);
DROP POLICY IF EXISTS management_actions_update ON management_actions;
CREATE POLICY management_actions_update ON management_actions FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS management_actions_delete ON management_actions;
CREATE POLICY management_actions_delete ON management_actions FOR DELETE TO authenticated USING (true);

INSERT INTO staff_settings (partner_id, initials, display_name, signature) VALUES
  ('3f12d140-8a4d-42a4-8d63-a97e7b2db4a0','NT','Nicki', E'Warm regards,\nNicki'),
  ('3f12d140-8a4d-42a4-8d63-a97e7b2db4a0','HH','Hayley',E'Warm regards,\nHayley'),
  ('3f12d140-8a4d-42a4-8d63-a97e7b2db4a0','JH','Jordon',E'Warm regards,\nJordon'),
  ('3f12d140-8a4d-42a4-8d63-a97e7b2db4a0','GH','Gary',  E'Warm regards,\nGary')
ON CONFLICT (partner_id, initials) DO NOTHING;

INSERT INTO email_templates (partner_id, key, audience, channel_variant, label, subject, body, sort_order) VALUES
('3f12d140-8a4d-42a4-8d63-a97e7b2db4a0','owner_confirmation','owner',NULL,'Owner — booking confirmation','Booking confirmed — {{property_name}} ({{check_in}})',E'Hi {{owner_first_name}},\n\nThis is to confirm your booking:\n\nName: {{guest_name}}\nGuests in party: {{adults}} adults and {{children}} children\nHousekeeper days: {{housekeeper_days}}\nDates: {{check_in}} to {{check_out}}\nDuration: {{nights}} nights\nRate: {{nightly_rate}}\nTotal: {{total_amount}}\nSpecial requests: {{special_requests}}\nPayment: {{owner_payment_paragraph}}\n\n{{signature}}',10),
('3f12d140-8a4d-42a4-8d63-a97e7b2db4a0','owner_balance_reminder','owner',NULL,'Owner — balance paid + arrival reminders','Upcoming booking reminder — {{property_name}} ({{check_in}})',E'Hi {{owner_first_name}},\n\nThis is a reminder of your upcoming booking:\n\nName: {{guest_name}}\nGuests in party: {{adults}} adults and {{children}} children\nHousekeeper days: {{housekeeper_days}}\nDates: {{check_in}} to {{check_out}}\nDuration: {{nights}} nights\nRate: {{nightly_rate}}\nTotal: {{total_amount}}\nSpecial requests: {{special_requests}}\n\nI have paid across the balance of your rental.\n\nWith your guests'' arrival coming up, here are a few important reminders to help everything run smoothly.\n\nKEYS & REMOTES\nPlease confirm the agreed number of key sets and remotes are in place and ready for your guests.\n\nPUBLIC HOLIDAYS\nCheck in with your pool and garden service to confirm their schedule over any upcoming public holidays.\n\nHOUSEHOLD STAFF\nPlease ensure staff are in earlier on arrival day to open up and make sure everything is perfect before guests check in.\n\nSPECIAL REQUESTS\nConfirm that any special requests have been taken care of ahead of arrival.\n\nCONSUMABLES & ESSENTIALS\nPlease stock up on the following before guests arrive:\n- Gas: full bottle in use plus a spare\n- Braai: sufficient wood and firelighters\n- Cleaning products, toilet paper, and laundry detergent for the duration of the stay\n\nAny questions, don''t hesitate to reach out, we''re here to help!\n\n{{signature}}',20),
('3f12d140-8a4d-42a4-8d63-a97e7b2db4a0','owner_post_stay','owner',NULL,'Owner — post-stay / breakages','Thank you — {{guest_name}}''s stay at {{property_name}}',E'Dear {{owner_first_name}},\n\nYour guests had a wonderful stay in your home!\n\nWe hope you find everything just as you left it, but please let us know within the next 7 days if anything has been lost or damaged. Should you wish to make a claim, kindly send through photos along with invoices for the replacement costs.\n\nIf we don''t hear from you within 7 days, we will go ahead and refund the breakages deposit.\n\nAs always, thank you for trusting us with your home, we look forward to welcoming your next guests!\n\n{{signature}}',30),
('3f12d140-8a4d-42a4-8d63-a97e7b2db4a0','guest_welcome','guest',NULL,'Guest — welcome + house manual','Welcome — your stay at {{property_name}}',E'Hi {{guest_first_name}},\n\nI hope you''re well and looking forward to your holiday in Cape Town.\n\nHere''s the link to your house manual: {{guidebook_url}}\nIt includes useful details about the house as well as our favourite local restaurants, transport options, and things to do in Cape Town.\n\nCould you please share your flight details and preferred check-in/out times? Standard check-in is after 2 pm, and check-out is by 10 am, but I''ll check and confirm any adjustments with the owners.\n\nYou can send these details through here: {{guest_form_link}}\n\nHousekeeping: The housekeeper works Monday to Friday. If you''d like assistance on weekends or public holidays, please let us know and we can arrange and the rates will be as follows:\n- Saturdays: R650/day\n- Sundays: R900/day\n- Public holidays: R1000/day\n\nIf you''re travelling with a little one, let us know in the form above if you''d like us to arrange a cot or high-chair.\n\nPlease let me know if there''s anything else you need before your arrival.\n\n{{signature}}',40),
('3f12d140-8a4d-42a4-8d63-a97e7b2db4a0','guest_prearrival_direct','guest','direct','Guest — pre-arrival (direct)','Getting ready for your stay — {{property_name}}',E'Dear {{guest_first_name}},\n\nWe''re so excited to welcome you for your upcoming stay!\n\nA reminder of your guidebook link: {{guidebook_url}}\n\nPlease find your final invoice attached for payment. Your refundable breakages deposit is due a week prior to check-in.\n\nCHECK-IN & CONTACT\n{{check_in_contact}} will meet you on arrival and will be your main point of contact throughout your stay. Please drop them a message as you leave the airport or when you are 30 minutes from the property.\n\nIf you have any questions in the meantime, don''t hesitate to get in touch.\n\n{{signature}}',50),
('3f12d140-8a4d-42a4-8d63-a97e7b2db4a0','guest_prearrival_platform','guest','platform','Guest — pre-arrival (platform)','Getting ready for your stay — {{property_name}}',E'Dear {{guest_first_name}},\n\nWe''re so excited to welcome you for your upcoming stay!\n\nA reminder of your guidebook link: {{guidebook_url}}\n\nCHECK-IN & CONTACT\n{{check_in_contact}} will meet you on arrival and will be your main point of contact throughout your stay. Please drop them a message as you leave the airport or when you are 30 minutes from the property.\n\nIf you have any questions in the meantime, don''t hesitate to get in touch.\n\n{{signature}}',60),
('3f12d140-8a4d-42a4-8d63-a97e7b2db4a0','guest_deposit_direct','guest','direct','Guest — breakages deposit (direct)','Breakages deposit for your stay — {{property_name}}',E'Dear {{guest_first_name}},\n\nPlease make payment of {{deposit_amount}} for your refundable breakages deposit. You are welcome to deposit into my SA bank account:\n\n[Add your SA bank account details here — editable in Settings → Email templates]\n\nWe will refund this within 7 days of your departure.\n\n{{signature}}',70),
('3f12d140-8a4d-42a4-8d63-a97e7b2db4a0','guest_feedback_direct','guest','direct','Guest — feedback request (direct)','Thank you for staying at {{property_name}}',E'Dear {{guest_first_name}},\n\nI hope you had a wonderful stay at {{property_name}} and a fantastic time in Cape Town!\n\nAny feedback, positive or negative, would be greatly appreciated. My homeowners are always keen to hear what worked well and how they can improve. I''d also love to know how the booking, check-in, and management process worked for you.\n\nCould you please send me your banking details so I can process the refund of your breakages deposit?\n\nI hope to welcome you back to Cape Town again soon!\n\n{{signature}}',80),
('3f12d140-8a4d-42a4-8d63-a97e7b2db4a0','guest_whatsapp_24h','guest',NULL,'Guest — WhatsApp check-in (24h)','Arrival reminder — {{property_name}}',E'Hi {{guest_first_name}}, we''re looking forward to welcoming you tomorrow!\n\nHere''s your guidebook: {{guidebook_url}}\n\nCheck-in: {{check_in}} from 2pm.\n\nSafe travels!\n{{staff_name}}',90),
('3f12d140-8a4d-42a4-8d63-a97e7b2db4a0','agent_details_request','agent','agent','Agent — guest details request','Booking details needed — {{property_name}}',E'Hi {{agent_first_name}},\n\nThanks so much for securing this booking. In order to ensure everything runs smoothly could you please give us the following details:\n\nYou can fill them in here: {{agent_form_link}}\n\n- Dates\n- House\n- Guest name\n- No. of guests\n- Contact number\n- Flight details\n- Check-in time\n- Check-out time\n- Staff requirements\n- Rates\n- Payment terms\n- Other requests\n- Confirmation they have signed an indemnity form\n- Amount of breakages deposit you are holding\n\n{{signature}}',100),
('3f12d140-8a4d-42a4-8d63-a97e7b2db4a0','agent_prearrival','agent','agent','Agent — pre-arrival','Getting ready for your guests — {{property_name}}',E'Hi {{agent_first_name}},\n\nWe are getting ready for your guests'' arrival, please share our house manual with them: {{guidebook_url}}\nIt includes useful details about the house as well as our favourite local restaurants, transport options, and things to do in Cape Town.\n\nCHECK-IN & CONTACT\n{{check_in_contact}} will meet them on arrival and check them into the house. Please can they drop her a message as they leave the airport or when they are 30 minutes from the property.\n\nPlease find the final invoice attached for payment.\n\n{{signature}}',110),
('3f12d140-8a4d-42a4-8d63-a97e7b2db4a0','agent_feedback','agent','agent','Agent — feedback request','Thank you — {{property_name}}',E'Dear {{agent_first_name}},\n\nI hope your guests had a wonderful stay at {{property_name}} and a fantastic time in Cape Town!\n\nAny feedback, positive or negative, would be greatly appreciated. My homeowners are always keen to hear what worked well and how they can improve.\n\nWhen you have a moment, please let us know about the breakages deposit.\n\nWe look forward to securing many more bookings with you.\n\n{{signature}}',120)
ON CONFLICT (partner_id, key) DO NOTHING;
