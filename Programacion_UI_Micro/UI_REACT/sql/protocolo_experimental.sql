-- ═══════════════════════════════════════════════════════════════════════
--  CHIDORI · Protocolo experimental (dataset para red neuronal)
--  Correr una sola vez en Supabase → SQL Editor → Run
--
--  Qué agrega:
--    1. Tabla `subjects`  · una ficha por persona, para agrupar sus 4-6 sesiones
--    2. Columnas en `sessions` · vínculo al sujeto + variables de contexto
--    3. Columna en `session_events` · volumen (ml) de agua y micciones
--
--  Es idempotente: se puede correr más de una vez sin romper nada.
-- ═══════════════════════════════════════════════════════════════════════


-- ─── 1 · SUJETOS ───────────────────────────────────────────────────────
-- Los datos que NO cambian entre sesiones viven acá, así no se retipean
-- en cada medición y no hay riesgo de inconsistencias en el dataset.

create table if not exists public.subjects (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid references auth.users(id) on delete set null,
  code          text not null,                      -- S-001, S-002…
  display_name  text,                               -- nombre o iniciales
  birth_year    int,
  sex           text,
  height_m      numeric,                            -- suele ser estable
  weight_kg     numeric,                            -- basal; puede variar por sesión
  iliac_circ_cm numeric,
  notes         text,                               -- antecedentes relevantes
  created_at    timestamptz not null default now(),
  unique (code)
);

alter table public.subjects enable row level security;

-- Cualquier usuario autenticado puede ver y cargar sujetos (equipo de trabajo).
drop policy if exists "subjects_select" on public.subjects;
create policy "subjects_select" on public.subjects
  for select to authenticated using (true);

drop policy if exists "subjects_insert" on public.subjects;
create policy "subjects_insert" on public.subjects
  for insert to authenticated with check (true);

drop policy if exists "subjects_update" on public.subjects;
create policy "subjects_update" on public.subjects
  for update to authenticated using (true);


-- ─── 2 · SESIONES · vínculo + contexto experimental ────────────────────

alter table public.sessions
  add column if not exists subject_id     uuid references public.subjects(id) on delete set null,
  add column if not exists session_code   text,      -- p.ej. S-001_2026-07-30_01
  add column if not exists temperature_c  numeric,   -- ambiente
  add column if not exists humidity_pct   numeric,   -- ambiente
  add column if not exists food_24h       text,      -- ingesta de las últimas 24 h
  add column if not exists water_total_ml numeric;   -- agua total de la sesión

create index if not exists sessions_subject_idx on public.sessions (subject_id);


-- ─── 3 · EVENTOS · volumen asociado ────────────────────────────────────
-- `kind` ya distingue: 'mark' | 'disconnect' | 'reconnect' | 'gap'
-- y ahora suma:        'water' (ingesta) | 'void' (micción)
-- `amount_ml` guarda el volumen de esos dos.

alter table public.session_events
  add column if not exists amount_ml numeric;


-- ─── 4 · VISTA PARA EL DATASET ─────────────────────────────────────────
-- Una fila por sesión con todo el contexto ya unido, lista para exportar
-- y alimentar el modelo.

create or replace view public.v_dataset_sesiones as
select
  s.id                as session_id,
  s.session_code,
  sub.code            as subject_code,
  sub.sex,
  sub.birth_year,
  sub.height_m,
  coalesce(s.patient_weight, sub.weight_kg)      as weight_kg,
  coalesce(s.patient_iliac_circ, sub.iliac_circ_cm) as iliac_circ_cm,
  s.temperature_c,
  s.humidity_pct,
  s.food_24h,
  s.water_total_ml,
  s.initial_impedance,
  s.final_impedance,
  s.elapsed_time_str,
  s.total_events,
  s.notes,
  s.created_at,
  -- calidad del registro: cuántos huecos de datos tuvo la sesión
  (select count(*) from public.session_events e
    where e.session_id = s.id and e.kind = 'gap')        as microcortes,
  (select count(*) from public.session_events e
    where e.session_id = s.id and e.kind = 'water')      as tomas_agua,
  (select count(*) from public.session_events e
    where e.session_id = s.id and e.kind = 'void')       as micciones
from public.sessions s
left join public.subjects sub on sub.id = s.subject_id;
