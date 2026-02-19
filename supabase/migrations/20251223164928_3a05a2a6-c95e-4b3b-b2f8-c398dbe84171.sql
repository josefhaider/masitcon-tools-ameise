-- Erstelle balance_corrections Tabelle für manuelle Korrekturen
CREATE TABLE public.balance_corrections (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    effective_date DATE NOT NULL,
    correction_type TEXT NOT NULL CHECK (correction_type IN ('hours', 'vacation')),
    hours_adjustment NUMERIC,
    vacation_days_adjustment NUMERIC,
    reason TEXT NOT NULL,
    created_by UUID NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    applies_to_year INTEGER
);

-- Aktiviere RLS
ALTER TABLE public.balance_corrections ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "Admins can manage corrections"
ON public.balance_corrections
FOR ALL
USING (has_role(auth.uid(), 'admin'));

CREATE POLICY "Users can view own corrections"
ON public.balance_corrections
FOR SELECT
USING (user_id = auth.uid() OR has_role(auth.uid(), 'admin'));

-- Index für Performance
CREATE INDEX idx_balance_corrections_user_id ON public.balance_corrections(user_id);
CREATE INDEX idx_balance_corrections_effective_date ON public.balance_corrections(effective_date);
CREATE INDEX idx_balance_corrections_type ON public.balance_corrections(correction_type);

-- Erweitere profiles um annual_vacation_days
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS annual_vacation_days NUMERIC DEFAULT 30;