-- ═══════════════════════════════════════════════════════════════════════
--  CHIDORI · Mantenimiento · PASO 1 · Diagnóstico (SOLO LECTURA)
--
--  No modifica nada: es una única consulta SELECT. Se puede correr las
--  veces que haga falta.
--
--  Cómo correrlo: Supabase → SQL Editor → pegar todo → Run.
--  El editor muestra una tabla de tres columnas (sección, objeto, detalle).
--  Bajala con "Download CSV" (o "Export → CSV") y pasásela a Claude.
--
--  Qué releva:
--    · tamaño de la base y de cada tabla, y cantidad de filas
--    · RLS activado o no en cada tabla
--    · todas las políticas de acceso (quién puede leer / escribir qué)
--    · permisos de anon y authenticated sobre tablas y vistas
--    · vistas (y si corren con los permisos del dueño o del que consulta)
--    · funciones y triggers
--    · columnas de `sessions`
--    · sesiones sin paciente y números de sesión repetidos
-- ═══════════════════════════════════════════════════════════════════════

with
tablas as (
  select c.oid, c.relname, c.relrowsecurity
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind in ('r', 'p')
),
filas as (
  select '01 base' as seccion, current_database()::text as objeto,
         pg_size_pretty(pg_database_size(current_database())) as detalle
  union all
  select '02 tabla', t.relname::text,
         pg_size_pretty(pg_total_relation_size(t.oid)) || ' · ' ||
         (xpath('/row/n/text()',
                query_to_xml(format('select count(*) as n from public.%I', t.relname), false, true, '')))[1]::text
         || ' filas · RLS ' || case when t.relrowsecurity then 'activado' else 'DESACTIVADO' end
    from tablas t
  union all
  select '03 política', (p.tablename || ' · ' || p.policyname)::text,
         p.cmd || ' · ' || case when p.permissive = 'PERMISSIVE' then 'permisiva' else 'restrictiva' end
         || ' · roles ' || array_to_string(p.roles, ',')
         || ' · using ' || regexp_replace(coalesce(p.qual, '—'), '\s+', ' ', 'g')
         || ' · check ' || regexp_replace(coalesce(p.with_check, '—'), '\s+', ' ', 'g')
    from pg_policies p
   where p.schemaname = 'public'
  union all
  select '04 permiso', (g.table_name || ' · ' || g.grantee)::text,
         string_agg(g.privilege_type, ',' order by g.privilege_type)
    from information_schema.role_table_grants g
   where g.table_schema = 'public' and g.grantee in ('anon', 'authenticated')
   group by g.table_name, g.grantee
  union all
  select '05 vista', c.relname::text,
         coalesce('opciones: ' || array_to_string(c.reloptions, ','),
                  'sin security_invoker: corre con los permisos del dueño (saltea RLS)')
         || ' · se puede escribir a través de ella: ' || coalesce(v.is_updatable, '?')
         || ' · insertar: ' || coalesce(v.is_insertable_into, '?')
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    left join information_schema.views v on v.table_schema = n.nspname and v.table_name = c.relname
   where n.nspname = 'public' and c.relkind in ('v', 'm')
  union all
  select '06 función', p.proname::text,
         case when p.prosecdef then 'security definer' else 'security invoker' end
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
  union all
  select '07 trigger', (t.event_object_schema || '.' || t.event_object_table || ' · ' || t.trigger_name)::text,
         t.action_timing || ' ' || string_agg(t.event_manipulation, '/' order by t.event_manipulation)
         || ' · ' || max(t.action_statement)
    from information_schema.triggers t
   where t.event_object_schema in ('public', 'auth')
   group by t.event_object_schema, t.event_object_table, t.trigger_name, t.action_timing
  union all
  select '08 columnas', 'sessions',
         count(*)::text || ': ' || string_agg(c.column_name, ', ' order by c.ordinal_position)
    from information_schema.columns c
   where c.table_schema = 'public' and c.table_name = 'sessions'
  union all
  select '09 control', 'sesiones sin paciente',
         (select count(*) from public.sessions where patient_id is null)::text
  union all
  select '09 control', 'pacientes',
         (select count(*) from public.patients)::text || ' (activos: ' ||
         (select count(*) from public.patients where active)::text || ')'
  union all
  select '10 duplicado', (p.code || ' · sesión ' || s.session_number)::text,
         count(*)::text || ' sesiones con el mismo número'
    from public.sessions s
    join public.patients p on p.id = s.patient_id
   where s.session_number is not null
   group by p.code, s.session_number
  having count(*) > 1
)
select * from filas
order by seccion, objeto;
