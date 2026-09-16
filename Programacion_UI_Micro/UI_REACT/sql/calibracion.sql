-- ═══════════════════════════════════════════════════════════════════════
--  CHIDORI · Calibración de la impedancia · script único
--
--  Correr en Supabase → SQL Editor → Run. Entero, de una sola vez.
--  Reemplaza a sql/calibracion.sql y sql/reescalar.sql.
--
--  ── QUÉ HACE ──────────────────────────────────────────────────────────
--  1. Crea la tabla `calibrations` con las calibraciones conocidas.
--  2. Marca cada sesión con la calibración que usó el equipo al medirla.
--  3. Copia las impedancias originales a columnas `_raw`.
--  4. Reescala `impedance`, `rate`, `initial_impedance`, `final_impedance`
--     e `impedance_change` a la calibración de referencia.
--  5. Agrega `measurements.voltage_v` para guardar la continua cruda de A0.
--  6. Rehace `v_dataset_sesiones` con la escala nueva y las banderas.
--
--  Resultado: la app muestra TODAS las sesiones en la misma escala sin
--  tocar el frontend, y el dato tal como salió del equipo queda en `_raw`.
--
--  ── ES SEGURO CORRERLO VARIAS VECES ───────────────────────────────────
--  Todo es idempotente. La conversión NUNCA se aplica sobre un valor ya
--  convertido: siempre se recalcula desde `_raw`. Correrlo diez veces da
--  lo mismo que correrlo una.
--
--  ── QUÉ NO HACE ───────────────────────────────────────────────────────
--  No borra ni una fila. No crea sesiones. No toca `patients`, `subjects`
--  ni `field_definitions`. Los únicos valores que pisa son las columnas de
--  impedancia, y solo después de haberlas copiado a `_raw`.
--
--  ── POR QUÉ ───────────────────────────────────────────────────────────
--  El firmware calculaba Z = Vpp/(I·G) con I = 288 µA y G = 200, derivados
--  de constantes de diseño. Los valores reales, medidos en banco el
--  2026-09-04 y de nuevo el 2026-09-15, difieren mucho de esos. Las sesiones
--  guardadas con las constantes de diseño sobreestiman Z ~4,4×.
--  Detalle: claude/chidori-cadena-de-ganancia.md
--
--  ── LA CONVERSIÓN ─────────────────────────────────────────────────────
--  De Z = 2·(Vadc + Vd)/K se despeja Vadc y se reinyecta en la otra:
--     absolutos   : Z_b = Z_a · (K_a/K_b) + 2·(Vd_b − Vd_a)/K_b
--     diferencias : Δ_b = Δ_a · (K_a/K_b)     ← sin offset, se cancela solo
--  Las constantes salen de la tabla `calibrations`, no van escritas a mano:
--  por eso este mismo archivo sirve para cualquier recalibración futura.
--
--  ── ANTES DE CORRER ───────────────────────────────────────────────────
--  1. Exportá `sessions`, `measurements` y `session_events`. El rollback
--     está al final del archivo, pero tus sesiones son irrepetibles.
--  2. Mirá los dos parámetros del script, acá abajo.
--
--  Si lo corrés por psql en vez del editor de Supabase, usá `psql -1 -f`
--  para que todo el archivo vaya en una sola transacción.
-- ═══════════════════════════════════════════════════════════════════════


-- ╔═════════════════════════════════════════════════════════════════════╗
-- ║  ⚠  DOS PARÁMETROS A REVISAR ANTES DE CORRER                        ║
-- ║                                                                     ║
-- ║  (1) CAL_REF = calibración de referencia, la escala en la que queda  ║
-- ║  todo. Hoy es la 3 (banco del 15/09/2026). Cuando recalibres:        ║
-- ║  agregá la fila nueva al catálogo del paso 1, cambiá el número en    ║
-- ║  las dos líneas marcadas «CAL_REF» y volvé a correr el archivo.      ║
-- ║  Recalcula todo desde `_raw`, no encadena conversiones.              ║
-- ║                                                                     ║
-- ║  (2) FLASHEO                                                        ║
-- ║                                                                     ║
-- ║  FLASHEO = momento en que cargaste al ESP el firmware con la         ║
-- ║  calibración medida. Las sesiones ANTERIORES se marcan como          ║
-- ║  calibración 1; las POSTERIORES, como la de referencia.              ║
-- ║                                                                     ║
-- ║  El valor por defecto (2099) significa "todavía no flasheé": TODO lo ║
-- ║  que hay en la base se considera escala vieja. Es lo correcto si     ║
-- ║  corrés esto antes de flashear, que es lo recomendado.               ║
-- ║                                                                     ║
-- ║  SI YA FLASHEASTE Y MEDISTE, cambiá la fecha de la línea marcada     ║
-- ║  «FLASHEO» más abajo (sección 3) por el momento real del flasheo.    ║
-- ║  Si te equivocás, se arregla: ver "CORREGIR UNA CLASIFICACIÓN MAL"   ║
-- ║  al final del archivo.                                              ║
-- ╚═════════════════════════════════════════════════════════════════════╝


-- ─── 0 · PRECONDICIONES ────────────────────────────────────────────────
-- Si falta una tabla base, cortar acá con un mensaje claro en vez de
-- aplicar la mitad del script.

do $$
declare faltan text := '';
begin
  if to_regclass('public.sessions')       is null then faltan := faltan || ' sessions';       end if;
  if to_regclass('public.measurements')   is null then faltan := faltan || ' measurements';   end if;
  if to_regclass('public.session_events') is null then faltan := faltan || ' session_events'; end if;
  if faltan <> '' then
    raise exception 'Faltan tablas base:%. Este script corre sobre una base de Chidori ya inicializada.', faltan;
  end if;
end $$;


-- ─── 1 · CATÁLOGO DE CALIBRACIONES ─────────────────────────────────────
-- La calibración pasa a ser un objeto trazable con fecha, método y
-- limitaciones, en vez de un número perdido en el firmware.

create table if not exists public.calibrations (
  id           smallint primary key,
  label        text    not null,
  k_cal        numeric not null,        -- I_pp [A] × ganancia del receptor
  v_detector   numeric not null,        -- déficit del detector de envolvente [V]
  i_pp_a       numeric,                 -- corriente inyectada [A pp]
  g_receiver   numeric,                 -- ganancia total del receptor
  method       text,
  valid_from   date,
  notes        text,
  is_reference boolean not null default false,
  created_at   timestamptz not null default now()
);

alter table public.calibrations
  add column if not exists is_reference boolean not null default false;

-- Como mucho una referencia a la vez. Lo garantiza la base, no la memoria.
create unique index if not exists calibrations_una_referencia
  on public.calibrations ((is_reference)) where is_reference;

insert into public.calibrations
  (id, label, k_cal, v_detector, i_pp_a, g_receiver, method, valid_from, notes)
values
  (1, 'diseño (incorrecta)', 0.05760, 0.200, 0.000288, 200,
      'producto de ganancias de diseño, sin medir', null,
      'G = 10*4*5 solo contaba U5B, U4B y el INA122; faltaban U4A, U4C y U4D. El 4 de U4B era la relacion resistiva 2k/500, valida en continua: a 50 kHz la reactancia de CHP2 (1,5 n) domina sobre R6 (500 ohm) y esa etapa queda en ~0,92. La corriente era calculada, no medida. Sobreestima Z ~4,4x en absoluto y 4,93x en los deltas.'),
  (2, 'banco 2026-09-04', 0.28406, 0.277, 0.000450, 631.2,
      'medicion directa: 450 uA pp · 12 mVpp en U1 pin 6 · 1515 mVpp en U4 pin 14 · Vadc 480 mV',
      date '2026-09-04',
      'Los cuatro numeros cierran entre si (1515/2 - 480 = 277,5 mV). Z resultante 5,33 ohm, coherente con medicion tetrapolar abdominal. LIMITACION: el deficit del detector se midio a una sola amplitud y no es constante con la senal. Pendiente calibrar con resistencias patron de 1 % y reportar el residuo del ajuste.'),
  (3, 'banco 2026-09-15 (rev 3)', 0.16675, 0.169, 0.000322, 517.9,
      'banco tras ajustar la ganancia del Howland y los filtros: outAD 340 mVpp · U3A 3,22 Vpp · R_How 10k (las cuatro) -> I=322,0 uA pp · INAout 14 mVpp · U4 pin14 1450 mVpp · Vadc 556 mV',
      date '2026-09-15',
      'Cambios de hardware: RfAD1 ~9,5k, rhpad1 500->1k, R8 8,2k, R9 2,2k, CHP1 y CHP2 cambiados. Las cuatro del Howland siguen en 10k: el 8,06k de la hoja era una lectura EN CIRCUITO (10k en paralelo con RfAD1+RiAD1+rhpad1+3x10k = 41,5k), no el valor del componente. La ganancia total 517,9 sale de INAout (14 mVpp) por la ganancia de catalogo del INA122 (5 con Rg abierto), NO del diferencial anotado en la hoja: ese diferencial (5 mVpp) implicaria G_INA=2,8, imposible. Si se confirmara, K seria 0,1159. LIMITACION: el deficit del detector paso de 277 a 169 mV a la misma amplitud entre el 04/09 y el 15/09 (~1 ohm de offset). Sigue pendiente la calibracion con resistencias patron.')
on conflict (id) do update set
  label  = excluded.label,  k_cal      = excluded.k_cal,   v_detector = excluded.v_detector,
  i_pp_a = excluded.i_pp_a, g_receiver = excluded.g_receiver,
  method = excluded.method, valid_from = excluded.valid_from, notes = excluded.notes;

-- La referencia la fija ESTE archivo: es el unico lugar donde se decide en
-- que escala queda todo. Van dos sentencias y no una porque el indice unico
-- parcial no tolera dos referencias ni siquiera a mitad de un UPDATE.
update public.calibrations set is_reference = false where is_reference and id <> 3;  -- CAL_REF
update public.calibrations set is_reference = true  where id = 3;                    -- CAL_REF

-- RLS · lectura para todos los autenticados; escritura solo superadmin, y
-- solo si existe `profiles` (si no, se deja sin política de escritura).
alter table public.calibrations enable row level security;

drop policy if exists "calibrations_select" on public.calibrations;
create policy "calibrations_select" on public.calibrations
  for select to authenticated using (true);

do $$
begin
  execute 'drop policy if exists "calibrations_write" on public.calibrations';
  if to_regclass('public.profiles') is not null then
    execute $p$
      create policy "calibrations_write" on public.calibrations
        for all to authenticated
        using (exists (select 1 from public.profiles p
                        where p.id = auth.uid() and p.role = 'superadmin'))
        with check (exists (select 1 from public.profiles p
                             where p.id = auth.uid() and p.role = 'superadmin'))
    $p$;
  end if;
end $$;


-- ─── 2 · COLUMNAS ──────────────────────────────────────────────────────
-- Ninguna pisa nada: todas nacen vacías.

alter table public.sessions
  add column if not exists calibration_id        smallint references public.calibrations(id),
  add column if not exists calibration_shown     smallint references public.calibrations(id),
  add column if not exists adc_lineal_asumido    boolean not null default false,
  add column if not exists initial_impedance_raw numeric,
  add column if not exists final_impedance_raw   numeric;

alter table public.measurements
  add column if not exists impedance_raw numeric,
  add column if not exists rate_raw      numeric,
  add column if not exists voltage_v     numeric;

alter table public.session_events
  add column if not exists impedance_raw        numeric,
  add column if not exists impedance_change_raw numeric;

comment on column public.sessions.calibration_id is
  'Calibracion que uso el equipo al MEDIR esta sesion. Hecho historico: no cambia nunca.';
comment on column public.sessions.calibration_shown is
  'Escala en la que estan HOY las columnas de impedancia de esta sesion.';
comment on column public.sessions.adc_lineal_asumido is
  'true = firmware anterior a v1.6.0 (2026-08-03): el ADC se leia como lineal y el del ESP32-C3 no lo es. La conversion de escala para estas sesiones es APROXIMADA.';
comment on column public.measurements.impedance_raw is
  'Impedancia tal como la mando el equipo, en la escala de sessions.calibration_id. NUNCA se pisa: toda recalibracion se calcula desde aca.';
comment on column public.measurements.voltage_v is
  'Continua medida en A0 del ESP32, en volts, antes de convertir a impedancia. Es el dato fisico, contrastable con tester. Vadc ~0 = senal nula.';


-- ─── 3 · CLASIFICAR LAS SESIONES ───────────────────────────────────────
-- Con qué calibración midió el equipo cada sesión. Solo toca las que
-- todavía no están clasificadas, así una re-corrida no reescribe nada.

update public.sessions
   set calibration_id = case
         when created_at < timestamptz '2099-01-01 00:00:00-03:00'   -- ◀── FLASHEO
              then 1     -- midió con las constantes de diseño
              else 2     -- midió con la calibración medida
       end
 where calibration_id is null;

-- De acá en más, lo que entre nace con la calibración de referencia. Va por
-- trigger y no por DEFAULT: un default es un numero fijo que hay que acordarse
-- de mover en cada recalibracion, y olvidarselo etiqueta mal las sesiones
-- nuevas sin que nadie se entere. El trigger sigue solo a `is_reference`.
alter table public.sessions alter column calibration_id drop default;

create or replace function public.set_calibration_id()
returns trigger language plpgsql security definer set search_path = public as $fn$
begin
  if new.calibration_id is null then
    select id into new.calibration_id from public.calibrations where is_reference;
  end if;
  return new;
end;
$fn$;

drop trigger if exists trg_calibration_id on public.sessions;
create trigger trg_calibration_id
  before insert on public.sessions
  for each row execute function public.set_calibration_id();

-- Hasta la v1.6.0 (2026-08-03) el firmware leía el ADC como
-- analogRead()*3.3/4095, asumiendo linealidad. El ADC del ESP32-C3 no es
-- lineal y su error depende del punto de trabajo, así que NO se deshace con
-- una recta: para esas sesiones la conversión es aproximada.
update public.sessions
   set adc_lineal_asumido = true
 where created_at < timestamptz '2026-08-03 00:00:00-03:00'
   and adc_lineal_asumido is distinct from true;


-- ─── 4 · REESCALAR ─────────────────────────────────────────────────────
-- Un solo bloque atómico: o se aplica entero o no se aplica nada, sea cual
-- sea el cliente desde el que se corra.

do $$
declare
  r_id  smallint;
  r_k   numeric;
  r_v   numeric;
  n_ses int;
  n_mea int;
  n_evt int;
begin
  select id, k_cal, v_detector into r_id, r_k, r_v
    from public.calibrations where is_reference;

  if r_id is null then
    raise exception 'No hay ninguna calibracion marcada como referencia (calibrations.is_reference).';
  end if;

  -- 4.a · copia del original · el guard `is null` la escribe UNA sola vez
  --       en la vida de cada fila
  update public.sessions       set calibration_shown     = calibration_id   where calibration_shown     is null;
  update public.sessions       set initial_impedance_raw = initial_impedance where initial_impedance_raw is null;
  update public.sessions       set final_impedance_raw   = final_impedance   where final_impedance_raw   is null;
  update public.measurements   set impedance_raw         = impedance         where impedance_raw        is null;
  update public.measurements   set rate_raw              = rate              where rate_raw             is null;
  update public.session_events set impedance_raw         = impedance         where impedance_raw        is null;
  update public.session_events set impedance_change_raw  = impedance_change  where impedance_change_raw is null;

  -- 4.b · conversión · SIEMPRE desde `_raw`, nunca desde el valor actual,
  --       y SIN condicionar por el estado anterior. Recalcular todo en cada
  --       corrida da el mismo resultado (por eso es idempotente) y ademas
  --       repara solo cualquier fila que haya quedado mal convertida.
  update public.measurements m
     set impedance = round((m.impedance_raw * (c.k_cal / r_k) + 2*(r_v - c.v_detector)/r_k)::numeric, 4),
         rate      = round((m.rate_raw      * (c.k_cal / r_k))::numeric, 4)
    from public.sessions s
    join public.calibrations c on c.id = s.calibration_id
   where m.session_id = s.id;
  get diagnostics n_mea = row_count;

  update public.session_events e
     set impedance = round((e.impedance_raw * (c.k_cal / r_k) + 2*(r_v - c.v_detector)/r_k)::numeric, 4),
         -- OJO · en kind='gap', impedance_change guarda la DURACION del
         -- hueco en SEGUNDOS, no una impedancia. No se convierte.
         impedance_change = case when e.kind = 'gap' then e.impedance_change_raw
                                 else round((e.impedance_change_raw * (c.k_cal / r_k))::numeric, 4) end
    from public.sessions s
    join public.calibrations c on c.id = s.calibration_id
   where e.session_id = s.id;
  get diagnostics n_evt = row_count;

  -- 4.c · `calibration_shown` queda informando en qué escala están las
  --        columnas después de esta corrida.
  update public.sessions s
     set initial_impedance = round((s.initial_impedance_raw * (c.k_cal / r_k) + 2*(r_v - c.v_detector)/r_k)::numeric, 4),
         final_impedance   = round((s.final_impedance_raw   * (c.k_cal / r_k) + 2*(r_v - c.v_detector)/r_k)::numeric, 4),
         calibration_shown = r_id
    from public.calibrations c
   where c.id = s.calibration_id;
  get diagnostics n_ses = row_count;

  raise notice 'Recalculado desde _raw a la calibracion %: % sesiones, % muestras, % eventos.',
               r_id, n_ses, n_mea, n_evt;
end $$;


-- ─── 5 · VISTA DEL DATASET ─────────────────────────────────────────────
-- Se arma dinámicamente porque `subjects` puede o no existir (el SQL de
-- pacientes dice que queda sin uso y se puede borrar).

drop view if exists public.v_measurements_cal;      -- de versiones previas
drop view if exists public.v_session_events_cal;    -- de versiones previas
drop view if exists public.v_sessions_cal cascade;  -- de versiones previas
drop view if exists public.v_dataset_sesiones;

do $$
declare
  hay_subjects boolean := to_regclass('public.subjects') is not null;
  col_peso     text := case when exists (select 1 from information_schema.columns
                                          where table_schema='public' and table_name='sessions'
                                            and column_name='patient_weight')
                            then 's.patient_weight' else 'null::numeric' end;
  col_iliac    text := case when exists (select 1 from information_schema.columns
                                          where table_schema='public' and table_name='sessions'
                                            and column_name='patient_iliac_circ')
                            then 's.patient_iliac_circ' else 'null::numeric' end;
begin
  execute format($v$
    create view public.v_dataset_sesiones as
    select
      s.id            as session_id,
      %s
      -- impedancias YA en la escala de referencia
      s.initial_impedance,
      s.final_impedance,
      round((s.final_impedance - s.initial_impedance)::numeric, 4) as delta_impedance,
      -- el original, para trazabilidad
      s.initial_impedance_raw,
      s.final_impedance_raw,
      s.calibration_id,
      s.calibration_shown,
      s.adc_lineal_asumido,
      s.elapsed_time_str,
      s.total_events,
      s.notes,
      s.created_at,
      (select count(*) from public.session_events e where e.session_id = s.id and e.kind = 'gap')   as microcortes,
      (select count(*) from public.session_events e where e.session_id = s.id and e.kind = 'water') as tomas_agua,
      (select count(*) from public.session_events e where e.session_id = s.id and e.kind = 'void')  as micciones
    from public.sessions s
    %s
  $v$,
  case when hay_subjects then format($c$
      s.session_code, sub.code as subject_code, sub.sex, sub.birth_year, sub.height_m,
      coalesce(%s, sub.weight_kg)      as weight_kg,
      coalesce(%s, sub.iliac_circ_cm)  as iliac_circ_cm,
      s.temperature_c, s.humidity_pct, s.food_24h, s.water_total_ml,
  $c$, col_peso, col_iliac)
  else format($c$
      %s as weight_kg,
      %s as iliac_circ_cm,
  $c$, col_peso, col_iliac) end,
  case when hay_subjects then 'left join public.subjects sub on sub.id = s.subject_id' else '' end);
end $$;


-- ─── 6 · REPORTE FINAL ─────────────────────────────────────────────────
-- Lo que devuelve el editor. Si algo salió mal, se ve acá.

select
  s.calibration_id                                        as midio_con,
  s.calibration_shown                                     as escala_actual,
  s.adc_lineal_asumido                                    as adc_aproximado,
  count(distinct s.id)                                    as sesiones,
  count(m.id)                                             as muestras,
  round(avg(m.impedance_raw)::numeric, 2)                 as z_original,
  round(avg(m.impedance)::numeric, 2)                     as z_calibrada,
  count(m.voltage_v)                                      as con_vadc
from public.sessions s
left join public.measurements m on m.session_id = s.id
group by 1, 2, 3
order by 1, 2;


-- ═══════════════════════════════════════════════════════════════════════
--  CORREGIR UNA CLASIFICACIÓN MAL
--  Si una sesión quedó con la calibración equivocada, se arregla sin
--  pérdida: `_raw` nunca se pisó. Corregí `calibration_id` y volvé a correr
--  el archivo entero; recalcula todo desde el original.
--
--   update public.sessions
--      set calibration_id = 2
--    where created_at >= timestamptz '2026-09-10 00:00:00-03:00';
--   -- y después correr este archivo de nuevo
-- ═══════════════════════════════════════════════════════════════════════


-- ═══════════════════════════════════════════════════════════════════════
--  VOLVER ATRÁS · restaura los valores originales desde `_raw`.
--  Las columnas agregadas pueden quedar, no molestan.
-- ═══════════════════════════════════════════════════════════════════════
--
--   update public.measurements   set impedance = impedance_raw, rate = rate_raw;
--   update public.session_events set impedance = impedance_raw,
--                                    impedance_change = impedance_change_raw;
--   update public.sessions       set initial_impedance = initial_impedance_raw,
--                                    final_impedance   = final_impedance_raw,
--                                    calibration_shown = calibration_id;
