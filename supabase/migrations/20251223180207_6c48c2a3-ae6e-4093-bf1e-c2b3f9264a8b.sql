-- Create holidays table
CREATE TABLE IF NOT EXISTS public.holidays (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  date DATE NOT NULL,
  name TEXT NOT NULL,
  federal_state TEXT DEFAULT 'BY',
  is_recurring BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(date, federal_state)
);

-- Enable RLS
ALTER TABLE public.holidays ENABLE ROW LEVEL SECURITY;

-- Everyone can view holidays
DROP POLICY IF EXISTS "Everyone can view holidays" ON public.holidays;
CREATE POLICY "Everyone can view holidays"
  ON public.holidays FOR SELECT USING (true);

-- Only admins can manage holidays
DROP POLICY IF EXISTS "Admins can manage holidays" ON public.holidays;
CREATE POLICY "Admins can manage holidays"
  ON public.holidays FOR ALL USING (has_role(auth.uid(), 'admin'));

-- Trigger for updated_at
DROP TRIGGER IF EXISTS update_holidays_updated_at ON public.holidays;
CREATE TRIGGER update_holidays_updated_at
  BEFORE UPDATE ON public.holidays
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_updated_at();

-- Insert Bavarian holidays for 2026
INSERT INTO public.holidays (date, name, federal_state) VALUES
  ('2026-01-01', 'Neujahr', 'BY'),
  ('2026-01-06', 'Heilige Drei Könige', 'BY'),
  ('2026-04-03', 'Karfreitag', 'BY'),
  ('2026-04-05', 'Ostersonntag', 'BY'),
  ('2026-04-06', 'Ostermontag', 'BY'),
  ('2026-05-01', 'Tag der Arbeit', 'BY'),
  ('2026-05-14', 'Christi Himmelfahrt', 'BY'),
  ('2026-05-24', 'Pfingstsonntag', 'BY'),
  ('2026-05-25', 'Pfingstmontag', 'BY'),
  ('2026-06-04', 'Fronleichnam', 'BY'),
  ('2026-08-15', 'Mariä Himmelfahrt', 'BY'),
  ('2026-10-03', 'Tag der Deutschen Einheit', 'BY'),
  ('2026-11-01', 'Allerheiligen', 'BY'),
  ('2026-12-25', '1. Weihnachtstag', 'BY'),
  ('2026-12-26', '2. Weihnachtstag', 'BY')
ON CONFLICT (date, federal_state) DO NOTHING;
