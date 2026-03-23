import { createClient } from '@supabase/supabase-js'

export const supabase = createClient(
  'https://mnvxitexcdgohzgtvwzg.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1udnhpdGV4Y2Rnb2h6Z3R2d3pnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM5MTM4NTMsImV4cCI6MjA4OTQ4OTg1M30.h2Y1nIxV1xkvCyeSOknAiu-SrjPwijsueaJel10JoA4'
)
