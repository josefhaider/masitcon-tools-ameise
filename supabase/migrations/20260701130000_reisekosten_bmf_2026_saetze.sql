-- ═══════════════════════════════════════════════════════════════════════════
-- Reisekosten: aktuelle BMF-Sätze ab 1. Januar 2026 + Regionsauswahl
--
-- Quelle: BMF-Schreiben vom 5. Dezember 2025, „Steuerliche Behandlung von
-- Reisekosten … bei Auslandsdienstreisen ab 1. Januar 2026". Werte:
-- volle Tagespauschale (24 h) / An-Abreise bzw. > 8 h.
-- Deutschland ist gesetzlich fixiert (28 / 14 €) und stabil.
--
-- Zusätzlich: business_trips erhält eine optionale `region`, damit Reisen mit
-- Städtesatz (z. B. Spanien – Palma de Mallorca) korrekt abgerechnet werden.
-- ═══════════════════════════════════════════════════════════════════════════

-- Region auf der Dienstreise (NULL = Standardsatz des Landes)
ALTER TABLE public.business_trips ADD COLUMN IF NOT EXISTS region TEXT;

-- Alte Seed-Sätze (Stand 2024) durch die offiziellen 2026er-Werte ersetzen.
DELETE FROM public.per_diem_rates;

INSERT INTO public.per_diem_rates
  (country_code, country_name, region, full_day_rate, partial_day_rate, valid_from, valid_to)
VALUES
  -- Inland (stabil seit 2020)
  ('DE', 'Deutschland',              NULL,                 28.00, 14.00, '2020-01-01', NULL),

  -- Länder-Standardsätze (ab 2026)
  ('AT', 'Österreich',               NULL,                 50.00, 33.00, '2026-01-01', NULL),
  ('BE', 'Belgien',                  NULL,                 59.00, 40.00, '2026-01-01', NULL),
  ('CZ', 'Tschechien',               NULL,                 32.00, 21.00, '2026-01-01', NULL),
  ('DK', 'Dänemark',                 NULL,                 75.00, 50.00, '2026-01-01', NULL),
  ('ES', 'Spanien',                  NULL,                 34.00, 23.00, '2026-01-01', NULL),
  ('FR', 'Frankreich',               NULL,                 53.00, 36.00, '2026-01-01', NULL),
  ('GB', 'Vereinigtes Königreich',   NULL,                 52.00, 35.00, '2026-01-01', NULL),
  ('IT', 'Italien',                  NULL,                 42.00, 28.00, '2026-01-01', NULL),
  ('LU', 'Luxemburg',                NULL,                 63.00, 42.00, '2026-01-01', NULL),
  ('NL', 'Niederlande',              NULL,                 58.00, 39.00, '2026-01-01', NULL),
  ('PL', 'Polen',                    NULL,                 34.00, 23.00, '2026-01-01', NULL),
  ('CH', 'Schweiz',                  NULL,                 70.00, 47.00, '2026-01-01', NULL),
  ('US', 'USA',                      NULL,                 59.00, 40.00, '2026-01-01', NULL),

  -- Spanien: Städte-/Regionssätze (Palma de Mallorca = Mallorca)
  ('ES', 'Spanien', 'Barcelona',            34.00, 23.00, '2026-01-01', NULL),
  ('ES', 'Spanien', 'Kanarische Inseln',    36.00, 24.00, '2026-01-01', NULL),
  ('ES', 'Spanien', 'Madrid',               42.00, 28.00, '2026-01-01', NULL),
  ('ES', 'Spanien', 'Palma de Mallorca',    44.00, 29.00, '2026-01-01', NULL),

  -- Weitere gängige Städtesätze
  ('FR', 'Frankreich', 'Paris',             58.00, 39.00, '2026-01-01', NULL),
  ('GB', 'Vereinigtes Königreich', 'London', 66.00, 44.00, '2026-01-01', NULL),
  ('IT', 'Italien', 'Rom',                  48.00, 32.00, '2026-01-01', NULL),
  ('IT', 'Italien', 'Mailand',              42.00, 28.00, '2026-01-01', NULL),
  ('PL', 'Polen', 'Warschau',               40.00, 27.00, '2026-01-01', NULL),
  ('CH', 'Schweiz', 'Bern',                 82.00, 55.00, '2026-01-01', NULL),
  ('CH', 'Schweiz', 'Genf',                 70.00, 47.00, '2026-01-01', NULL),
  ('US', 'USA', 'New York City',            66.00, 44.00, '2026-01-01', NULL),
  ('US', 'USA', 'Washington, D.C.',         66.00, 44.00, '2026-01-01', NULL),
  ('US', 'USA', 'San Francisco',            59.00, 40.00, '2026-01-01', NULL),
  ('US', 'USA', 'Los Angeles',              64.00, 43.00, '2026-01-01', NULL)
ON CONFLICT (country_code, COALESCE(region, ''), valid_from) DO NOTHING;
