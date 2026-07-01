-- ═══════════════════════════════════════════════════════════════════════════
-- Reisekostenabrechnung: Verpflegungsmehraufwand (VMA) nach § 9 Abs. 4a EStG
--
-- Zwei Tabellen:
--   per_diem_rates  – admin-gepflegte Tagessätze je Land (temporal versioniert)
--   business_trips  – von Mitarbeitern erfasste Dienstreisen (Genehmigungs-Workflow)
-- ═══════════════════════════════════════════════════════════════════════════

-- ── Satztabelle ──────────────────────────────────────────────────────────────
-- Pro Land (optional Stadt/Region) die gültigen Pauschalen. Über valid_from/
-- valid_to versioniert, weil die Auslandssätze (BMF) jährlich angepasst werden –
-- analog employee_work_schedules.
CREATE TABLE IF NOT EXISTS public.per_diem_rates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  country_code TEXT NOT NULL,
  country_name TEXT NOT NULL,
  region TEXT,                                   -- NULL = Standardsatz des Landes; sonst Stadt-Sonderfall
  full_day_rate NUMERIC(6,2) NOT NULL CHECK (full_day_rate >= 0),      -- voller Tagessatz (24 h)
  partial_day_rate NUMERIC(6,2) NOT NULL CHECK (partial_day_rate >= 0), -- An-/Abreisetag bzw. > 8 h
  valid_from DATE NOT NULL,
  valid_to DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Pro Land + Region + Gültigkeitsbeginn nur ein Satz (region NULL → '' im Index).
CREATE UNIQUE INDEX IF NOT EXISTS idx_per_diem_rates_unique
  ON public.per_diem_rates (country_code, COALESCE(region, ''), valid_from);
CREATE INDEX IF NOT EXISTS idx_per_diem_rates_country
  ON public.per_diem_rates (country_code);

-- ── Dienstreisen ─────────────────────────────────────────────────────────────
-- Eine Reise = ein Zielland (v1). Datum + Uhrzeit getrennt (lokale Zeit), analog
-- time_entries, um Zeitzonen-Fallstricke zu vermeiden.
CREATE TABLE IF NOT EXISTS public.business_trips (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  purpose TEXT NOT NULL,                          -- Anlass der Reise (steuerlich erforderlich)
  destination TEXT,                               -- Freitext-Reiseziel (z. B. "Wien")
  country_code TEXT NOT NULL,                     -- → per_diem_rates.country_code
  start_date DATE NOT NULL,
  start_time TIME NOT NULL,
  end_date DATE NOT NULL,
  end_time TIME NOT NULL,
  meals_provided JSONB NOT NULL DEFAULT '[]'::jsonb, -- [{date, breakfast, lunch, dinner}]
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  rejection_reason TEXT,
  approved_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  approved_at TIMESTAMPTZ,
  notes TEXT,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT business_trips_date_order CHECK (end_date >= start_date)
);

CREATE INDEX IF NOT EXISTS idx_business_trips_user ON public.business_trips (user_id);
CREATE INDEX IF NOT EXISTS idx_business_trips_status ON public.business_trips (status);
CREATE INDEX IF NOT EXISTS idx_business_trips_dates ON public.business_trips (start_date, end_date);

-- ── updated_at-Trigger (Funktion handle_updated_at existiert bereits) ─────────
DROP TRIGGER IF EXISTS set_updated_at_per_diem_rates ON public.per_diem_rates;
CREATE TRIGGER set_updated_at_per_diem_rates
  BEFORE UPDATE ON public.per_diem_rates
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

DROP TRIGGER IF EXISTS set_updated_at_business_trips ON public.business_trips;
CREATE TRIGGER set_updated_at_business_trips
  BEFORE UPDATE ON public.business_trips
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- ── Row Level Security ───────────────────────────────────────────────────────
ALTER TABLE public.per_diem_rates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.business_trips ENABLE ROW LEVEL SECURITY;

-- per_diem_rates: alle authentifizierten Nutzer lesen (für die Berechnung nötig),
-- nur Admins schreiben.
CREATE POLICY "Authenticated can read per diem rates"
  ON public.per_diem_rates FOR SELECT TO authenticated
  USING (true);

CREATE POLICY "Admins can insert per diem rates"
  ON public.per_diem_rates FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Admins can update per diem rates"
  ON public.per_diem_rates FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Admins can delete per diem rates"
  ON public.per_diem_rates FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role));

-- business_trips: eigene Reisen sehen; Admin/HR sehen alle.
CREATE POLICY "Users view own trips, admin/hr view all"
  ON public.business_trips FOR SELECT TO authenticated
  USING (
    user_id = auth.uid()
    OR public.has_role(auth.uid(), 'admin'::app_role)
    OR public.has_role(auth.uid(), 'hr_manager'::app_role)
  );

-- Mitarbeiter legen eigene Reisen nur als 'pending' an.
CREATE POLICY "Users create own pending trips"
  ON public.business_trips FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid() AND status = 'pending');

-- Mitarbeiter ändern eigene Reisen nur solange sie 'pending' sind (bleibt 'pending').
CREATE POLICY "Users update own pending trips"
  ON public.business_trips FOR UPDATE TO authenticated
  USING (user_id = auth.uid() AND status = 'pending')
  WITH CHECK (user_id = auth.uid() AND status = 'pending');

-- Admin/HR ändern alle Reisen (Freigabe/Ablehnung/Korrektur).
CREATE POLICY "Admin/hr update all trips"
  ON public.business_trips FOR UPDATE TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin'::app_role)
    OR public.has_role(auth.uid(), 'hr_manager'::app_role)
  )
  WITH CHECK (
    public.has_role(auth.uid(), 'admin'::app_role)
    OR public.has_role(auth.uid(), 'hr_manager'::app_role)
  );

-- Mitarbeiter löschen eigene 'pending'-Reisen; Admin/HR löschen alle.
CREATE POLICY "Users delete own pending, admin/hr delete all"
  ON public.business_trips FOR DELETE TO authenticated
  USING (
    (user_id = auth.uid() AND status = 'pending')
    OR public.has_role(auth.uid(), 'admin'::app_role)
    OR public.has_role(auth.uid(), 'hr_manager'::app_role)
  );

-- ── Seed: Standardsätze ──────────────────────────────────────────────────────
-- Deutschland ist gesetzlich fixiert (28 € / 14 €) und stabil.
-- Die Auslandssätze stammen aus der BMF-Tabelle „Pauschbeträge für Verpflegungs-
-- mehraufwendungen … bei Auslandsdienstreisen" (Stand 2024, weitgehend bis 2025).
-- WICHTIG: Vor produktivem Einsatz gegen das aktuell gültige BMF-Schreiben prüfen
-- und in der Verwaltung (Reisekostensätze) anpassen. valid_to = NULL ⇒ „aktuell".
INSERT INTO public.per_diem_rates (country_code, country_name, full_day_rate, partial_day_rate, valid_from, valid_to)
VALUES
  ('DE', 'Deutschland',            28.00, 14.00, '2024-01-01', NULL),
  ('AT', 'Österreich',             40.00, 27.00, '2024-01-01', NULL),
  ('CH', 'Schweiz',                64.00, 43.00, '2024-01-01', NULL),
  ('FR', 'Frankreich',             44.00, 29.00, '2024-01-01', NULL),
  ('IT', 'Italien',                40.00, 27.00, '2024-01-01', NULL),
  ('NL', 'Niederlande',            47.00, 32.00, '2024-01-01', NULL),
  ('BE', 'Belgien',                59.00, 40.00, '2024-01-01', NULL),
  ('LU', 'Luxemburg',              63.00, 42.00, '2024-01-01', NULL),
  ('PL', 'Polen',                  34.00, 23.00, '2024-01-01', NULL),
  ('CZ', 'Tschechien',             39.00, 26.00, '2024-01-01', NULL),
  ('ES', 'Spanien',                34.00, 23.00, '2024-01-01', NULL),
  ('DK', 'Dänemark',               75.00, 50.00, '2024-01-01', NULL),
  ('GB', 'Vereinigtes Königreich', 45.00, 30.00, '2024-01-01', NULL),
  ('US', 'USA (allgemein)',        59.00, 40.00, '2024-01-01', NULL)
ON CONFLICT (country_code, COALESCE(region, ''), valid_from) DO NOTHING;
