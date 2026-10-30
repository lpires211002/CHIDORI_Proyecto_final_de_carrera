-- ═══════════════════════════════════════════════════════════════════════
--  CHIDORI · Mantenimiento · PASO 2 · Respaldo completo dentro de la base
--
--  Copia TODAS las tablas con datos a un esquema aparte, `respaldo`, con la
--  fecha y hora en el nombre (p. ej. respaldo.measurements_20261010_1915).
--
--  · Solo AGREGA: no modifica ni borra nada de lo que existe.
--  · El esquema `respaldo` no lo expone la API de Supabase (solo expone
--    `public`) y además se le quitan los permisos a anon y authenticated:
--    ni la app ni la web ni la clave pública pueden leerlo.
--  · Va todo en una transacción: o se copia todo, o no se copia nada.
--  · Correrlo de nuevo crea OTRO juego de copias con otra hora (no pisa el
--    anterior). Ocupa ~30 MB por juego.
--
--  Al terminar muestra una tabla comparando filas originales contra filas
--  copiadas. Todas tienen que decir "OK".
--
--  Restaurar: ver la nota al final del archivo.
-- ═══════════════════════════════════════════════════════════════════════

begin;

create schema if not exists respaldo;
revoke all on schema respaldo from public, anon, authenticated;

create table if not exists respaldo.registro (
  sufijo  text primary key,
  creado  timestamptz not null default now(),
  tablas  text[] not null
);
revoke all on respaldo.registro from public, anon, authenticated;

do $$
declare
  sufijo text := to_char(now() at time zone 'America/Argentina/Buenos_Aires', 'YYYYMMDD_HH24MISS');
  tablas text[] := array['patients', 'sessions', 'measurements', 'session_events',
                         'profiles', 'field_definitions', 'calibrations'];
  t text;
  copia text;
begin
  foreach t in array tablas loop
    if to_regclass('public.' || t) is null then
      raise exception 'No existe public.%: no se copió nada.', t;
    end if;
    copia := t || '_' || sufijo;
    execute format('create table respaldo.%I as table public.%I', copia, t);
    execute format('alter table respaldo.%I enable row level security', copia);
    execute format('revoke all on respaldo.%I from public, anon, authenticated', copia);
  end loop;
  insert into respaldo.registro (sufijo, tablas) values (sufijo, tablas);
end $$;

commit;

-- ── Verificación · filas originales contra filas copiadas ──────────────
with ultimo as (
  select sufijo, tablas from respaldo.registro order by creado desc limit 1
)
select u.sufijo as respaldo,
       t        as tabla,
       (xpath('/row/n/text()', query_to_xml(format('select count(*) as n from public.%I', t), false, true, '')))[1]::text::bigint  as filas_original,
       (xpath('/row/n/text()', query_to_xml(format('select count(*) as n from respaldo.%I', t || '_' || u.sufijo), false, true, '')))[1]::text::bigint as filas_copia,
       case when (xpath('/row/n/text()', query_to_xml(format('select count(*) as n from public.%I', t), false, true, '')))[1]::text
               = (xpath('/row/n/text()', query_to_xml(format('select count(*) as n from respaldo.%I', t || '_' || u.sufijo), false, true, '')))[1]::text
            then 'OK' else 'DIFERENTE · avisar antes de seguir' end as estado
  from ultimo u, unnest(u.tablas) as t
 order by t;


-- ═══════════════════════════════════════════════════════════════════════
--  RESTAURAR · NO hay un script genérico a propósito.
--  Las tablas tienen claves foráneas con "on delete set null" y triggers
--  (p. ej. borrar pacientes deja las sesiones sin paciente). Restaurar mal
--  puede romper más de lo que arregla. Si algún paso sale mal, se arma el
--  script exacto para ese caso, se prueba en una copia y recién ahí se corre.
-- ═══════════════════════════════════════════════════════════════════════
