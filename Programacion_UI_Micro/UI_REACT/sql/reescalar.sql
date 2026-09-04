-- ═══════════════════════════════════════════════════════════════════════
--  CHIDORI · Reescalar las mediciones guardadas a la calibración vigente
--
--  CORRER DESPUÉS de sql/calibracion.sql (pasos 1 a 4 como mínimo).
--
--  ── QUÉ HACE ──────────────────────────────────────────────────────────
--  Pisa `impedance`, `rate`, `initial_impedance`, `final_impedance` e
--  `impedance_change` con los valores convertidos a la calibración de
--  referencia. Antes de pisar, copia el valor original a columnas `_raw`.
--
--  Resultado: la app muestra TODAS las sesiones en la misma escala sin
--  tocar una línea del frontend (AdminView lee las tablas directo), y el
--  dato tal como salió del equipo sigue estando en `_raw`.
--
--  ── ES IDEMPOTENTE Y RE-EJECUTABLE ────────────────────────────────────
--  La conversión NUNCA se aplica sobre el valor ya convertido: siempre se
--  recalcula desde `_raw`. Correrlo dos veces no cambia nada. Cuando
--  calibres con las resistencias patrón, agregás la fila 3 a
--  `calibrations`, le movés `is_reference`, volvés a correr este archivo y
--  todo se reescala DESDE EL ORIGINAL, sin encadenar conversiones.
--
--  ── MODELO DE DATOS ───────────────────────────────────────────────────
--    sessions.calibration_id     · con qué calibración MIDIÓ el equipo.
--                                  No cambia nunca. Es un hecho histórico.
--    sessions.calibration_shown  · en qué escala están HOY las columnas de
--                                  impedancia. Lo mueve este script.
--    *_raw                       · el valor tal como lo mandó el equipo.
--
--  ── LA CONVERSIÓN ─────────────────────────────────────────────────────
--  De Z = 2·(Vadc + Vd)/K se despeja Vadc y se reinyecta en la otra:
--    absolutos : Z_b = Z_a · (K_a/K_b) + 2·(Vd_b − Vd_a)/K_b
--    diferencias: Δ_b = Δ_a · (K_a/K_b)        ← sin offset, se cancela
--  Las constantes salen de `calibrations`, no van hardcodeadas: por eso
--  esto sirve para cualquier recalibración futura.
-- ═══════════════════════════════════════════════════════════════════════


-- ═══════════════════════════════════════════════════════════════════════
--  PASO A · CUÁL ES LA CALIBRACIÓN DE REFERENCIA
--  Para cambiarla en el futuro: mover este flag y volver a correr el archivo.
-- ═══════════════════════════════════════════════════════════════════════

alter table public.calibrations
  add column if not exists is_reference boolean not null default false;

-- Como mucho una referencia a la vez. Lo garantiza la base, no la disciplina.
create unique index if not exists calibrations_una_referencia
  on public.calibrations ((is_reference)) where is_reference;

-- OJO · esto marca la referencia SOLO si todavia no hay ninguna. Si forzara
-- (id = 2) en cada corrida, pisaria un cambio manual y este archivo no
-- serviria nunca para una recalibracion futura.
--
-- PARA CAMBIAR LA REFERENCIA mas adelante, correr esto A MANO y despues
-- volver a correr el archivo entero:
--     update public.calibrations set is_reference = false;
--     update public.calibrations set is_reference = true where id = 3;
update public.calibrations
   set is_reference = (id = 2)
 where not exists (select 1 from public.calibrations where is_reference);

-- VERIFICACIÓN · tiene que haber exactamente una en true
--   select id, label, is_reference from public.calibrations order by id;


-- ═══════════════════════════════════════════════════════════════════════
--  PASO B · COLUMNAS PARA EL ORIGINAL
-- ═══════════════════════════════════════════════════════════════════════

alter table public.sessions
  add column if not exists calibration_shown     smallint references public.calibrations(id),
  add column if not exists initial_impedance_raw numeric,
  add column if not exists final_impedance_raw   numeric;

alter table public.measurements
  add column if not exists impedance_raw numeric,
  add column if not exists rate_raw      numeric;

alter table public.session_events
  add column if not exists impedance_raw        numeric,
  add column if not exists impedance_change_raw numeric;

comment on column public.measurements.impedance_raw is
  'Impedancia tal como la mando el equipo, en la escala de sessions.calibration_id. NUNCA se pisa. Toda recalibracion se calcula desde aca.';
comment on column public.sessions.calibration_shown is
  'Escala en la que estan HOY las columnas de impedancia de esta sesion. La mueve sql/reescalar.sql.';


-- ═══════════════════════════════════════════════════════════════════════
--  PASO C · COPIAR EL ORIGINAL (solo la primera vez por fila)
--  El guard `is null` garantiza que `_raw` se escribe UNA sola vez en la
--  vida de la fila. Si este archivo ya corrio, no se vuelve a tocar.
-- ═══════════════════════════════════════════════════════════════════════

update public.sessions       set calibration_shown     = calibration_id   where calibration_shown     is null;
update public.sessions       set initial_impedance_raw = initial_impedance where initial_impedance_raw is null;
update public.sessions       set final_impedance_raw   = final_impedance   where final_impedance_raw   is null;
update public.measurements   set impedance_raw         = impedance         where impedance_raw        is null;
update public.measurements   set rate_raw              = rate              where rate_raw             is null;
update public.session_events set impedance_raw         = impedance         where impedance_raw        is null;
update public.session_events set impedance_change_raw  = impedance_change  where impedance_change_raw is null;

-- VERIFICACIÓN · no debe quedar ninguna fila con dato y sin copia
--   select count(*) as sin_copia from public.measurements
--    where impedance is not null and impedance_raw is null;


-- ═══════════════════════════════════════════════════════════════════════
--  PASO D · REESCALAR
--  Todo en una transacción. El orden importa: `calibration_shown` se mueve
--  en la ÚLTIMA sentencia, así las anteriores todavía ven qué falta convertir.
-- ═══════════════════════════════════════════════════════════════════════

begin;

create temporary table _src on commit drop as
select s.id                                            as session_id,
       (c.k_cal / r.k_cal)                             as factor,
       (2 * (r.v_detector - c.v_detector) / r.k_cal)   as offset_ohm,
       r.id                                            as target_id
  from public.sessions s
  join public.calibrations c on c.id = s.calibration_id
 cross join (select id, k_cal, v_detector from public.calibrations where is_reference limit 1) r
 where s.calibration_shown is distinct from r.id;

update public.measurements m
   set impedance = round((m.impedance_raw * x.factor + x.offset_ohm)::numeric, 4),
       rate      = round((m.rate_raw      * x.factor)::numeric, 4)
  from _src x
 where m.session_id = x.session_id;

update public.session_events e
   set impedance        = round((e.impedance_raw * x.factor + x.offset_ohm)::numeric, 4),
       -- OJO · en kind='gap', impedance_change guarda la DURACION del hueco
       -- en segundos, no una impedancia. No se convierte.
       impedance_change = case when e.kind = 'gap' then e.impedance_change_raw
                               else round((e.impedance_change_raw * x.factor)::numeric, 4) end
  from _src x
 where e.session_id = x.session_id;

update public.sessions s
   set initial_impedance = round((s.initial_impedance_raw * x.factor + x.offset_ohm)::numeric, 4),
       final_impedance   = round((s.final_impedance_raw   * x.factor + x.offset_ohm)::numeric, 4),
       calibration_shown = x.target_id
  from _src x
 where s.id = x.session_id;

commit;

-- VERIFICACIÓN · las viejas tienen que haber bajado ~4,9x
--   select s.calibration_id, s.calibration_shown, count(*) as muestras,
--          round(avg(m.impedance_raw)::numeric, 2) as antes,
--          round(avg(m.impedance)::numeric, 2)     as ahora
--     from public.measurements m join public.sessions s on s.id = m.session_id
--    group by 1, 2 order by 1;
--
-- VERIFICACIÓN · nada debe quedar sin reescalar
--   select count(*) as pendientes from public.sessions
--    where calibration_shown is distinct from
--          (select id from public.calibrations where is_reference);


-- ═══════════════════════════════════════════════════════════════════════
--  PASO E · REDEFINIR LAS VISTAS PARA QUE CALCULEN DESDE `_raw`
--  Sin esto, las vistas de sql/calibracion.sql volverian a convertir un
--  valor YA convertido y darian mal. Calculando desde `_raw` quedan
--  correctas hayas corrido o no el reescalado.
-- ═══════════════════════════════════════════════════════════════════════

drop view if exists public.v_measurements_cal;
create view public.v_measurements_cal as
select m.*,
       round((m.impedance_raw * (c.k_cal / r.k_cal)
              + 2*(r.v_detector - c.v_detector)/r.k_cal)::numeric, 4) as impedance_ohm,
       round((m.rate_raw * (c.k_cal / r.k_cal))::numeric, 4)          as rate_ohm_min,
       s.calibration_id, s.calibration_shown, s.adc_lineal_asumido
  from public.measurements m
  join public.sessions s     on s.id = m.session_id
  join public.calibrations c on c.id = s.calibration_id
 cross join (select k_cal, v_detector from public.calibrations where is_reference limit 1) r;

drop view if exists public.v_session_events_cal;
create view public.v_session_events_cal as
select e.*,
       round((e.impedance_raw * (c.k_cal / r.k_cal)
              + 2*(r.v_detector - c.v_detector)/r.k_cal)::numeric, 4) as impedance_ohm,
       case when e.kind = 'gap' then null
            else round((e.impedance_change_raw * (c.k_cal / r.k_cal))::numeric, 4) end
                                                                      as impedance_change_ohm,
       s.calibration_id, s.adc_lineal_asumido
  from public.session_events e
  join public.sessions s     on s.id = e.session_id
  join public.calibrations c on c.id = s.calibration_id
 cross join (select k_cal, v_detector from public.calibrations where is_reference limit 1) r;

drop view if exists public.v_sessions_cal cascade;
create view public.v_sessions_cal as
select s.*,
       round((s.initial_impedance_raw * (c.k_cal / r.k_cal)
              + 2*(r.v_detector - c.v_detector)/r.k_cal)::numeric, 4) as initial_impedance_ohm,
       round((s.final_impedance_raw   * (c.k_cal / r.k_cal)
              + 2*(r.v_detector - c.v_detector)/r.k_cal)::numeric, 4) as final_impedance_ohm
  from public.sessions s
  join public.calibrations c on c.id = s.calibration_id
 cross join (select k_cal, v_detector from public.calibrations where is_reference limit 1) r;

-- `v_dataset_sesiones` depende de v_sessions_cal: el CASCADE de arriba la
-- borro. Volver a correr el PASO 6 de sql/calibracion.sql para recrearla.


-- ═══════════════════════════════════════════════════════════════════════
--  VOLVER ATRÁS
--  Restaura los valores originales. Solo esto: las columnas `_raw` y las
--  de calibración pueden quedar, no molestan.
-- ═══════════════════════════════════════════════════════════════════════
--
--   begin;
--   update public.measurements   set impedance = impedance_raw, rate = rate_raw;
--   update public.session_events set impedance = impedance_raw,
--                                    impedance_change = impedance_change_raw;
--   update public.sessions       set initial_impedance = initial_impedance_raw,
--                                    final_impedance   = final_impedance_raw,
--                                    calibration_shown = calibration_id;
--   commit;
