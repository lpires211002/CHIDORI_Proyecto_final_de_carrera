-- ═══════════════════════════════════════════════════════════════════════
--  CHIDORI · Calibración de la cadena de medición + guardado del crudo
--  Correr en Supabase → SQL Editor.
--
--  SE PUEDE CORRER PASO POR PASO: cada PASO es independiente e idempotente
--  (se puede repetir sin romper nada). Seleccionás el bloque, Run, mirás la
--  VERIFICACIÓN que va al final de cada paso, y recién ahí seguís.
--
--  ── QUÉ RESUELVE ──────────────────────────────────────────────────────
--  El firmware calculaba Z = Vpp / (I · G) con I = 288 µA y G = 200, ambos
--  derivados de constantes de diseño. Los valores reales, medidos en banco
--  el 2026-09-04, son I = 450 µA pp y G = 631,2. Las sesiones ya guardadas
--  están en la escala vieja y sobreestiman Z ~4,4× en valor absoluto.
--
--  ── CRITERIO ──────────────────────────────────────────────────────────
--  NO se toca ni un dato existente. `impedance` es el único registro de lo
--  que midió el equipo y las sesiones son irrepetibles. La corrección se
--  expone en VISTAS; las tablas quedan intactas. Si mañana aparece una
--  calibración mejor, se agrega una fila a `calibrations` y se rehace la
--  vista, sin haber destruido nada.
--
--  ── LA CONVERSIÓN ─────────────────────────────────────────────────────
--    Z_vieja = 34,7222 · Vadc + 6,9444      (I=288 µA, G=200, Vd=0,200 V)
--    Z_nueva =  7,0408 · Vadc + 1,9503      (I=450 µA, G=631, Vd=0,277 V)
--
--    absolutos : Z_nueva = 0,202774 · Z_vieja + 0,542139
--    deltas    : Δ_nueva = 0,202774 · Δ_vieja        ← SIN el offset
--
--  El offset se cancela en cualquier diferencia. Aplicárselo a un delta le
--  mete un sesgo de +0,54 Ω. Vale para `impedance_change` y para `rate`.
--
--  La conversión es EXACTA (no aproximada) para sesiones grabadas con
--  firmware ≥ v1.6.0: la mediana y la media móvil que aplica el firmware
--  son operaciones afín-equivariantes, así que filtrar-y-convertir da lo
--  mismo que convertir-y-filtrar. La salvedad está en el PASO 3.
--
--  Detalle completo: claude/chidori-cadena-de-ganancia.md
-- ═══════════════════════════════════════════════════════════════════════


-- ═══════════════════════════════════════════════════════════════════════
--  PASO 1 · CATÁLOGO DE CALIBRACIONES
--  La calibración pasa a ser un objeto trazable con fecha y método, no un
--  número perdido en el firmware.
-- ═══════════════════════════════════════════════════════════════════════

create table if not exists public.calibrations (
  id          smallint primary key,
  label       text    not null,
  k_cal       numeric not null,          -- I_pp [A] × ganancia del receptor
  v_detector  numeric not null,          -- déficit del detector de envolvente [V]
  i_pp_a      numeric,                   -- corriente inyectada [A pp]
  g_receiver  numeric,                   -- ganancia total del receptor
  method      text,
  valid_from  date,
  notes       text,
  created_at  timestamptz not null default now()
);

alter table public.calibrations enable row level security;

drop policy if exists "calibrations_select" on public.calibrations;
create policy "calibrations_select" on public.calibrations
  for select to authenticated using (true);

-- Solo superadmin toca el catálogo: define la escala del dataset entero.
drop policy if exists "calibrations_write" on public.calibrations;
create policy "calibrations_write" on public.calibrations
  for all to authenticated
  using (exists (select 1 from public.profiles p
                  where p.id = auth.uid() and p.role = 'superadmin'))
  with check (exists (select 1 from public.profiles p
                       where p.id = auth.uid() and p.role = 'superadmin'));

insert into public.calibrations
  (id, label, k_cal, v_detector, i_pp_a, g_receiver, method, valid_from, notes)
values
  (1, 'diseño (incorrecta)', 0.05760, 0.200, 0.000288, 200,
      'producto de ganancias de diseño, sin medir',
      null,
      'G = 10*4*5 solo contaba U5B, U4B y el INA122; faltaban U4A, U4C y U4D. El 4 de U4B era la relacion resistiva 2k/500, valida en continua: a 50 kHz la reactancia de CHP2 (1,5 n) domina sobre R6 (500 ohm) y esa etapa queda en ~0,92. La corriente era calculada, no medida. Sobreestima Z ~4,4x en absoluto y 4,93x en los deltas.'),
  (2, 'banco 2026-09-04', 0.28406, 0.277, 0.000450, 631.2,
      'medicion directa: 450 uA pp · 12 mVpp en U1 pin 6 · 1515 mVpp en U4 pin 14 · Vadc 480 mV',
      date '2026-09-04',
      'Los cuatro numeros cierran entre si (1515/2 - 480 = 277,5 mV). Z resultante 5,33 ohm, coherente con medicion tetrapolar abdominal. LIMITACION: el deficit del detector se midio a una sola amplitud y no es constante con la senal (a amplitud chica el diodo conduce menos y el capacitor no llega al pico). Pendiente calibrar con resistencias patron de 1 % y reportar el residuo del ajuste.')
on conflict (id) do update set
  label      = excluded.label,      k_cal      = excluded.k_cal,
  v_detector = excluded.v_detector, i_pp_a     = excluded.i_pp_a,
  g_receiver = excluded.g_receiver, method     = excluded.method,
  valid_from = excluded.valid_from, notes      = excluded.notes;

-- VERIFICACIÓN · deben aparecer dos filas
--   select id, label, k_cal, v_detector, i_pp_a, g_receiver from public.calibrations order by id;


-- ═══════════════════════════════════════════════════════════════════════
--  PASO 2 · VINCULAR CADA SESIÓN A SU CALIBRACIÓN
--  Todo lo ya guardado se midió con la vieja. Lo nuevo entra con la medida.
-- ═══════════════════════════════════════════════════════════════════════

alter table public.sessions
  add column if not exists calibration_id smallint references public.calibrations(id);

update public.sessions set calibration_id = 1 where calibration_id is null;

alter table public.sessions alter column calibration_id set default 2;

comment on column public.sessions.calibration_id is
  'Calibracion con la que se calculo la impedancia de esta sesion. El default 2 asume firmware con K_CAL medida: si se reflashea un firmware viejo hay que corregirlo a mano.';

-- VERIFICACIÓN · cuántas sesiones quedaron de cada lado
--   select calibration_id, count(*), min(created_at)::date as desde, max(created_at)::date as hasta
--     from public.sessions group by calibration_id order by calibration_id;


-- ═══════════════════════════════════════════════════════════════════════
--  PASO 3 · MARCAR LAS SESIONES CON ADC ASUMIDO LINEAL
--
--  Hasta la v1.6.0 del firmware (2026-08-03) el ADC se leia como
--  analogRead() * 3.3 / 4095, asumiendo linealidad. El ADC del ESP32-C3 NO
--  es lineal: su error depende del punto de trabajo, asi que NO se deshace
--  con una recta. Para esas sesiones la conversion del PASO 5 es
--  APROXIMADA, no exacta, y no deberian mezclarse con las nuevas en el
--  dataset sin dejarlo dicho.
-- ═══════════════════════════════════════════════════════════════════════

alter table public.sessions
  add column if not exists adc_lineal_asumido boolean not null default false;

update public.sessions
   set adc_lineal_asumido = true
 where created_at < timestamptz '2026-08-03 00:00:00-03:00';

comment on column public.sessions.adc_lineal_asumido is
  'true = firmware anterior a v1.6.0: el ADC se leia como lineal y no lo es. La conversion de escala para estas sesiones es aproximada.';

-- VERIFICACIÓN
--   select adc_lineal_asumido, count(*), min(created_at)::date, max(created_at)::date
--     from public.sessions group by adc_lineal_asumido;


-- ═══════════════════════════════════════════════════════════════════════
--  PASO 4 · GUARDAR EL CRUDO (impedancia Y voltaje)
--
--  Hasta ahora `measurements` guardaba solo `impedance`, que es un valor
--  DERIVADO de constantes que ya cambiaron una vez. El firmware manda la
--  continua de A0 desde la v1.6.1 y la app la descartaba. Guardandola, el
--  dataset pasa a contener el dato fisico medido, y cualquier recalibracion
--  futura es una re-derivacion en vez de un retrofit.
-- ═══════════════════════════════════════════════════════════════════════

alter table public.measurements
  add column if not exists voltage_v numeric;

comment on column public.measurements.voltage_v is
  'Continua medida en A0 del ESP32, en volts, antes de convertir a impedancia. Es el dato fisico. Contrastable con tester. Vadc ~0 significa senal nula (electrodos sueltos o inyeccion apagada).';

comment on column public.measurements.impedance is
  'Impedancia en ohms EN LA ESCALA DE LA CALIBRACION DE SU SESION (sessions.calibration_id). Para comparar entre sesiones usar la vista v_measurements_cal.';

-- VERIFICACIÓN · la columna tiene que aparecer
--   select column_name, data_type from information_schema.columns
--    where table_schema='public' and table_name='measurements' order by ordinal_position;


-- ═══════════════════════════════════════════════════════════════════════
--  PASO 5 · VISTAS CON LA ESCALA UNIFICADA
--  Todo lo que compare o exporte datos debe leer de acá, no de las tablas.
-- ═══════════════════════════════════════════════════════════════════════

drop view if exists public.v_measurements_cal;
create view public.v_measurements_cal as
select
  m.*,
  -- valor absoluto: factor + offset
  case when s.calibration_id = 1
       then round((0.202774 * m.impedance + 0.542139)::numeric, 4)
       else m.impedance::numeric end                     as impedance_ohm,
  -- rate es ohm/min, o sea una DERIVADA: solo el factor, sin offset
  case when s.calibration_id = 1
       then round((0.202774 * m.rate)::numeric, 4)
       else m.rate::numeric end                          as rate_ohm_min,
  s.calibration_id,
  s.adc_lineal_asumido
from public.measurements m
join public.sessions s on s.id = m.session_id;

drop view if exists public.v_session_events_cal;
create view public.v_session_events_cal as
select
  e.*,
  case when s.calibration_id = 1
       then round((0.202774 * e.impedance + 0.542139)::numeric, 4)
       else e.impedance::numeric end                     as impedance_ohm,
  -- OJO · en los eventos kind='gap', `impedance_change` NO es una impedancia:
  -- guarda la DURACION del hueco en segundos. Convertirla la corromperia.
  case when e.kind = 'gap' then null
       when s.calibration_id = 1
       then round((0.202774 * e.impedance_change)::numeric, 4)
       else e.impedance_change::numeric end              as impedance_change_ohm,
  s.calibration_id,
  s.adc_lineal_asumido
from public.session_events e
join public.sessions s on s.id = e.session_id;

drop view if exists public.v_sessions_cal;
create view public.v_sessions_cal as
select
  s.*,
  case when s.calibration_id = 1
       then round((0.202774 * s.initial_impedance + 0.542139)::numeric, 4)
       else s.initial_impedance::numeric end             as initial_impedance_ohm,
  case when s.calibration_id = 1
       then round((0.202774 * s.final_impedance + 0.542139)::numeric, 4)
       else s.final_impedance::numeric end               as final_impedance_ohm
from public.sessions s;

-- VERIFICACIÓN · las viejas tienen que bajar ~4,9× y las nuevas quedar igual
--   select calibration_id, count(*),
--          round(avg(impedance)::numeric,2)     as z_guardada,
--          round(avg(impedance_ohm)::numeric,2) as z_calibrada
--     from public.v_measurements_cal group by calibration_id order by calibration_id;


-- ═══════════════════════════════════════════════════════════════════════
--  PASO 6 · DATASET EN ESCALA ÚNICA
--  Reemplaza v_dataset_sesiones para que exporte ohms comparables entre
--  sesiones, y arrastre las banderas de calidad.
-- ═══════════════════════════════════════════════════════════════════════

drop view if exists public.v_dataset_sesiones;
create view public.v_dataset_sesiones as
select
  s.id                as session_id,
  s.session_code,
  sub.code            as subject_code,
  sub.sex,
  sub.birth_year,
  sub.height_m,
  coalesce(s.patient_weight, sub.weight_kg)         as weight_kg,
  coalesce(s.patient_iliac_circ, sub.iliac_circ_cm) as iliac_circ_cm,
  s.temperature_c,
  s.humidity_pct,
  s.food_24h,
  s.water_total_ml,
  -- impedancias YA CALIBRADAS · comparables entre sesiones
  c.initial_impedance_ohm,
  c.final_impedance_ohm,
  round((c.final_impedance_ohm - c.initial_impedance_ohm), 4) as delta_impedance_ohm,
  -- los valores tal como se guardaron, para trazabilidad
  s.initial_impedance as initial_impedance_raw,
  s.final_impedance   as final_impedance_raw,
  s.calibration_id,
  s.adc_lineal_asumido,
  s.elapsed_time_str,
  s.total_events,
  s.notes,
  s.created_at,
  (select count(*) from public.session_events e
    where e.session_id = s.id and e.kind = 'gap')   as microcortes,
  (select count(*) from public.session_events e
    where e.session_id = s.id and e.kind = 'water') as tomas_agua,
  (select count(*) from public.session_events e
    where e.session_id = s.id and e.kind = 'void')  as micciones
from public.sessions s
left join public.subjects sub    on sub.id = s.subject_id
left join public.v_sessions_cal c on c.id  = s.id;

-- VERIFICACIÓN
--   select session_id, calibration_id, adc_lineal_asumido,
--          initial_impedance_raw, initial_impedance_ohm, delta_impedance_ohm
--     from public.v_dataset_sesiones order by created_at desc limit 10;


-- ═══════════════════════════════════════════════════════════════════════
--  PASO 7 · CONTROL DE INTEGRIDAD (correr después de la primera sesión
--  medida con el firmware nuevo)
--
--  Con voltage_v guardado, la etiqueta de calibración se puede CONTRASTAR
--  contra el dato crudo en vez de creerle. No coinciden exacto: la Z que
--  manda el firmware pasa por mediana(5) + media móvil(12) y el Vadc que
--  manda es el instantáneo. Lo que importa es el ORDEN DE MAGNITUD del
--  desvío: chico = etiqueta correcta; ~4,9× = sesión mal etiquetada.
-- ═══════════════════════════════════════════════════════════════════════

--   select s.id, s.calibration_id, count(*) as n,
--          round(avg(m.impedance)::numeric, 3)                                  as z_guardada,
--          round(avg(2*(m.voltage_v + c.v_detector)/c.k_cal)::numeric, 3)       as z_esperada,
--          round((avg(m.impedance) / nullif(avg(2*(m.voltage_v + c.v_detector)/c.k_cal),0))::numeric, 3) as cociente
--     from public.measurements m
--     join public.sessions s     on s.id = m.session_id
--     join public.calibrations c on c.id = s.calibration_id
--    where m.voltage_v is not null
--    group by s.id, s.calibration_id
--    order by abs(1 - avg(m.impedance) / nullif(avg(2*(m.voltage_v + c.v_detector)/c.k_cal),0)) desc
--    limit 20;
--
--  Un cociente cerca de 1 confirma la etiqueta. Cerca de 4,93 significa que
--  esa sesión se midió con firmware viejo y quedó marcada como calibración 2:
--    update public.sessions set calibration_id = 1 where id = '<uuid>';
