import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || 'https://mnvxitexcdgohzgtvwzg.supabase.co'
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1udnhpdGV4Y2Rnb2h6Z3R2d3pnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM5MTM4NTMsImV4cCI6MjA4OTQ4OTg1M30.h2Y1nIxV1xkvCyeSOknAiu-SrjPwijsueaJel10JoA4'

export const supabase = createClient(supabaseUrl, supabaseAnonKey)
