-- Add fields to profiles table
ALTER TABLE public.profiles 
ADD COLUMN IF NOT EXISTS default_weekly_hours numeric DEFAULT 40,
ADD COLUMN IF NOT EXISTS employee_number text UNIQUE;

-- Create employee_work_schedules table
CREATE TABLE IF NOT EXISTS public.employee_work_schedules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  day_of_week integer NOT NULL CHECK (day_of_week >= 0 AND day_of_week <= 6),
  start_time time NOT NULL,
  end_time time NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id, day_of_week)
);

-- Create break_rules table
CREATE TABLE IF NOT EXISTS public.break_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  min_work_hours numeric NOT NULL,
  break_minutes integer NOT NULL,
  is_mandatory boolean NOT NULL DEFAULT false,
  priority integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.employee_work_schedules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.break_rules ENABLE ROW LEVEL SECURITY;

-- RLS Policies for employee_work_schedules
DROP POLICY IF EXISTS "Users can view own schedule" ON public.employee_work_schedules;
CREATE POLICY "Users can view own schedule"
  ON public.employee_work_schedules
  FOR SELECT
  USING (user_id = auth.uid() OR has_role(auth.uid(), 'admin'::app_role));

DROP POLICY IF EXISTS "Only admins can manage schedules" ON public.employee_work_schedules;
CREATE POLICY "Only admins can manage schedules"
  ON public.employee_work_schedules
  FOR ALL
  USING (has_role(auth.uid(), 'admin'::app_role));

-- RLS Policies for break_rules
DROP POLICY IF EXISTS "Everyone can view break rules" ON public.break_rules;
CREATE POLICY "Everyone can view break rules"
  ON public.break_rules
  FOR SELECT
  USING (true);

DROP POLICY IF EXISTS "Only admins can manage break rules" ON public.break_rules;
CREATE POLICY "Only admins can manage break rules"
  ON public.break_rules
  FOR ALL
  USING (has_role(auth.uid(), 'admin'::app_role));

-- Add triggers for updated_at
DROP TRIGGER IF EXISTS update_employee_work_schedules_updated_at ON public.employee_work_schedules;
CREATE TRIGGER update_employee_work_schedules_updated_at
  BEFORE UPDATE ON public.employee_work_schedules
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_updated_at();

DROP TRIGGER IF EXISTS update_break_rules_updated_at ON public.break_rules;
CREATE TRIGGER update_break_rules_updated_at
  BEFORE UPDATE ON public.break_rules
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_updated_at();

-- Insert default break rules (German labor law)
INSERT INTO public.break_rules (name, min_work_hours, break_minutes, is_mandatory, priority) VALUES
  ('Gesetzliche Pause ab 6h', 6, 30, true, 1),
  ('Gesetzliche Pause ab 9h', 9, 45, true, 2),
  ('Optionale Pause ab 4h', 4, 15, false, 3)
ON CONFLICT DO NOTHING;
