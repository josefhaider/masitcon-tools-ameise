-- Create school_holidays table
CREATE TABLE IF NOT EXISTS public.school_holidays (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  federal_state TEXT DEFAULT 'BY',
  school_year TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.school_holidays ENABLE ROW LEVEL SECURITY;

-- Everyone can view school holidays
DROP POLICY IF EXISTS "Everyone can view school holidays" ON public.school_holidays;
CREATE POLICY "Everyone can view school holidays"
ON public.school_holidays
FOR SELECT
USING (true);

-- Only admins can manage school holidays
DROP POLICY IF EXISTS "Admins can manage school holidays" ON public.school_holidays;
CREATE POLICY "Admins can manage school holidays"
ON public.school_holidays
FOR ALL
USING (has_role(auth.uid(), 'admin'));

-- Add updated_at trigger
DROP TRIGGER IF EXISTS update_school_holidays_updated_at ON public.school_holidays;
CREATE TRIGGER update_school_holidays_updated_at
BEFORE UPDATE ON public.school_holidays
FOR EACH ROW
EXECUTE FUNCTION public.handle_updated_at();
