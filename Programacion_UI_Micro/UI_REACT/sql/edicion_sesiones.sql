-- ═══════════════════════════════════════════════════════════════════════
--  CHIDORI · Edición de sesiones guardadas (app 1.10.0)
--
--  Correr UNA vez en Supabase → SQL Editor → Run, ANTES de usar el editor
--  de curva. Se puede volver a correr: no borra ni pisa nada que exista.
--
--  ── QUÉ AGREGA ────────────────────────────────────────────────────────
--  Cuatro tablas nuevas. NO toca measurements, session_events ni sessions:
--  la sesión original queda tal cual, siempre.
--
--    session_edits        la edición de cada sesión (UNA por sesión): los
--                         parámetros, en la base de tiempo ORIGINAL, y el
--                         resumen ya calculado (basal, final, duración…)
--    measurements_edited  la serie editada, materializada. La app y el EDA
--                         leen esta misma serie: los dos ven lo mismo.
--    session_review       apta / no apta para el análisis, con un texto
--                         libre opcional. Sin fila = apta (el default).
--                         No depende de la edición: vale para cualquier
--                         sesión y sobrevive a "volver al original".
--    session_comments     comentarios anclados a un instante o a un tramo,
--                         en la base de tiempo ORIGINAL (sobreviven a
--                         "volver al original"). El comentario general de
--                         la sesión sigue siendo sessions.notes.
--
--  Y la función guardar_edicion_sesion(): activa una edición nueva, la
--  borra o guarda los comentarios, todo en una transacción.
--
--  ── QUIÉN PUEDE ───────────────────────────────────────────────────────
--  Ver y editar: el admin y el clínico dueño de la sesión, igual que con
--  measurements. La clave pública (anon) no tiene acceso a nada de esto.
--
--  ── CALIBRACIÓN ───────────────────────────────────────────────────────
--  La serie editada guarda también `impedance_raw` (en la escala del
--  firmware, como measurements). Cuando se corre de nuevo calibracion.sql,
--  su paso 4.d reescala las ediciones desde ahí, igual que las mediciones.
--
--  ── DESHACER ──────────────────────────────────────────────────────────
--  Ver el bloque al final. Borra solo lo de este archivo.
-- ═══════════════════════════════════════════════════════════════════════

begin;

-- ─── 0 · PRECONDICIONES ────────────────────────────────────────────────

do $$
begin
  if to_regclass('public.sessions') is null or to_regclass('public.measurements') is null then
    raise exception 'No encuentro sessions / measurements: ¿es la base de Chidori?';
  end if;
  if to_regprocedure('public.is_admin()') is null then
    raise exception 'Falta public.is_admin() (ver sql/esquema_base.sql).';
  end if;
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'measurements' and column_name = 'voltage_v') then
    raise exception 'Falta measurements.voltage_v: correr antes sql/calibracion.sql.';
  end if;
end $$;


-- ─── 1 · PERMISO ───────────────────────────────────────────────────────
-- Admin, o dueño de la sesión. SECURITY DEFINER para poder mirar `sessions`
-- sin depender de sus políticas; solo devuelve sí/no.

create or replace function public.puede_editar_sesion(p_session uuid)
returns boolean
language sql stable security definer
set search_path = public
as $$
  select public.is_admin()
      or exists (select 1 from public.sessions s
                  where s.id = p_session and s.user_id = auth.uid());
$$;

revoke all on function public.puede_editar_sesion(uuid) from public, anon;
grant execute on function public.puede_editar_sesion(uuid) to authenticated;


-- ─── 2 · TABLAS ────────────────────────────────────────────────────────

create table if not exists public.session_edits (
  session_id            uuid primary key references public.sessions(id) on delete cascade,
  version               uuid not null,             -- la de measurements_edited activa
  params                jsonb not null,            -- operaciones · tiempo ORIGINAL
  eventos               jsonb not null default '[]'::jsonb,   -- eventos editados · tiempo EDITADO
  stats                 jsonb not null default '{}'::jsonb,   -- ventanas, modos, n interpoladas…
  initial_impedance     double precision,          -- basal de la editada (escala mostrada)
  final_impedance       double precision,
  initial_impedance_raw double precision,          -- lo mismo en la escala del firmware
  final_impedance_raw   double precision,
  elapsed_time_str      text,
  total_events          integer,
  n_muestras            integer not null,
  n_interpoladas        integer not null default 0,
  t_cero                double precision not null default 0,  -- t original del nuevo 0
  escala                smallint references public.calibrations(id),  -- informativo
  algo_version          integer not null default 1,
  app_version           text,
  edited_by             uuid references auth.users(id) on delete set null,
  edited_at             timestamptz not null default now()
);

create table if not exists public.measurements_edited (
  session_id    uuid not null references public.sessions(id) on delete cascade,
  version       uuid not null,
  idx           integer not null,
  elapsed_time  double precision not null,          -- tiempo EDITADO (re-cerado)
  impedance     double precision not null,
  impedance_raw double precision,                   -- escala del firmware (lo llena la función)
  voltage_v     double precision,
  interpolated  boolean not null default false,
  primary key (session_id, version, idx)
);

create table if not exists public.session_review (
  session_id  uuid primary key references public.sessions(id) on delete cascade,
  apta        boolean not null default true,
  nota        text,
  updated_by  uuid references auth.users(id) on delete set null,
  updated_at  timestamptz not null default now()
);

create table if not exists public.session_comments (
  id          uuid primary key default gen_random_uuid(),
  session_id  uuid not null references public.sessions(id) on delete cascade,
  t_from      double precision not null,           -- tiempo ORIGINAL
  t_to        double precision,                    -- null = un instante
  body        text not null,
  created_by  uuid references auth.users(id) on delete set null default auth.uid(),
  created_at  timestamptz not null default now(),
  updated_by  uuid references auth.users(id) on delete set null,
  updated_at  timestamptz not null default now(),
  constraint session_comments_rango check (t_to is null or t_to >= t_from),
  constraint session_comments_texto check (length(btrim(body)) > 0)
);
create index if not exists session_comments_session_idx on public.session_comments (session_id, t_from);


-- ─── 3 · AUTORÍA ───────────────────────────────────────────────────────
-- Quién y cuándo lo escribe la base, no la app.

create or replace function public.sellar_autoria()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_by := coalesce(auth.uid(), new.updated_by);
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_review_autoria on public.session_review;
create trigger trg_review_autoria before insert or update on public.session_review
  for each row execute function public.sellar_autoria();
drop trigger if exists trg_comments_autoria on public.session_comments;
create trigger trg_comments_autoria before insert or update on public.session_comments
  for each row execute function public.sellar_autoria();


-- ─── 4 · RLS ───────────────────────────────────────────────────────────
-- Misma regla que measurements, con el (select …) de mantenimiento/07 para
-- que no se evalúe fila por fila.

alter table public.session_edits       enable row level security;
alter table public.measurements_edited enable row level security;
alter table public.session_review      enable row level security;
alter table public.session_comments    enable row level security;

drop policy if exists "edits admin u owner" on public.session_edits;
create policy "edits admin u owner" on public.session_edits
  for all to authenticated
  using ((select public.is_admin()) or exists (select 1 from public.sessions s
           where s.id = session_edits.session_id and s.user_id = (select auth.uid())))
  with check ((select public.is_admin()) or exists (select 1 from public.sessions s
           where s.id = session_edits.session_id and s.user_id = (select auth.uid())));

drop policy if exists "medited admin u owner" on public.measurements_edited;
create policy "medited admin u owner" on public.measurements_edited
  for all to authenticated
  using ((select public.is_admin()) or exists (select 1 from public.sessions s
           where s.id = measurements_edited.session_id and s.user_id = (select auth.uid())))
  with check ((select public.is_admin()) or exists (select 1 from public.sessions s
           where s.id = measurements_edited.session_id and s.user_id = (select auth.uid())));

drop policy if exists "review admin u owner" on public.session_review;
create policy "review admin u owner" on public.session_review
  for all to authenticated
  using ((select public.is_admin()) or exists (select 1 from public.sessions s
           where s.id = session_review.session_id and s.user_id = (select auth.uid())))
  with check ((select public.is_admin()) or exists (select 1 from public.sessions s
           where s.id = session_review.session_id and s.user_id = (select auth.uid())));

drop policy if exists "comments admin u owner" on public.session_comments;
create policy "comments admin u owner" on public.session_comments
  for all to authenticated
  using ((select public.is_admin()) or exists (select 1 from public.sessions s
           where s.id = session_comments.session_id and s.user_id = (select auth.uid())))
  with check ((select public.is_admin()) or exists (select 1 from public.sessions s
           where s.id = session_comments.session_id and s.user_id = (select auth.uid())));

revoke all on public.session_edits, public.measurements_edited,
              public.session_review, public.session_comments from anon, authenticated;
grant select, insert, update, delete on public.session_edits, public.measurements_edited,
              public.session_review, public.session_comments to authenticated;


-- ─── 5 · GUARDAR UNA EDICIÓN ───────────────────────────────────────────
-- La app sube primero la serie nueva a measurements_edited con una versión
-- nueva (en tandas de 1000) y después llama a esta función, que:
--
--   'activar'  controla que la serie llegó completa, le calcula la escala
--              del firmware, deja esa versión como LA edición y borra las
--              anteriores. Si la subida se cortó, no activa nada y la
--              edición vieja (o el original) sigue como estaba.
--   'borrar'   volver al original: borra la edición y su serie.
--   'mantener' no toca la edición (se usa para guardar solo comentarios).
--
-- Comentarios (opcional, en la misma transacción):
--   p_comentarios          los que se crean o cambian [{id, t_from, t_to, body}]
--   p_borrar_comentarios   ids de los que se borran
-- Se manda solo lo que cambió, no la lista entera: así un comentario que otra
-- persona agregó mientras el editor estaba abierto no se pierde.
--
-- Dos guardados a la vez de la misma sesión (dos pestañas, dos admins) se
-- ponen en fila con un lock por sesión: el segundo ve el resultado del
-- primero y nunca queda activa una versión sin muestras.
--
-- SECURITY INVOKER: corre con los permisos de quien la llama, así que RLS
-- se aplica a cada paso además del control explícito del principio.

drop function if exists public.guardar_edicion_sesion(uuid, text, jsonb, jsonb);

create or replace function public.guardar_edicion_sesion(
  p_session            uuid,
  p_accion             text,
  p_edicion            jsonb  default null,
  p_comentarios        jsonb  default null,
  p_borrar_comentarios uuid[] default null
)
returns jsonb
language plpgsql
set search_path = public
as $$
declare
  v_version uuid;
  v_n       integer;
  v_cnt     integer;
  kf double precision; vf double precision;
  kh double precision; vh double precision;
  v_escala  smallint;
  a double precision := 1;
  b double precision := 0;
begin
  if not public.puede_editar_sesion(p_session) then
    raise exception 'Sin permiso para editar esta sesión.' using errcode = '42501';
  end if;

  -- Un guardado por sesión a la vez (se libera al terminar la transacción)
  perform pg_advisory_xact_lock(hashtextextended('chidori.edicion:' || p_session::text, 0));

  if p_accion = 'activar' then
    v_version := (p_edicion ->> 'version')::uuid;
    v_n       := (p_edicion ->> 'n_muestras')::integer;
    if v_version is null or v_n is null or v_n < 2 then
      raise exception 'Edición incompleta: falta la versión o la cantidad de muestras.';
    end if;

    select count(*) into v_cnt
      from public.measurements_edited
     where session_id = p_session and version = v_version;
    if v_cnt <> v_n then
      -- 0 suele ser otro guardado de la misma sesión que terminó antes y
      -- limpió esta subida
      raise exception 'La serie editada llegó incompleta (% de % muestras). No se activó nada: si otra persona guardó esta sesión recién, volvé a abrirla.', v_cnt, v_n;
    end if;

    -- Escala en la que están HOY las impedancias de la sesión, y la del
    -- firmware. Misma relación que usa calibracion.sql (paso 4):
    --   Z_mostrada = Z_firmware · (K_f / K_h) + 2 (Vd_h − Vd_f) / K_h
    select f.k_cal, f.v_detector, h.k_cal, h.v_detector,
           coalesce(s.calibration_shown, s.calibration_id)
      into kf, vf, kh, vh, v_escala
      from public.sessions s
      left join public.calibrations f on f.id = s.calibration_id
      left join public.calibrations h on h.id = coalesce(s.calibration_shown, s.calibration_id)
     where s.id = p_session;
    if kf is not null and kh is not null and kh <> 0 and kf <> 0 then
      a := kf / kh;
      b := 2 * (vh - vf) / kh;
    end if;

    update public.measurements_edited
       set impedance_raw = (impedance - b) / a
     where session_id = p_session and version = v_version;

    insert into public.session_edits as e (
      session_id, version, params, eventos, stats,
      initial_impedance, final_impedance, initial_impedance_raw, final_impedance_raw,
      elapsed_time_str, total_events, n_muestras, n_interpoladas, t_cero,
      escala, algo_version, app_version, edited_by, edited_at)
    values (
      p_session, v_version,
      coalesce(p_edicion -> 'params', '{}'::jsonb),
      coalesce(p_edicion -> 'eventos', '[]'::jsonb),
      coalesce(p_edicion -> 'stats', '{}'::jsonb),
      (p_edicion ->> 'initial_impedance')::double precision,
      (p_edicion ->> 'final_impedance')::double precision,
      ((p_edicion ->> 'initial_impedance')::double precision - b) / a,
      ((p_edicion ->> 'final_impedance')::double precision - b) / a,
      p_edicion ->> 'elapsed_time_str',
      (p_edicion ->> 'total_events')::integer,
      v_n,
      coalesce((p_edicion ->> 'n_interpoladas')::integer, 0),
      coalesce((p_edicion ->> 't_cero')::double precision, 0),
      v_escala,
      coalesce((p_edicion ->> 'algo_version')::integer, 1),
      p_edicion ->> 'app_version',
      auth.uid(), now())
    on conflict (session_id) do update set
      version = excluded.version, params = excluded.params, eventos = excluded.eventos,
      stats = excluded.stats,
      initial_impedance = excluded.initial_impedance, final_impedance = excluded.final_impedance,
      initial_impedance_raw = excluded.initial_impedance_raw, final_impedance_raw = excluded.final_impedance_raw,
      elapsed_time_str = excluded.elapsed_time_str, total_events = excluded.total_events,
      n_muestras = excluded.n_muestras, n_interpoladas = excluded.n_interpoladas,
      t_cero = excluded.t_cero, escala = excluded.escala,
      algo_version = excluded.algo_version, app_version = excluded.app_version,
      edited_by = excluded.edited_by, edited_at = excluded.edited_at;

    -- Versiones viejas y restos de subidas que se cortaron
    delete from public.measurements_edited
     where session_id = p_session and version <> v_version;

    -- Control final: la versión activa tiene que seguir entera
    select count(*) into v_cnt
      from public.measurements_edited
     where session_id = p_session and version = v_version;
    if v_cnt <> v_n then
      raise exception 'La serie editada quedó incompleta (% de %). No se activó nada.', v_cnt, v_n;
    end if;

  elsif p_accion = 'borrar' then
    delete from public.session_edits       where session_id = p_session;
    delete from public.measurements_edited where session_id = p_session;

  elsif p_accion is distinct from 'mantener' then
    raise exception 'Acción desconocida: % (activar | borrar | mantener).', p_accion;
  end if;

  if p_borrar_comentarios is not null then
    delete from public.session_comments c
     where c.session_id = p_session
       and c.id = any (p_borrar_comentarios);
  end if;

  if p_comentarios is not null then
    if jsonb_typeof(p_comentarios) <> 'array' then
      raise exception 'p_comentarios tiene que ser una lista.';
    end if;

    insert into public.session_comments as c (id, session_id, t_from, t_to, body)
    select coalesce(nullif(x ->> 'id', '')::uuid, gen_random_uuid()),
           p_session,
           (x ->> 't_from')::double precision,
           nullif(x ->> 't_to', '')::double precision,
           btrim(x ->> 'body')
      from jsonb_array_elements(p_comentarios) x
     where length(btrim(coalesce(x ->> 'body', ''))) > 0
    on conflict (id) do update set
      t_from = excluded.t_from, t_to = excluded.t_to, body = excluded.body
     where c.session_id = p_session
       and (c.t_from, c.t_to, c.body) is distinct from (excluded.t_from, excluded.t_to, excluded.body);
  end if;

  return jsonb_build_object('ok', true, 'accion', p_accion, 'version', v_version);
end;
$$;

revoke all on function public.guardar_edicion_sesion(uuid, text, jsonb, jsonb, uuid[]) from public, anon;
grant execute on function public.guardar_edicion_sesion(uuid, text, jsonb, jsonb, uuid[]) to authenticated;


-- ─── 6 · COMENTARIOS DE LAS COLUMNAS ───────────────────────────────────

comment on table public.session_edits is
  'Edicion (una por sesion) de una sesion guardada. La original no se toca: measurements y session_events quedan iguales. params esta en la base de tiempo ORIGINAL; eventos y la serie, en la EDITADA (re-cerada en t_cero).';
comment on table public.measurements_edited is
  'Serie editada materializada. Solo vale la fila de session_edits.version; las demas son restos que se borran al activar.';
comment on column public.measurements_edited.impedance_raw is
  'Z editada en la escala del firmware (calibration_id). Desde aca reescala calibracion.sql (paso 4.d).';
comment on column public.measurements_edited.interpolated is
  'true = la muestra estaba en un tramo sacado y su Z/Vadc salen de la interpolacion PCHIP. Cuenta para los calculos.';
comment on table public.session_review is
  'Apta o no apta para el analisis, con nota opcional. Sin fila = apta. Manda sobre etiquetas_manuales.csv del EDA.';
comment on table public.session_comments is
  'Comentarios anclados a un instante (t_to null) o a un tramo, en la base de tiempo ORIGINAL de la sesion.';


-- ─── 7 · CONTROL ───────────────────────────────────────────────────────

select c.relname as tabla,
       c.relrowsecurity as rls,
       (select count(*) from pg_policies p where p.schemaname = 'public' and p.tablename = c.relname) as politicas
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public'
 where c.relname in ('session_edits', 'measurements_edited', 'session_review', 'session_comments')
 order by 1;

commit;


-- ═══════════════════════════════════════════════════════════════════════
--  DESHACER · borra SOLO lo de este archivo (ediciones, apta/no apta y
--  comentarios anclados). Las sesiones y mediciones originales no se tocan.
-- ═══════════════════════════════════════════════════════════════════════
--
--   drop function if exists public.guardar_edicion_sesion(uuid, text, jsonb, jsonb, uuid[]);
--   drop table if exists public.measurements_edited;
--   drop table if exists public.session_edits;
--   drop table if exists public.session_comments;
--   drop table if exists public.session_review;
--   drop function if exists public.sellar_autoria();
--   drop function if exists public.puede_editar_sesion(uuid);
