-- ═══════════════════════════════════════════════════════════════════════
--  CHIDORI · Pacientes + campos configurables
--  Correr en Supabase → SQL Editor → Run.  Es idempotente.
--
--  Reemplaza al enfoque de columnas fijas: los campos que se miden se
--  definen en una tabla (`field_definitions`) y sus valores viajan en JSONB.
--  Así se agregan o quitan features desde el panel de administración, sin
--  volver a tocar la base de datos nunca más.
--
--  NOTA · si corriste antes `protocolo_experimental.sql`, la tabla
--  `subjects` queda sin uso. Podés borrarla con:
--      drop table if exists public.subjects cascade;
-- ═══════════════════════════════════════════════════════════════════════


-- ─── 1 · CATÁLOGO DE CAMPOS ────────────────────────────────────────────
-- scope 'patient' → estable, se carga una vez por persona (altura, sexo…)
-- scope 'session' → cambia en cada medición (peso del día, temperatura…)

create table if not exists public.field_definitions (
  id          uuid primary key default gen_random_uuid(),
  scope       text not null check (scope in ('patient', 'session')),
  key         text not null,                       -- identificador interno
  label       text not null,                       -- lo que se ve en el form
  type        text not null default 'number'
              check (type in ('number','text','textarea','select','date','boolean')),
  unit        text,                                -- kg, m, cm, °C, %
  options     jsonb,                               -- ["Femenino","Masculino"] para select
  required    boolean not null default false,
  active      boolean not null default true,       -- ocultar sin perder datos
  sort_order  int not null default 0,
  help        text,                                -- ayuda bajo el campo
  created_at  timestamptz not null default now(),
  unique (scope, key)
);

alter table public.field_definitions enable row level security;

drop policy if exists "fields_select" on public.field_definitions;
create policy "fields_select" on public.field_definitions
  for select to authenticated using (true);

-- Solo los superadmin cambian el catálogo (define la forma del dataset)
drop policy if exists "fields_write" on public.field_definitions;
create policy "fields_write" on public.field_definitions
  for all to authenticated
  using (exists (select 1 from public.profiles p
                  where p.id = auth.uid() and p.role = 'superadmin'))
  with check (exists (select 1 from public.profiles p
                       where p.id = auth.uid() and p.role = 'superadmin'));


-- ─── 2 · PACIENTES ─────────────────────────────────────────────────────
-- El código es único y es lo que viaja al dataset; nombre y apellido son
-- para reconocerlos al elegirlos en la app.

create table if not exists public.patients (
  id          uuid primary key default gen_random_uuid(),
  code        text not null unique,                -- P-001, P-002…
  first_name  text,
  last_name   text,
  data        jsonb not null default '{}'::jsonb,  -- valores scope='patient'
  notes       text,
  active      boolean not null default true,
  created_by  uuid references auth.users(id) on delete set null,
  created_at  timestamptz not null default now()
);

alter table public.patients enable row level security;

drop policy if exists "patients_select" on public.patients;
create policy "patients_select" on public.patients
  for select to authenticated using (true);

drop policy if exists "patients_insert" on public.patients;
create policy "patients_insert" on public.patients
  for insert to authenticated with check (true);

drop policy if exists "patients_update" on public.patients;
create policy "patients_update" on public.patients
  for update to authenticated using (true);

create index if not exists patients_code_idx on public.patients (code);


-- ─── 3 · SESIONES · vínculo + datos variables ──────────────────────────

alter table public.sessions
  add column if not exists patient_id     uuid references public.patients(id) on delete set null,
  add column if not exists session_number int,                                  -- 1, 2, 3… por paciente
  add column if not exists session_data   jsonb not null default '{}'::jsonb;   -- valores scope='session'

create index if not exists sessions_patient_idx on public.sessions (patient_id);


-- ─── 4 · NUMERACIÓN AUTOMÁTICA DE SESIONES ─────────────────────────────
-- Cada sesión se numera dentro del paciente: 1, 2, 3… (para el "4 de 6").

create or replace function public.set_session_number()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.patient_id is not null and new.session_number is null then
    select coalesce(max(session_number), 0) + 1
      into new.session_number
      from public.sessions
     where patient_id = new.patient_id;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_session_number on public.sessions;
create trigger trg_session_number
  before insert on public.sessions
  for each row execute function public.set_session_number();


-- ─── 5 · CAMPOS INICIALES ──────────────────────────────────────────────
-- Los que ya venías usando. Desde el admin se editan, ocultan o amplían.

insert into public.field_definitions (scope, key, label, type, unit, options, required, sort_order, help)
values
  -- Ficha del paciente (estable)
  ('patient', 'sex',        'Sexo',              'select', null,
     '["Femenino","Masculino","Otro"]'::jsonb, false, 10, null),
  ('patient', 'birth_year', 'Año de nacimiento', 'number', null, null, false, 20, null),
  ('patient', 'height_m',   'Altura',            'number', 'm',  null, false, 30, null),

  -- Por sesión (variable)
  ('session', 'weight_kg',    'Peso',                     'number', 'kg', null, false, 10,
     'Se registra en cada medición: puede variar entre sesiones.'),
  ('session', 'iliac_circ_cm','Circunferencia suprailíaca','number', 'cm', null, false, 20, null),
  ('session', 'temperature_c','Temperatura ambiente',      'number', '°C', null, false, 30, null),
  ('session', 'humidity_pct', 'Humedad ambiente',          'number', '%',  null, false, 40, null),
  ('session', 'water_ml',     'Agua ingerida (total)',     'number', 'ml', null, false, 50,
     'Total de la sesión. Las tomas individuales se marcan como eventos.'),
  ('session', 'food_24h',     'Ingesta últimas 24 h',      'textarea', null, null, false, 60,
     'Comidas, bebidas (café, alcohol), sal, medicación.')
on conflict (scope, key) do nothing;


-- ─── 6 · VISTA DEL DATASET ─────────────────────────────────────────────
-- Una fila por sesión, con el paciente y los campos dinámicos expandidos.
-- Para la red neuronal: exportar esto como CSV.

create or replace view public.v_dataset as
select
  s.id                       as session_id,
  p.code                     as paciente,
  s.session_number           as nro_sesion,
  s.created_at               as fecha,
  -- campos del paciente (JSONB → columnas)
  p.data                     as datos_paciente,
  -- campos de la sesión
  s.session_data             as datos_sesion,
  -- medición
  s.initial_impedance        as z_inicial,
  s.final_impedance          as z_final,
  s.elapsed_time_str         as duracion,
  s.total_events             as eventos,
  s.notes                    as notas,
  -- calidad y protocolo
  (select count(*) from public.session_events e
    where e.session_id = s.id and e.kind = 'gap')   as microcortes,
  (select coalesce(sum(e.amount_ml), 0) from public.session_events e
    where e.session_id = s.id and e.kind = 'water') as agua_eventos_ml,
  (select coalesce(sum(e.amount_ml), 0) from public.session_events e
    where e.session_id = s.id and e.kind = 'void')  as miccion_ml
from public.sessions s
left join public.patients p on p.id = s.patient_id
order by p.code, s.session_number;
