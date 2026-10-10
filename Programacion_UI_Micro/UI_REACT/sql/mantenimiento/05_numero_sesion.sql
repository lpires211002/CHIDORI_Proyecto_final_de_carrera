-- ═══════════════════════════════════════════════════════════════════════
--  CHIDORI · Mantenimiento · PASO 5 · Número de sesión sin repetidos
--
--  Hoy el trigger numera cada sesión como "el máximo del paciente + 1", sin
--  ninguna traba: si se guardan dos sesiones del mismo paciente al mismo
--  tiempo (p. ej. la cola offline subiendo mientras se guarda otra), las dos
--  pueden sacar el mismo número. No pasó nunca (el diagnóstico no encontró
--  repetidos), pero nada lo impedía.
--
--  Qué cambia:
--    1. El trigger toma un turno por paciente antes de calcular el número:
--       el segundo guardado espera al primero y saca el número siguiente.
--    2. Un índice único (paciente, número) hace que la base rechace un
--       repetido aunque llegara por otro camino.
--
--  · No modifica ninguna fila: las sesiones existentes conservan su número.
--  · Si hubiera algún número repetido, corta antes de cambiar nada.
--  · Si alguna vez un guardado chocara contra el índice, la app no pierde la
--    sesión: la manda a la cola local y la vuelve a subir sola (y ahí el
--    trigger le asigna el número siguiente).
--  · Va en una sola transacción. Se puede volver a correr.
-- ═══════════════════════════════════════════════════════════════════════

begin;

-- 1 · control previo: si hay repetidos, no se toca nada
do $$
declare n int;
begin
  select count(*) into n
    from (select patient_id, session_number
            from public.sessions
           where patient_id is not null and session_number is not null
           group by patient_id, session_number
          having count(*) > 1) d;
  if n > 0 then
    raise exception 'Hay % número(s) de sesión repetidos: no se aplicó nada. Avisarle a Claude.', n;
  end if;
end $$;

-- 2 · trigger con turno por paciente (misma lógica que antes + la traba)
create or replace function public.set_session_number()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
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
$$;

-- 3 · la base no acepta dos sesiones con el mismo número para un paciente
create unique index if not exists sessions_paciente_nro_unico
  on public.sessions (patient_id, session_number)
  where patient_id is not null and session_number is not null;

commit;

-- ── Verificación ───────────────────────────────────────────────────────
select 'índice único (paciente, número)' as control,
       case when to_regclass('public.sessions_paciente_nro_unico') is not null then 'OK' else 'FALTA' end as estado
union all
select 'trigger con turno por paciente',
       case when pg_get_functiondef('public.set_session_number()'::regprocedure) like '%pg_advisory_xact_lock%'
            then 'OK' else 'FALTA' end
union all
select 'trigger conectado a sessions',
       case when exists (select 1 from pg_trigger
                          where tgname = 'trg_session_number' and tgrelid = 'public.sessions'::regclass)
            then 'OK' else 'FALTA' end
union all
select 'números repetidos',
       case when exists (select 1 from public.sessions
                          where patient_id is not null and session_number is not null
                          group by patient_id, session_number having count(*) > 1)
            then 'HAY · avisar' else 'OK (ninguno)' end;
