-- ═══════════════════════════════════════════════════════════════════════
--  CHIDORI · Esquema de la base (Supabase / PostgreSQL)
--
--  Exportado el 10/10/2026 desde la base en producción con
--  sql/mantenimiento/06_exportar_esquema.sql. Es la ESTRUCTURA completa:
--  tablas, restricciones, índices, funciones, vistas, triggers, RLS,
--  políticas, permisos y comentarios. No contiene datos ni usuarios.
--
--  ── PARA QUÉ SIRVE ────────────────────────────────────────────────────
--  · Referencia y anexo de la tesis: la definición exacta de cada tabla.
--  · Reconstruir la base desde cero en un proyecto Supabase NUEVO y vacío.
--
--  ── NO CORRER SOBRE LA BASE ACTUAL ────────────────────────────────────
--  Choca con todo lo que ya existe (las restricciones dan error) y no
--  aporta nada. Para cambios sobre la base actual se usan los scripts de
--  sql/ y sql/mantenimiento/.
--
--  ── RECONSTRUIR DESDE CERO ────────────────────────────────────────────
--  1. Proyecto Supabase nuevo → SQL Editor → correr este archivo entero.
--  2. Cargar los catálogos (son DATOS, no estructura, por eso no están acá):
--       · calibraciones: sección 1 de sql/calibracion.sql
--       · campos iniciales: sección 5 de sql/pacientes_y_campos.sql
--  3. Restaurar los datos desde un respaldo.
--
--  ── NOTAS DE LECTURA ──────────────────────────────────────────────────
--  · `subjects` y las columnas patient_name, patient_age, patient_gender,
--    patient_weight, patient_height, patient_iliac_circ, menstruation_info,
--    subject_id, session_code, temperature_c, humidity_pct, food_24h y
--    water_total_ml de `sessions` son de esquemas anteriores: hoy los datos
--    de la persona van en `patients` y los de la sesión en `session_data`.
--    Se conservan porque las sesiones viejas las usan.
--  · Los permisos amplios de anon sobre las TABLAS son los que Supabase da
--    por defecto; el acceso real lo decide RLS, y anon no tiene ninguna
--    política. Las vistas sí quedan restringidas a mano (paso 3).
--  · Las vistas public_* las lee la web pública (chidori-web): exponen solo
--    el código del paciente, nunca nombre, apellido ni notas.
-- ═══════════════════════════════════════════════════════════════════════


-- ─── ENCABEZADO ────────────────────────────────────────────────────────

set check_function_bodies = false;


-- ─── TABLA ─────────────────────────────────────────────────────────────

create table if not exists public.calibrations (
  id smallint not null,
  label text not null,
  k_cal numeric not null,
  v_detector numeric not null,
  i_pp_a numeric,
  g_receiver numeric,
  method text,
  valid_from date,
  notes text,
  is_reference boolean default false not null,
  created_at timestamp with time zone default now() not null,
  hw_id smallint
);
create table if not exists public.field_definitions (
  id uuid default gen_random_uuid() not null,
  scope text not null,
  key text not null,
  label text not null,
  type text default 'number'::text not null,
  unit text,
  options jsonb,
  required boolean default false not null,
  active boolean default true not null,
  sort_order integer default 0 not null,
  help text,
  created_at timestamp with time zone default now() not null
);
create table if not exists public.measurements (
  id uuid default gen_random_uuid() not null,
  created_at timestamp with time zone default now() not null,
  session_id uuid not null,
  elapsed_time double precision not null,
  impedance double precision not null,
  rate double precision,
  impedance_raw numeric,
  rate_raw numeric,
  voltage_v numeric
);
create table if not exists public.patients (
  id uuid default gen_random_uuid() not null,
  code text not null,
  first_name text,
  last_name text,
  data jsonb default '{}'::jsonb not null,
  notes text,
  active boolean default true not null,
  created_by uuid,
  created_at timestamp with time zone default now() not null
);
create table if not exists public.profiles (
  id uuid not null,
  email text,
  display_name text,
  role text default 'clinician'::text not null,
  is_approved boolean default false not null,
  created_at timestamp with time zone default now() not null
);
create table if not exists public.session_events (
  id uuid default gen_random_uuid() not null,
  created_at timestamp with time zone default now() not null,
  session_id uuid not null,
  event_number integer not null,
  elapsed_time double precision not null,
  impedance double precision not null,
  impedance_change double precision,
  kind text default 'mark'::text not null,
  amount_ml numeric,
  impedance_raw numeric,
  impedance_change_raw numeric
);
create table if not exists public.sessions (
  id uuid default gen_random_uuid() not null,
  created_at timestamp with time zone default now() not null,
  patient_name text,
  patient_age integer,
  patient_gender text,
  patient_weight double precision,
  patient_height double precision,
  patient_iliac_circ double precision,
  menstruation_info text,
  initial_impedance double precision,
  final_impedance double precision,
  elapsed_time_str text,
  total_events integer default 0,
  user_id uuid,
  notes text,
  subject_id uuid,
  session_code text,
  temperature_c numeric,
  humidity_pct numeric,
  food_24h text,
  water_total_ml numeric,
  patient_id uuid,
  session_number integer,
  session_data jsonb default '{}'::jsonb not null,
  is_public boolean default false not null,
  is_featured boolean default false not null,
  calibration_id smallint,
  calibration_shown smallint,
  adc_lineal_asumido boolean default false not null,
  initial_impedance_raw numeric,
  final_impedance_raw numeric,
  k_cal_firmware numeric,
  v_detector_firmware numeric,
  calibration_matched boolean,
  calibration_hw_id smallint
);
create table if not exists public.subjects (
  id uuid default gen_random_uuid() not null,
  user_id uuid,
  code text not null,
  display_name text,
  birth_year integer,
  sex text,
  height_m numeric,
  weight_kg numeric,
  iliac_circ_cm numeric,
  notes text,
  created_at timestamp with time zone default now() not null
);


-- ─── RESTRICCIÓN ───────────────────────────────────────────────────────

alter table public.calibrations add constraint calibrations_pkey PRIMARY KEY (id);
alter table public.field_definitions add constraint field_definitions_pkey PRIMARY KEY (id);
alter table public.field_definitions add constraint field_definitions_scope_check CHECK ((scope = ANY (ARRAY['patient'::text, 'session'::text])));
alter table public.field_definitions add constraint field_definitions_scope_key_key UNIQUE (scope, key);
alter table public.field_definitions add constraint field_definitions_type_check CHECK ((type = ANY (ARRAY['number'::text, 'text'::text, 'textarea'::text, 'select'::text, 'date'::text, 'boolean'::text])));
alter table public.measurements add constraint measurements_pkey PRIMARY KEY (id);
alter table public.patients add constraint patients_code_key UNIQUE (code);
alter table public.patients add constraint patients_pkey PRIMARY KEY (id);
alter table public.profiles add constraint profiles_pkey PRIMARY KEY (id);
alter table public.session_events add constraint session_events_pkey PRIMARY KEY (id);
alter table public.sessions add constraint sessions_pkey PRIMARY KEY (id);
alter table public.subjects add constraint subjects_code_key UNIQUE (code);
alter table public.subjects add constraint subjects_pkey PRIMARY KEY (id);


-- ─── CLAVE FORÁNEA ─────────────────────────────────────────────────────

alter table public.calibrations add constraint calibrations_hw_id_fkey FOREIGN KEY (hw_id) REFERENCES calibrations(id);
alter table public.measurements add constraint measurements_session_id_fkey FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE;
alter table public.patients add constraint patients_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL;
alter table public.profiles add constraint profiles_id_fkey FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE;
alter table public.session_events add constraint session_events_session_id_fkey FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE;
alter table public.sessions add constraint sessions_calibration_hw_id_fkey FOREIGN KEY (calibration_hw_id) REFERENCES calibrations(id);
alter table public.sessions add constraint sessions_calibration_id_fkey FOREIGN KEY (calibration_id) REFERENCES calibrations(id);
alter table public.sessions add constraint sessions_calibration_shown_fkey FOREIGN KEY (calibration_shown) REFERENCES calibrations(id);
alter table public.sessions add constraint sessions_patient_id_fkey FOREIGN KEY (patient_id) REFERENCES patients(id) ON DELETE SET NULL;
alter table public.sessions add constraint sessions_subject_id_fkey FOREIGN KEY (subject_id) REFERENCES subjects(id) ON DELETE SET NULL;
alter table public.sessions add constraint sessions_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE SET NULL;
alter table public.subjects add constraint subjects_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE SET NULL;


-- ─── ÍNDICE ────────────────────────────────────────────────────────────

CREATE UNIQUE INDEX calibrations_una_referencia ON public.calibrations USING btree (is_reference) WHERE is_reference;
CREATE INDEX measurements_session_idx ON public.measurements USING btree (session_id, elapsed_time);
CREATE INDEX patients_code_idx ON public.patients USING btree (code);
CREATE INDEX session_events_session_idx ON public.session_events USING btree (session_id, event_number);
CREATE INDEX sessions_is_public_idx ON public.sessions USING btree (is_public) WHERE is_public;
CREATE UNIQUE INDEX sessions_paciente_nro_unico ON public.sessions USING btree (patient_id, session_number) WHERE ((patient_id IS NOT NULL) AND (session_number IS NOT NULL));
CREATE INDEX sessions_patient_idx ON public.sessions USING btree (patient_id);
CREATE INDEX sessions_subject_idx ON public.sessions USING btree (subject_id);
CREATE INDEX sessions_user_id_idx ON public.sessions USING btree (user_id, created_at DESC);


-- ─── FUNCIÓN ───────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.guard_profile_privileges()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  -- Desde el SQL Editor no hay JWT de request: sos vos, se permite.
  if current_setting('request.jwt.claims', true) is null then
    return new;
  end if;

  if (new.role is distinct from old.role
      or new.is_approved is distinct from old.is_approved)
     and not exists (
       select 1 from public.profiles p
        where p.id = auth.uid() and p.role = 'superadmin'
     )
  then
    raise exception 'Solo un superadmin puede cambiar rol o aprobación.';
  end if;

  return new;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.handle_new_user()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  insert into public.profiles (id, email, display_name)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'display_name', split_part(new.email, '@', 1))
  )
  on conflict (id) do nothing;
  return new;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.is_admin()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select coalesce(
    (select role = 'superadmin' from public.profiles where id = auth.uid()),
    false
  );
$function$
;
CREATE OR REPLACE FUNCTION public.is_approved_user()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select exists (
    select 1 from public.profiles p
     where p.id = auth.uid() and p.is_approved
  );
$function$
;
CREATE OR REPLACE FUNCTION public.public_series(p_session uuid, p_buckets integer DEFAULT 500)
 RETURNS TABLE(t double precision, z double precision, n bigint)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  with s as (
    select m.elapsed_time::double precision as t,
           m.impedance::double precision    as z
    from public.measurements m
    join public.sessions ss on ss.id = m.session_id
    where m.session_id = p_session
      and ss.is_public
  ),
  lim as (
    select min(t) as lo, max(t) as hi, count(*) as n from s
  ),
  g as (
    select s.t, s.z,
           width_bucket(s.t, lim.lo, lim.hi + 1e-6, greatest(p_buckets, 1)) as b
    from s, lim
    where lim.hi > lim.lo
  ),
  bajos as (select distinct on (b) b, t, z from g order by b, z asc,  t asc),
  altos as (select distinct on (b) b, t, z from g order by b, z desc, t asc),
  -- La primera y la última muestra van siempre: de ellas salen la duración,
  -- la basal y el valor final que se muestran en la ficha.
  extremos as (
    (select t, z from s order by t asc  limit 1)
    union all
    (select t, z from s order by t desc limit 1)
  )
  select u.t, u.z, (select lim.n from lim) as n
  from (
    select t, z from bajos
    union
    select t, z from altos
    union
    select t, z from extremos
  ) u
  order by u.t;
$function$
;
CREATE OR REPLACE FUNCTION public.set_calibration_id()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare cal_id smallint;
begin
  -- 1 · si el equipo reporto su K_CAL, buscar la calibracion que coincide.
  --     Tolerancia relativa del 0,1 %: el firmware manda 5 decimales.
  if new.k_cal_firmware is not null then
    select c.id into cal_id
      from public.calibrations c
     where abs(c.k_cal - new.k_cal_firmware) <= 0.001 * new.k_cal_firmware
     order by abs(c.k_cal - new.k_cal_firmware)
     limit 1;
  end if;

  if cal_id is not null then
    new.calibration_matched := true;
  else
    -- 2 · sin reporte o sin coincidencia cae a la referencia, PERO queda
    --     marcado: la etiqueta es una suposicion y tiene que poder verse.
    select id into cal_id from public.calibrations where is_reference;
    new.calibration_matched := false;
  end if;

  if new.calibration_id is null then
    new.calibration_id := cal_id;
  end if;
  -- la placa se supone la que el firmware dice, salvo que el catalogo diga
  -- otra (hw_id). Placa modificada sin reflashear: LISTA de la 3b.
  if new.calibration_hw_id is null then
    select coalesce(c.hw_id, c.id) into new.calibration_hw_id
      from public.calibrations c where c.id = new.calibration_id;
  end if;
  return new;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.set_session_number()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if new.patient_id is not null and new.session_number is null then
    -- Turno por paciente: dura hasta el fin de la transacción que guarda.
    perform pg_advisory_xact_lock(hashtextextended('chidori.session_number:' || new.patient_id::text, 0));
    select coalesce(max(session_number), 0) + 1
      into new.session_number
      from public.sessions
     where patient_id = new.patient_id;
  end if;
  return new;
end;
$function$
;


-- ─── VISTA ─────────────────────────────────────────────────────────────

create or replace view public.public_field_definitions as
 SELECT id,
    scope,
    key,
    label,
    type,
    unit,
    sort_order
   FROM field_definitions f
  WHERE active;
create or replace view public.public_measurements as
 SELECT m.session_id,
    m.elapsed_time,
    m.impedance
   FROM measurements m
     JOIN sessions s ON s.id = m.session_id
  WHERE s.is_public;
create or replace view public.public_session_events as
 SELECT e.session_id,
    e.event_number,
    e.elapsed_time,
    e.impedance,
    e.impedance_change,
    e.kind,
    e.amount_ml
   FROM session_events e
     JOIN sessions s ON s.id = e.session_id
  WHERE s.is_public;
create or replace view public.public_sessions as
 SELECT s.id,
    s.session_number,
    s.created_at AS recorded_at,
    s.initial_impedance,
    s.final_impedance,
    s.elapsed_time_str,
    s.total_events,
    s.is_featured,
    COALESCE(p.code, '—'::text) AS subject_code,
    ( SELECT COALESCE(jsonb_object_agg(f.key, s.session_data -> f.key), '{}'::jsonb) AS "coalesce"
           FROM field_definitions f
          WHERE f.scope = 'session'::text AND f.active AND jsonb_exists(COALESCE(s.session_data, '{}'::jsonb), f.key)) AS session_data,
    ( SELECT COALESCE(jsonb_object_agg(f.key, p.data -> f.key), '{}'::jsonb) AS "coalesce"
           FROM field_definitions f
          WHERE f.scope = 'patient'::text AND f.active AND jsonb_exists(COALESCE(p.data, '{}'::jsonb), f.key)) AS subject_data
   FROM sessions s
     LEFT JOIN patients p ON p.id = s.patient_id
  WHERE s.is_public;
create or replace view public.v_dataset with (security_invoker=true) as
 SELECT s.id AS session_id,
    p.code AS paciente,
    s.session_number AS nro_sesion,
    s.created_at AS fecha,
    p.data AS datos_paciente,
    s.session_data AS datos_sesion,
    s.initial_impedance AS z_inicial,
    s.final_impedance AS z_final,
    s.elapsed_time_str AS duracion,
    s.total_events AS eventos,
    s.notes AS notas,
    ( SELECT count(*) AS count
           FROM session_events e
          WHERE e.session_id = s.id AND e.kind = 'gap'::text) AS microcortes,
    ( SELECT COALESCE(sum(e.amount_ml), 0::numeric) AS "coalesce"
           FROM session_events e
          WHERE e.session_id = s.id AND e.kind = 'water'::text) AS agua_eventos_ml,
    ( SELECT COALESCE(sum(e.amount_ml), 0::numeric) AS "coalesce"
           FROM session_events e
          WHERE e.session_id = s.id AND e.kind = 'void'::text) AS miccion_ml
   FROM sessions s
     LEFT JOIN patients p ON p.id = s.patient_id
  ORDER BY p.code, s.session_number;
create or replace view public.v_dataset_modelo with (security_invoker=true) as
 WITH muestras AS (
         SELECT measurements.session_id,
            count(*) AS n_muestras,
            max(measurements.elapsed_time) AS t_ultima_muestra_s
           FROM measurements
          GROUP BY measurements.session_id
        ), eventos AS (
         SELECT session_events.session_id,
            count(*) FILTER (WHERE session_events.kind = 'mark'::text) AS marcas,
            count(*) FILTER (WHERE session_events.kind = 'water'::text) AS tomas_agua,
            COALESCE(sum(session_events.amount_ml) FILTER (WHERE session_events.kind = 'water'::text), 0::numeric) AS agua_ml,
            count(*) FILTER (WHERE session_events.kind = 'void'::text) AS micciones,
            COALESCE(sum(session_events.amount_ml) FILTER (WHERE session_events.kind = 'void'::text), 0::numeric) AS miccion_ml,
            count(*) FILTER (WHERE session_events.kind = 'gap'::text) AS microcortes,
            COALESCE(sum(session_events.impedance_change) FILTER (WHERE session_events.kind = 'gap'::text), 0::double precision) AS segundos_perdidos,
            count(*) FILTER (WHERE session_events.kind = 'disconnect'::text) AS desconexiones
           FROM session_events
          GROUP BY session_events.session_id
        )
 SELECT s.id AS session_id,
    p.code AS paciente,
    s.session_number AS nro_sesion,
    s.created_at AS fecha,
    COALESCE(p.data, '{}'::jsonb) AS datos_paciente,
    COALESCE(s.session_data, '{}'::jsonb) AS datos_sesion,
    s.initial_impedance AS z_inicial,
    s.final_impedance AS z_final,
    round((s.final_impedance - s.initial_impedance)::numeric, 4) AS delta_z,
    s.initial_impedance_raw AS z_inicial_raw,
    s.final_impedance_raw AS z_final_raw,
    s.calibration_id AS cal_firmware,
    s.calibration_hw_id AS cal_placa,
    h.label AS placa,
    s.calibration_shown AS cal_mostrada,
    s.calibration_matched AS cal_confirmada,
    s.k_cal_firmware,
    s.adc_lineal_asumido,
    s.elapsed_time_str AS duracion,
    COALESCE(m.n_muestras, 0::bigint) AS n_muestras,
    m.t_ultima_muestra_s,
    s.notes AS notas,
    COALESCE(e.marcas, 0::bigint) AS marcas,
    COALESCE(e.tomas_agua, 0::bigint) AS tomas_agua,
    COALESCE(e.agua_ml, 0::numeric) AS agua_ml,
    COALESCE(e.micciones, 0::bigint) AS micciones,
    COALESCE(e.miccion_ml, 0::numeric) AS miccion_ml,
    COALESCE(e.microcortes, 0::bigint) AS microcortes,
    COALESCE(e.segundos_perdidos, 0::double precision) AS segundos_perdidos,
    COALESCE(e.desconexiones, 0::bigint) AS desconexiones
   FROM sessions s
     LEFT JOIN patients p ON p.id = s.patient_id
     LEFT JOIN calibrations h ON h.id = s.calibration_hw_id
     LEFT JOIN muestras m ON m.session_id = s.id
     LEFT JOIN eventos e ON e.session_id = s.id
  ORDER BY p.code, s.session_number, s.created_at;
create or replace view public.v_dataset_sesiones with (security_invoker=true) as
 SELECT s.id AS session_id,
    s.session_code,
    sub.code AS subject_code,
    sub.sex,
    sub.birth_year,
    sub.height_m,
    COALESCE(s.patient_weight, sub.weight_kg::double precision) AS weight_kg,
    COALESCE(s.patient_iliac_circ, sub.iliac_circ_cm::double precision) AS iliac_circ_cm,
    s.temperature_c,
    s.humidity_pct,
    s.food_24h,
    s.water_total_ml,
    s.initial_impedance,
    s.final_impedance,
    round((s.final_impedance - s.initial_impedance)::numeric, 4) AS delta_impedance,
    s.initial_impedance_raw,
    s.final_impedance_raw,
    s.calibration_id,
    s.calibration_shown,
    s.calibration_hw_id,
    s.calibration_matched,
    s.k_cal_firmware,
    s.adc_lineal_asumido,
    s.elapsed_time_str,
    s.total_events,
    s.notes,
    s.created_at,
    ( SELECT count(*) AS count
           FROM session_events e
          WHERE e.session_id = s.id AND e.kind = 'gap'::text) AS microcortes,
    ( SELECT count(*) AS count
           FROM session_events e
          WHERE e.session_id = s.id AND e.kind = 'water'::text) AS tomas_agua,
    ( SELECT count(*) AS count
           FROM session_events e
          WHERE e.session_id = s.id AND e.kind = 'void'::text) AS micciones
   FROM sessions s
     LEFT JOIN subjects sub ON sub.id = s.subject_id;


-- ─── TRIGGER ───────────────────────────────────────────────────────────

CREATE TRIGGER trg_guard_profile_privileges BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION guard_profile_privileges();
CREATE TRIGGER trg_calibration_id BEFORE INSERT ON public.sessions FOR EACH ROW EXECUTE FUNCTION set_calibration_id();
CREATE TRIGGER trg_session_number BEFORE INSERT ON public.sessions FOR EACH ROW EXECUTE FUNCTION set_session_number();
CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION handle_new_user();


-- ─── RLS ───────────────────────────────────────────────────────────────

alter table public.calibrations enable row level security;
alter table public.field_definitions enable row level security;
alter table public.measurements enable row level security;
alter table public.patients enable row level security;
alter table public.profiles enable row level security;
alter table public.session_events enable row level security;
alter table public.sessions enable row level security;
alter table public.subjects enable row level security;


-- ─── POLÍTICA ──────────────────────────────────────────────────────────

create policy calibrations_select on public.calibrations as permissive for SELECT to authenticated
  using (true);
create policy calibrations_write on public.calibrations as permissive for ALL to authenticated
  using ((EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = auth.uid()) AND (p.role = 'superadmin'::text)))))
  with check ((EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = auth.uid()) AND (p.role = 'superadmin'::text)))));
create policy fields_select on public.field_definitions as permissive for SELECT to authenticated
  using (is_approved_user());
create policy fields_write on public.field_definitions as permissive for ALL to authenticated
  using ((EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = auth.uid()) AND (p.role = 'superadmin'::text)))))
  with check ((EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = auth.uid()) AND (p.role = 'superadmin'::text)))));
create policy "measurements admin all" on public.measurements as permissive for ALL to authenticated
  using (is_admin())
  with check (is_admin());
create policy "measurements owner all" on public.measurements as permissive for ALL to authenticated
  using ((EXISTS ( SELECT 1
   FROM sessions s
  WHERE ((s.id = measurements.session_id) AND (s.user_id = auth.uid())))))
  with check ((EXISTS ( SELECT 1
   FROM sessions s
  WHERE ((s.id = measurements.session_id) AND (s.user_id = auth.uid())))));
create policy patients_insert on public.patients as permissive for INSERT to authenticated
  with check (is_approved_user());
create policy patients_select on public.patients as permissive for SELECT to authenticated
  using (is_approved_user());
create policy patients_update on public.patients as permissive for UPDATE to authenticated
  using (is_approved_user())
  with check (is_approved_user());
create policy "profiles admin all" on public.profiles as permissive for ALL to authenticated
  using (is_admin())
  with check (is_admin());
create policy "profiles self read" on public.profiles as permissive for SELECT to authenticated
  using (((id = auth.uid()) OR is_admin()));
create policy "profiles self update" on public.profiles as permissive for UPDATE to authenticated
  using ((id = auth.uid()))
  with check (((id = auth.uid()) AND (role = ( SELECT profiles_1.role
   FROM profiles profiles_1
  WHERE (profiles_1.id = auth.uid())))));
create policy "events admin all" on public.session_events as permissive for ALL to authenticated
  using (is_admin())
  with check (is_admin());
create policy "events owner all" on public.session_events as permissive for ALL to authenticated
  using ((EXISTS ( SELECT 1
   FROM sessions s
  WHERE ((s.id = session_events.session_id) AND (s.user_id = auth.uid())))))
  with check ((EXISTS ( SELECT 1
   FROM sessions s
  WHERE ((s.id = session_events.session_id) AND (s.user_id = auth.uid())))));
create policy "sessions admin all" on public.sessions as permissive for ALL to authenticated
  using (is_admin())
  with check (is_admin());
create policy "sessions owner all" on public.sessions as permissive for ALL to authenticated
  using ((user_id = auth.uid()))
  with check ((user_id = auth.uid()));
create policy sessions_publish on public.sessions as permissive for UPDATE to authenticated
  using ((EXISTS ( SELECT 1
   FROM profiles pr
  WHERE ((pr.id = auth.uid()) AND (pr.role = 'superadmin'::text)))))
  with check ((EXISTS ( SELECT 1
   FROM profiles pr
  WHERE ((pr.id = auth.uid()) AND (pr.role = 'superadmin'::text)))));
create policy subjects_insert on public.subjects as permissive for INSERT to authenticated
  with check (true);
create policy subjects_select on public.subjects as permissive for SELECT to authenticated
  using (true);
create policy subjects_update on public.subjects as permissive for UPDATE to authenticated
  using (true);


-- ─── PERMISO ───────────────────────────────────────────────────────────

revoke all on public.calibrations from anon, authenticated;
grant delete, insert, references, select, trigger, truncate, update on public.calibrations to anon;
grant delete, insert, references, select, trigger, truncate, update on public.calibrations to authenticated;
revoke all on public.field_definitions from anon, authenticated;
grant delete, insert, references, select, trigger, truncate, update on public.field_definitions to anon;
grant delete, insert, references, select, trigger, truncate, update on public.field_definitions to authenticated;
revoke all on public.measurements from anon, authenticated;
grant delete, insert, references, select, trigger, truncate, update on public.measurements to anon;
grant delete, insert, references, select, trigger, truncate, update on public.measurements to authenticated;
revoke all on public.patients from anon, authenticated;
grant delete, insert, references, select, trigger, truncate, update on public.patients to anon;
grant delete, insert, references, select, trigger, truncate, update on public.patients to authenticated;
revoke all on public.profiles from anon, authenticated;
grant delete, insert, references, select, trigger, truncate, update on public.profiles to anon;
grant delete, insert, references, select, trigger, truncate, update on public.profiles to authenticated;
revoke all on public.public_field_definitions from anon, authenticated;
grant select on public.public_field_definitions to anon;
grant select on public.public_field_definitions to authenticated;
revoke all on public.public_measurements from anon, authenticated;
grant select on public.public_measurements to anon;
grant select on public.public_measurements to authenticated;
revoke all on public.public_session_events from anon, authenticated;
grant select on public.public_session_events to anon;
grant select on public.public_session_events to authenticated;
revoke all on public.public_sessions from anon, authenticated;
grant select on public.public_sessions to anon;
grant select on public.public_sessions to authenticated;
revoke all on public.session_events from anon, authenticated;
grant delete, insert, references, select, trigger, truncate, update on public.session_events to anon;
grant delete, insert, references, select, trigger, truncate, update on public.session_events to authenticated;
revoke all on public.sessions from anon, authenticated;
grant delete, insert, references, select, trigger, truncate, update on public.sessions to anon;
grant delete, insert, references, select, trigger, truncate, update on public.sessions to authenticated;
revoke all on public.subjects from anon, authenticated;
revoke all on public.v_dataset from anon, authenticated;
grant select on public.v_dataset to authenticated;
revoke all on public.v_dataset_modelo from anon, authenticated;
grant select on public.v_dataset_modelo to authenticated;
revoke all on public.v_dataset_sesiones from anon, authenticated;
grant select on public.v_dataset_sesiones to authenticated;


-- ─── PERMISO FUNCIÓN ───────────────────────────────────────────────────

revoke all on function public.guard_profile_privileges() from anon, authenticated;
grant execute on function public.guard_profile_privileges() to anon;
grant execute on function public.guard_profile_privileges() to authenticated;
revoke all on function public.handle_new_user() from anon, authenticated;
grant execute on function public.handle_new_user() to anon;
grant execute on function public.handle_new_user() to authenticated;
revoke all on function public.is_admin() from anon, authenticated;
grant execute on function public.is_admin() to anon;
grant execute on function public.is_admin() to authenticated;
revoke all on function public.is_approved_user() from anon, authenticated;
grant execute on function public.is_approved_user() to anon;
grant execute on function public.is_approved_user() to authenticated;
revoke all on function public.public_series(p_session uuid, p_buckets integer) from anon, authenticated;
grant execute on function public.public_series(p_session uuid, p_buckets integer) to anon;
grant execute on function public.public_series(p_session uuid, p_buckets integer) to authenticated;
revoke all on function public.set_calibration_id() from anon, authenticated;
grant execute on function public.set_calibration_id() to anon;
grant execute on function public.set_calibration_id() to authenticated;
revoke all on function public.set_session_number() from anon, authenticated;
grant execute on function public.set_session_number() to anon;
grant execute on function public.set_session_number() to authenticated;


-- ─── COMENTARIO ────────────────────────────────────────────────────────

comment on view public.v_dataset_modelo is 'Una fila por sesion con paciente, campos (JSONB), impedancias en la escala de la placa, banderas de calibracion y resumen de eventos. Para exportar el dataset del modelo. Respeta RLS.';
comment on column public.calibrations.hw_id is 'Si el firmware reporto esta calibracion, la placa real es esta otra. Null = la misma. Ej: 4 (firmware R9 1,1k) -> 5 (placa R9 1,2k).';
comment on column public.measurements.impedance_raw is 'Impedancia tal como la mando el equipo, en la escala de sessions.calibration_id. NUNCA se pisa: toda recalibracion se calcula desde aca.';
comment on column public.measurements.voltage_v is 'Continua medida en A0 del ESP32, en volts, antes de convertir a impedancia. Es el dato fisico, contrastable con tester. Vadc ~0 = senal nula.';
comment on column public.sessions.adc_lineal_asumido is 'true = firmware anterior a v1.6.0 (2026-08-03): el ADC se leia como lineal y el del ESP32-C3 no lo es. La conversion de escala para estas sesiones es APROXIMADA.';
comment on column public.sessions.calibration_hw_id is 'Calibracion que describe la PLACA con la que se midio (hardware real). Normalmente igual a calibration_id; distinta cuando se modifico la placa y no se actualizo el firmware. Las columnas de impedancia quedan en esta escala.';
comment on column public.sessions.calibration_id is 'Constantes con las que el FIRMWARE calculo Z al medir esta sesion. Hecho historico: no cambia nunca. El hardware real va en calibration_hw_id.';
comment on column public.sessions.calibration_matched is 'true = calibration_id salio de matchear k_cal_firmware contra el catalogo. false = el firmware no lo reporto (anterior a 1.8.0) o no coincidio con ninguna, y la etiqueta es una SUPOSICION.';
comment on column public.sessions.calibration_shown is 'Escala en la que estan HOY las columnas de impedancia de esta sesion.';
comment on column public.sessions.k_cal_firmware is 'K_CAL que reporto el equipo en el STATUS al momento de medir. Es el dato duro de con que constante se calculo esta sesion.';
