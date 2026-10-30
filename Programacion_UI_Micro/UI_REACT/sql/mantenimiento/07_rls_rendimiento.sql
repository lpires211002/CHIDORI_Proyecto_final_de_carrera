-- ═══════════════════════════════════════════════════════════════════════
--  CHIDORI · Mantenimiento · PASO 7 · RLS que no se evalúe fila por fila
--
--  Síntoma: `v_dataset_modelo` desde la API (extraer.py) corta con
--  57014 "canceling statement due to statement timeout".
--
--  Causa: la vista cuenta todas las filas de `measurements` y, como es
--  security_invoker, aplica RLS a cada muestra. Las políticas llamaban a
--  is_admin() y auth.uid() "sueltas", y Postgres las re-evalúa por fila.
--  Envueltas en (select …) se calculan una sola vez por consulta.
--
--  · No cambia QUIÉN ve qué: mismas condiciones, solo envueltas.
--  · Se puede correr de nuevo (alter policy).
-- ═══════════════════════════════════════════════════════════════════════

alter policy "measurements admin all" on public.measurements
  using ((select public.is_admin()))
  with check ((select public.is_admin()));
alter policy "measurements owner all" on public.measurements
  using (exists (select 1 from public.sessions s
                  where s.id = measurements.session_id and s.user_id = (select auth.uid())))
  with check (exists (select 1 from public.sessions s
                       where s.id = measurements.session_id and s.user_id = (select auth.uid())));

alter policy "events admin all" on public.session_events
  using ((select public.is_admin()))
  with check ((select public.is_admin()));
alter policy "events owner all" on public.session_events
  using (exists (select 1 from public.sessions s
                  where s.id = session_events.session_id and s.user_id = (select auth.uid())))
  with check (exists (select 1 from public.sessions s
                       where s.id = session_events.session_id and s.user_id = (select auth.uid())));

alter policy "sessions admin all" on public.sessions
  using ((select public.is_admin()))
  with check ((select public.is_admin()));
alter policy "sessions owner all" on public.sessions
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- ── Control ────────────────────────────────────────────────────────────
select tablename, policyname, qual
  from pg_policies
 where schemaname = 'public'
   and tablename in ('measurements', 'session_events', 'sessions')
 order by tablename, policyname;
