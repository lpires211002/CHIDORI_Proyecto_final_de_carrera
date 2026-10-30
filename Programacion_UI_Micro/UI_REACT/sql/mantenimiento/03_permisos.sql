-- ═══════════════════════════════════════════════════════════════════════
--  CHIDORI · Mantenimiento · PASO 3 · Cerrar permisos
--
--  Solo cambia PERMISOS. No toca ni una fila de datos, no borra tablas ni
--  vistas, no cambia lo que muestran.
--
--  Qué corrige (hallazgos del diagnóstico del 10/10/2026):
--    1. Las seis vistas aceptaban escritura con la clave pública (anon):
--       a través de una vista que corre con los permisos de su dueño se
--       podía modificar o borrar datos salteando RLS. Quedan de SOLO LECTURA.
--    2. v_dataset y v_dataset_sesiones (el dataset completo, con códigos de
--       paciente, sexo, año de nacimiento y notas) se leían con la clave
--       pública. Se le quita el acceso a anon, y para las cuentas logueadas
--       pasan a respetar RLS (security_invoker): el admin ve todo, cada
--       clínico solo sus sesiones.
--    3. `subjects` (tabla sin uso, 0 filas) aceptaba lectura y escritura de
--       cualquier cuenta. Se cierra. No se borra.
--    4. Los respaldos del 04/09 (bkp_20260904_*) ya estaban cerrados por RLS;
--       se les quitan también los permisos, por las dudas.
--
--  Qué NO cambia:
--    · La web pública sigue leyendo sus cuatro vistas public_* y la función
--      public_series: lectura intacta.
--    · El /admin de la web sigue publicando sesiones (policy sessions_publish
--      sobre la tabla, no sobre las vistas).
--    · La app de escritorio no usa ninguna de estas vistas.
--
--  Va en una sola transacción. Si algo falla, no se aplica nada.
--  Al final muestra una tabla con cómo quedó cada objeto.
--
--  DESHACER (solo si algo dejara de andar): ver el bloque al final.
-- ═══════════════════════════════════════════════════════════════════════

begin;

do $$
declare
  v text;
  vistas    text[] := array['public_sessions', 'public_measurements', 'public_session_events',
                            'public_field_definitions', 'v_dataset', 'v_dataset_sesiones'];
  dataset   text[] := array['v_dataset', 'v_dataset_sesiones'];
  cerradas  text[] := array['subjects', 'bkp_20260904_sessions', 'bkp_20260904_measurements',
                            'bkp_20260904_session_events'];
begin
  -- 1 · vistas de solo lectura
  foreach v in array vistas loop
    if to_regclass('public.' || v) is not null then
      execute format('revoke insert, update, delete, truncate, references, trigger on public.%I from anon, authenticated', v);
    end if;
  end loop;

  -- 2 · dataset fuera de la clave pública; para cuentas logueadas, con RLS
  foreach v in array dataset loop
    if to_regclass('public.' || v) is not null then
      execute format('revoke all on public.%I from anon', v);
      if current_setting('server_version_num')::int >= 150000 then
        execute format('alter view public.%I set (security_invoker = true)', v);
      else
        -- Postgres anterior a 15 no tiene security_invoker: se cierra del todo
        execute format('revoke all on public.%I from authenticated', v);
      end if;
    end if;
  end loop;

  -- 3 y 4 · tablas sin uso y respaldos viejos
  foreach v in array cerradas loop
    if to_regclass('public.' || v) is not null then
      execute format('revoke all on public.%I from anon, authenticated', v);
    end if;
  end loop;
end $$;

commit;

-- ── Cómo quedó ─────────────────────────────────────────────────────────
select c.relname as objeto,
       case c.relkind when 'v' then 'vista' else 'tabla' end as tipo,
       coalesce((select string_agg(g.privilege_type, ',' order by g.privilege_type)
                   from information_schema.role_table_grants g
                  where g.table_schema = 'public' and g.table_name = c.relname and g.grantee = 'anon'), 'ninguno') as clave_publica_anon,
       coalesce((select string_agg(g.privilege_type, ',' order by g.privilege_type)
                   from information_schema.role_table_grants g
                  where g.table_schema = 'public' and g.table_name = c.relname and g.grantee = 'authenticated'), 'ninguno') as cuentas_logueadas,
       case when c.relkind = 'v' then
         case when coalesce(array_to_string(c.reloptions, ','), '') like '%security_invoker=true%'
              then 'respeta RLS' else 'permisos del dueño' end
       else '' end as modo
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
 where n.nspname = 'public'
   and c.relname in ('public_sessions', 'public_measurements', 'public_session_events',
                     'public_field_definitions', 'v_dataset', 'v_dataset_sesiones',
                     'subjects', 'bkp_20260904_sessions', 'bkp_20260904_measurements',
                     'bkp_20260904_session_events')
 order by tipo desc, objeto;


-- ═══════════════════════════════════════════════════════════════════════
--  DESHACER · solo si después de esto algo dejara de andar
--  (vuelve exactamente al estado anterior, que era el inseguro):
--
--  grant all on public.public_sessions, public.public_measurements,
--               public.public_session_events, public.public_field_definitions,
--               public.v_dataset, public.v_dataset_sesiones,
--               public.subjects to anon, authenticated;
--  alter view public.v_dataset reset (security_invoker);
--  alter view public.v_dataset_sesiones reset (security_invoker);
-- ═══════════════════════════════════════════════════════════════════════
