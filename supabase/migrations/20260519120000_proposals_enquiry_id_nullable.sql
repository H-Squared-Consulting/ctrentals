-- Allow proposals to be created without a linked enquiry.
--
-- The original schema assumed every proposal originated from an enquiry
-- (Operations → Enquiries → Generate Proposals). With the calculator now
-- able to produce sendable proposals directly (Properties → Pricing →
-- Create Proposal), there isn't always an enquiry to point at. The FK
-- itself stays (ON DELETE SET NULL on the existing column) — only the
-- NOT NULL constraint comes off.

ALTER TABLE proposals
  ALTER COLUMN enquiry_id DROP NOT NULL;
