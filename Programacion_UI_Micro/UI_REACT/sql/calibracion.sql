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
--  5b. Etiqueta cada sesión con la calibración que REALMENTE la midió, leída
--      del K_CAL que reporta el firmware, en vez de suponerla por un default.
--  5c. (rev 4) Separa DOS cosas que hasta el 27/09 eran la misma:
--        calibration_id    = constantes con las que el FIRMWARE calculó Z
--        calibration_hw_id = estado real de la PLACA con la que se midió
--      Cuando coinciden, Z ya salió bien del equipo. Cuando no (placa
--      modificada y firmware sin actualizar), se corrige desde `_raw`.
--  5d. (rev 5, 09/10) La placa modificada tiene R9 = 1,2k, no 1,1k. Agrega la
--      calibración 5 MEDIDA en esa placa y `calibrations.hw_id`: "si el
--      firmware reportó esta calibración, la placa real es esta otra". Las
--      sesiones con el firmware de 1,1k (4) pasan solas a la placa 5.
--      Reclasifica por el K_CAL reportado las sesiones que entraron cuando
--      su calibración todavía no estaba en el catálogo.
--  5e. (rev 6, 24/10/2026) PLACA 3.1 en todas las placas: R2 1,5k, R9 2k,
--      R10 4,7k. Agrega la calibración 6, validada con una resistencia fija
--      de 120 Ω (K 0,01800 · déficit 0,260 V). Y TODAS las sesiones pasan a
--      esa escala: la placa con la que se midió tenía un componente que no
--      amplificaba, así que su ganancia real era mucho menor que la que
--      suponía el firmware y la Z salía mucho menor. La medición del 09/10
--      lo confirma: con U5B en ×0,53 en vez de ×10 la ganancia total da ~55,
--      contra 53,2 de la 3.1. La LISTA de la 3b ahora dice también con qué
--      firmware se midió cada sesión listada.
--  6. Rehace `v_dataset_sesiones` con la escala nueva y las banderas.
--  4.d (app 1.10.0) Si existen las ediciones de sesiones
--      (sql/edicion_sesiones.sql), las reescala con la misma cuenta desde su
--      `impedance_raw`, así una sesión editada sigue en la escala de su placa.
--
--  Resultado: la app muestra cada sesión en ohms reales según la placa con
--  que se midió, sin tocar el frontend, y el dato tal como salió del equipo
--  queda en `_raw`.
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
--  con a = calibration_id (firmware) y b = calibration_hw_id (placa).
--  Las constantes salen de la tabla `calibrations`, no van escritas a mano:
--  por eso este mismo archivo sirve para cualquier recalibración futura.
--
--  ── ANTES DE CORRER ───────────────────────────────────────────────────
--  1. Exportá `sessions`, `measurements` y `session_events`. El rollback
--     está al final del archivo, pero tus sesiones son irrepetibles.
--  2. Mirá los tres parámetros del script, acá abajo.
--
--  Si lo corrés por psql en vez del editor de Supabase, usá `psql -1 -f`
--  para que todo el archivo vaya en una sola transacción.
-- ═══════════════════════════════════════════════════════════════════════


-- ╔═════════════════════════════════════════════════════════════════════╗
-- ║  ⚠  TRES PARÁMETROS · para correr la rev 4 NO hay que tocar ninguno ║
-- ║                                                                     ║
-- ║  (1) CAL_REF · líneas marcadas «CAL_REF» (sección 1). Calibración    ║
-- ║  que se SUPONE cuando el equipo no reportó la suya (firmware         ║
-- ║  anterior a 1.8.0). Queda en 3. Desde la rev 4 ya NO es "la escala   ║
-- ║  en la que queda todo": cada sesión queda en la escala de SU placa   ║
-- ║  (calibration_hw_id).                                               ║
-- ║                                                                     ║
-- ║  (2) FLASHEO · línea marcada «FLASHEO» (sección 3). Solo clasifica   ║
-- ║  sesiones que todavía no tienen calibration_id. Todas las que hay    ║
-- ║  ya la tienen, y desde la 1.8.0 las nuevas nacen clasificadas por    ║
-- ║  el K_CAL que reporta el equipo. Dejala como está.                  ║
-- ║                                                                     ║
-- ║  (3) LISTA · línea marcada «LISTA» (sección 3b). Sesiones medidas    ║
-- ║  en una placa cuyo hardware NO coincide con el firmware que tenía    ║
-- ║  cargado: (paciente, sesión, calibración del firmware, de la placa). ║
-- ║  Hoy: P-004 sesión 9 (27/09 · placa modificada · firmware rev 3) → 6.║
-- ║  Una sesión medida en una placa 3.1 con el firmware viejo va acá,    ║
-- ║  p. ej. ('P-00X', N, 5, 6). Las del firmware "1,1k" (calibración 4)  ║
-- ║  NO van: pasan solas a la placa 5.                                  ║
-- ║  Si te equivocás, se arregla: ver "CORREGIR UNA CLASIFICACIÓN MAL"   ║
-- ║  al final del archivo.                                              ║
-- ║                                                                     ║
-- ║  (4) TODAS · línea marcada «TODAS» (sección 1). Desde la rev 6 todo  ║
-- ║  firmware apunta a la placa 3.1 (6): todas las sesiones quedan en    ║
-- ║  esa escala. La alternativa, comentada abajo de esa línea, pasa a la ║
-- ║  6 solo las medidas con la placa modificada (firmware 4 y 5, desde   ║
-- ║  el 27/09) y deja las de las placas originales en la 3.              ║
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
      'Cambios de hardware: RfAD1 ~9,5k, rhpad1 500->1k, R8 8,2k, R9 2,2k, CHP1 y CHP2 cambiados. Las cuatro del Howland siguen en 10k: el 8,06k de la hoja era una lectura EN CIRCUITO (10k en paralelo con RfAD1+RiAD1+rhpad1+3x10k = 41,5k), no el valor del componente. La ganancia total 517,9 sale de INAout (14 mVpp) por la ganancia de catalogo del INA122 (5 con Rg abierto), NO del diferencial anotado en la hoja: ese diferencial (5 mVpp) implicaria G_INA=2,8, imposible. Si se confirmara, K seria 0,1159. LIMITACION: el deficit del detector paso de 277 a 169 mV a la misma amplitud entre el 04/09 y el 15/09 (~1 ohm de offset). Sigue pendiente la calibracion con resistencias patron.'),
  (4, 'firmware "R9 1,1k" (rev 4, derivada) · la placa real es la 5', 0.33350, 0.169, 0.000322, 1035.8,
      'constantes que se cargaron en el firmware (R9_OHM 1100) creyendo que la placa modificada tenia R9 = 1,1k. Derivadas de rev 3 con K x 2, nunca medidas.',
      date '2026-09-27',
      'La placa nunca tuvo 1,1k: R9 es 1,2k (SMD 1201, 1185 ohm con tester, 09/10/2026). Esta fila existe solo para saber con que constantes calculo el firmware las sesiones que la reportan; su placa real es la calibracion 5 (columna hw_id).'),
  (5, 'R9 1,2k (rev 5, medida 2026-10-09)', 0.34200, 0.230, 0.0003285, 1041.1,
      'sobre Luca, osciloscopio de mano: U3 pata 1 = 3,29 Vpp (Vrms 1,16) -> I = 328 uA pp con el Howland de 10k · U5B 0,11 Vpp · U4 pata 14 2,29 Vpp -> cadena U5B..U4D x20,8 · K = I x 5 (INA) x 10 (U5B) x 20,8 · deficit = Vpp14/2 - Vadc en tres tandas (0,215 a 0,245)',
      date '2026-09-27',
      'Placa con R9 = 1,2k desde el 27/09/2026 (confirmado 09/10: SMD 1201, 1160 ohm de U4 pata 8 a 13 con soldaduras). La cadena cierra con los valores impresos: U4A 1,013 x U4B 3,19 x U4C 0,82 (CLP2 = 270 p) x U4D 8,15 = 21,6 contra 20,8 medido. Corriente 328 uA: confirma rev 3 (322) y descarta los 400 uA, que eran 3,22 V / 8,06k (lectura en circuito). LIMITACION: a 20 mV/div el osciloscopio marca 0,11 V en U5B pero la traza mide ~0,086 V; con 0,086 K seria 0,436. Incertidumbre ~12 %. Rango: 1,35 a ~13 ohm. Pendiente: resistencias patron de 2 a 12 ohm.'),
  (6, 'Placa 3.1 (rev 6, validada con 120 ohm)', 0.01800, 0.260, 0.000338, 53.2,
      'laboratorio, resistencia fija de 120 ohm: entrada del INA 40,6 mVpp -> I = 338 uA pp · U5A 207 mVpp · U5B 307 (x1,48) · U4A 328 (x1,07) · U4B 1,12 Vpp (x3,39) · U4C 912 mVpp (x0,82) · U4 pata 14 2,160 Vpp (x2,37) · Vout 820 mV con tester · K = Vpp14 / R = 2,160 / 120 · deficit = 1,080 - 0,820',
      null,
      'Placa 3.1, oct 2026, en todas las placas: R2 10k -> 1,5k (U5B x1,5), R9 -> 2k y R10 10k -> 4,7k (U4D x2,35). Ganancia total 53,2 (antes ~1040): ~20 veces menos. K cierra por los dos lados: 2,160/120 = 0,01800 y 338 uA x 53,2 = 0,01798. Rango: 29 ohm (Vadc = 0) a ~250 ohm (Vadc 2,0 V). LIMITACION: un solo punto de calibracion; el deficit de un detector de diodos no es constante con la amplitud, asi que lejos de 120 ohm el error puede crecer. Vout medido con tester y no por el ADC del micro. Pendiente: dos o mas resistencias fijas (p. ej. 47, 100, 220 ohm) para ajustar la recta y medir el residuo. Desde el 24/10 es la escala de TODAS las sesiones (hw_id de todas las demas = 6): la placa con la que se midio tenia un componente que no amplificaba. El 09/10 (U3 328 uA, U5B 0,11 Vpp, pata 14 2,29 Vpp) cierra con U5B en x0,53: ganancia ~55 contra 53,2.')
on conflict (id) do update set
  label  = excluded.label,  k_cal      = excluded.k_cal,   v_detector = excluded.v_detector,
  i_pp_a = excluded.i_pp_a, g_receiver = excluded.g_receiver,
  method = excluded.method, valid_from = excluded.valid_from, notes = excluded.notes;

-- Placa real segun el firmware que reporto la sesion. Null = la misma.
-- Rev 6 (24/10/2026): TODO firmware apunta a la placa 3.1 (6). La placa con
-- la que se midio tenia un componente que no amplificaba: la ganancia real
-- era mucho menor que la que suponia cada firmware, y la de la 3.1 es la que
-- coincide con lo medido el 09/10. Ademas hoy todas las placas son 3.1: una
-- sesion nueva con un firmware viejo tambien se mide en una 3.1.
alter table public.calibrations
  add column if not exists hw_id smallint references public.calibrations(id);
comment on column public.calibrations.hw_id is
  'Si el firmware reporto esta calibracion, la placa real es esta otra. Null = la misma. Desde la rev 6 todo firmware apunta a la 6 (placa 3.1).';
update public.calibrations set hw_id = case when id = 6 then null else 6 end;          -- ◀── TODAS
-- Alternativa: solo la placa modificada (firmware 4 y 5) a la 3.1; las placas
-- originales quedan en la 3. Para pasar de una a otra, poner
-- calibration_hw_id = null en sessions y volver a correr el archivo entero.
-- update public.calibrations set hw_id = case when id in (4, 5) then 6 else null end;

-- La referencia la fija ESTE archivo. Desde la rev 4 es solo la calibracion
-- que se SUPONE cuando el equipo no reporto la suya; la escala de cada sesion
-- la da su placa (calibration_hw_id, seccion 3b). Van dos sentencias y no una
-- porque el indice unico parcial no tolera dos referencias ni siquiera a
-- mitad de un UPDATE.
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
  add column if not exists k_cal_firmware        numeric,
  add column if not exists v_detector_firmware   numeric,
  add column if not exists calibration_matched   boolean,
  add column if not exists calibration_id        smallint references public.calibrations(id),
  add column if not exists calibration_shown     smallint references public.calibrations(id),
  add column if not exists calibration_hw_id     smallint references public.calibrations(id),
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
  'Constantes con las que el FIRMWARE calculo Z al medir esta sesion. Hecho historico: no cambia nunca. El hardware real va en calibration_hw_id.';
comment on column public.sessions.calibration_shown is
  'Escala en la que estan HOY las columnas de impedancia de esta sesion.';
comment on column public.sessions.calibration_hw_id is
  'Calibracion que describe la PLACA con la que se midio (hardware real). Normalmente igual a calibration_id; distinta cuando se modifico la placa y no se actualizo el firmware. Las columnas de impedancia quedan en esta escala.';
comment on column public.sessions.adc_lineal_asumido is
  'true = firmware anterior a v1.6.0 (2026-08-03): el ADC se leia como lineal y el del ESP32-C3 no lo es. La conversion de escala para estas sesiones es APROXIMADA.';
comment on column public.measurements.impedance_raw is
  'Impedancia tal como la mando el equipo, en la escala de sessions.calibration_id. NUNCA se pisa: toda recalibracion se calcula desde aca.';
comment on column public.sessions.k_cal_firmware is
  'K_CAL que reporto el equipo en el STATUS al momento de medir. Es el dato duro de con que constante se calculo esta sesion.';
comment on column public.sessions.calibration_matched is
  'true = calibration_id salio de matchear k_cal_firmware contra el catalogo. false = el firmware no lo reporto (anterior a 1.8.0) o no coincidio con ninguna, y la etiqueta es una SUPOSICION.';
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

-- De acá en más, lo que entre nace etiquetado con el K_CAL que reporta el
-- equipo (o, si no lo reporta, con la referencia y marcado como suposicion).
-- Va por trigger y no por DEFAULT: un default es un numero fijo que hay que
-- acordarse de mover en cada recalibracion, y olvidarselo etiqueta mal las
-- sesiones nuevas sin que nadie se entere.
alter table public.sessions alter column calibration_id drop default;

create or replace function public.set_calibration_id()
returns trigger language plpgsql security definer set search_path = public as $fn$
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
$fn$;

drop trigger if exists trg_calibration_id on public.sessions;
create trigger trg_calibration_id
  before insert on public.sessions
  for each row execute function public.set_calibration_id();

-- Hasta la v1.6.0 (2026-08-03) el firmware leía el ADC como
-- analogRead()*3.3/4095, asumiendo linealidad. El ADC del ESP32-C3 no es
-- lineal y su error depende del punto de trabajo, así que NO se deshace con
-- una recta: para esas sesiones la conversión es aproximada.
-- Ninguna de las sesiones existentes reporto su calibracion: quedaron
-- etiquetadas por fecha, que es una suposicion. Que se vea.
update public.sessions set calibration_matched = false where calibration_matched is null;

-- Sesiones que reportaron su K_CAL cuando esa calibracion todavia no estaba
-- en el catalogo: el trigger las mando a la referencia como suposicion. El
-- K_CAL reportado es el dato duro, asi que se reclasifican por el y se les
-- borra la placa para que la 3b la vuelva a asignar.
update public.sessions s
   set calibration_id      = c.id,
       calibration_matched = true,
       calibration_hw_id   = null
  from public.calibrations c
 where s.k_cal_firmware is not null
   and s.calibration_matched is distinct from true
   and abs(c.k_cal - s.k_cal_firmware) <= 0.001 * s.k_cal_firmware;

update public.sessions
   set adc_lineal_asumido = true
 where created_at < timestamptz '2026-08-03 00:00:00-03:00'
   and adc_lineal_asumido is distinct from true;


-- ─── 3b · CON QUÉ PLACA SE MIDIÓ CADA SESIÓN ───────────────────────────
-- Hasta el 27/09 una sola calibración alcanzaba para todo. Ese día se
-- cambió R9 de 2,2k a 1,2k (U4D pasa de x4,4 a x8,2; se registró como 1,1k
-- hasta el 09/10) y se midió P-004 s9 con el firmware todavía en rev 3: el
-- equipo convirtió con la mitad de la ganancia real y quedó ~al doble.
--
-- Regla general, solo para filas sin asignar (una re-corrida no pisa nada):
--   · firmware con constantes de diseño (1) → placa rev 3. Es lo que ya se
--     venía mostrando y lo que se confirmó el 28/09 ("las anteriores están
--     bien"). OJO: esas sesiones son del 02/09 o antes, previas al ajuste
--     del Howland del 14/09. Si esa placa resultara ser la del banco del
--     04/09, cambiar el 3 por 2 acá abajo, poner calibration_hw_id = null en
--     esas sesiones y volver a correr.
--   · resto → la que diga el catálogo para ese firmware (hw_id), o la misma.
update public.sessions s
   set calibration_hw_id = case when s.calibration_id = 1 then 3
                                else coalesce(c.hw_id, c.id) end
  from public.calibrations c
 where c.id = s.calibration_id
   and s.calibration_hw_id is null;

-- Firmware cuya placa real es otra según el catálogo (hw_id). Va SIEMPRE, no
-- solo en filas vacías: así un cambio en el catálogo llega a todas las
-- sesiones. Desde la rev 6 es todo firmware → placa 3.1 (6).
update public.sessions s
   set calibration_hw_id = c.hw_id
  from public.calibrations c
 where c.id = s.calibration_id
   and c.hw_id is not null
   and s.calibration_hw_id is distinct from c.hw_id;

-- Excepciones: placa modificada, firmware sin actualizar. Se aplica SIEMPRE
-- (no solo si está vacío), así esta lista es la única fuente de verdad.
-- Si no encuentra EXACTAMENTE las sesiones listadas, corta todo el script.
do $$
declare esperadas int; aplicadas int;
begin
  drop table if exists _placa_modificada;
  create temp table _placa_modificada (codigo text, nro int, cal_fw smallint, cal_hw smallint) on commit drop;
  -- (código de paciente, número de sesión, calibración con la que midió el
  -- FIRMWARE, calibración de la PLACA). La del firmware es un control: si la
  -- sesión no midió con esa, no se toca. Para agregar una sesión medida en
  -- una placa 3.1 con el firmware de R9 1,2k: ..., ('P-00X', N, 5, 6).
  -- En una base sin estas sesiones (instalación nueva), comentá la línea
  -- entera y la lista queda vacía.
  insert into _placa_modificada values ('P-004', 9, 3, 6);   -- ◀── LISTA

  select count(*) into esperadas from _placa_modificada;

  update public.sessions s
     set calibration_hw_id = l.cal_hw
    from _placa_modificada l
    join public.patients p on p.code = l.codigo
   where s.patient_id = p.id
     and s.session_number = l.nro
     and s.calibration_id = l.cal_fw;   -- solo si midió con ese firmware
  get diagnostics aplicadas = row_count;

  if aplicadas <> esperadas then
    raise exception 'LISTA de placa modificada: esperaba % sesion(es) y encontre % con el paciente, el numero y el firmware indicados. No se aplico NADA.', esperadas, aplicadas;
  end if;
  raise notice 'Placa modificada: % sesion(es) reasignadas.', aplicadas;
end $$;


-- ─── 4 · REESCALAR ─────────────────────────────────────────────────────
-- Un solo bloque atómico: o se aplica entero o no se aplica nada, sea cual
-- sea el cliente desde el que se corra.
--
-- Cada sesión va de SU firmware (f = calibration_id) a SU placa
-- (h = calibration_hw_id). Si son la misma calibración, el factor da 1 y el
-- offset 0: el valor queda igual al original, que es lo correcto.

do $$
declare
  r_id  smallint;
  n_ses int;
  n_mea int;
  n_evt int;
  n_sin int;
  n_edi int := 0;
begin
  select id into r_id from public.calibrations where is_reference;
  if r_id is null then
    raise exception 'No hay ninguna calibracion marcada como referencia (calibrations.is_reference).';
  end if;

  select count(*) into n_sin from public.sessions
   where calibration_id is null or calibration_hw_id is null;
  if n_sin > 0 then
    raise exception '% sesion(es) sin calibration_id o calibration_hw_id. No se reescalo nada.', n_sin;
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
     set impedance = round((m.impedance_raw * (f.k_cal / h.k_cal) + 2*(h.v_detector - f.v_detector)/h.k_cal)::numeric, 4),
         rate      = round((m.rate_raw      * (f.k_cal / h.k_cal))::numeric, 4)
    from public.sessions s
    join public.calibrations f on f.id = s.calibration_id
    join public.calibrations h on h.id = s.calibration_hw_id
   where m.session_id = s.id;
  get diagnostics n_mea = row_count;

  update public.session_events e
     set impedance = round((e.impedance_raw * (f.k_cal / h.k_cal) + 2*(h.v_detector - f.v_detector)/h.k_cal)::numeric, 4),
         -- OJO · en kind='gap', impedance_change guarda la DURACION del
         -- hueco en SEGUNDOS, no una impedancia. No se convierte.
         impedance_change = case when e.kind = 'gap' then e.impedance_change_raw
                                 else round((e.impedance_change_raw * (f.k_cal / h.k_cal))::numeric, 4) end
    from public.sessions s
    join public.calibrations f on f.id = s.calibration_id
    join public.calibrations h on h.id = s.calibration_hw_id
   where e.session_id = s.id;
  get diagnostics n_evt = row_count;

  -- 4.c · `calibration_shown` queda informando en qué escala están las
  --        columnas después de esta corrida: la de la placa.
  update public.sessions s
     set initial_impedance = round((s.initial_impedance_raw * (f.k_cal / h.k_cal) + 2*(h.v_detector - f.v_detector)/h.k_cal)::numeric, 4),
         final_impedance   = round((s.final_impedance_raw   * (f.k_cal / h.k_cal) + 2*(h.v_detector - f.v_detector)/h.k_cal)::numeric, 4),
         calibration_shown = s.calibration_hw_id
    from public.calibrations f, public.calibrations h
   where f.id = s.calibration_id
     and h.id = s.calibration_hw_id;
  get diagnostics n_ses = row_count;

  -- 4.d · ediciones de sesiones (sql/edicion_sesiones.sql, app 1.10.0).
  --       Misma conversión, desde el `impedance_raw` de la serie editada,
  --       que la función guardar_edicion_sesion() llena al activarla. Va con
  --       EXECUTE porque en una base sin ediciones esas tablas no existen.
  if to_regclass('public.measurements_edited') is not null then
    execute $q$
      update public.measurements_edited m
         set impedance = m.impedance_raw * (f.k_cal / h.k_cal) + 2*(h.v_detector - f.v_detector)/h.k_cal
        from public.sessions s
        join public.calibrations f on f.id = s.calibration_id
        join public.calibrations h on h.id = s.calibration_hw_id
       where m.session_id = s.id
         and m.impedance_raw is not null $q$;
    get diagnostics n_edi = row_count;
    execute $q$
      update public.session_edits e
         set initial_impedance = e.initial_impedance_raw * (f.k_cal / h.k_cal) + 2*(h.v_detector - f.v_detector)/h.k_cal,
             final_impedance   = e.final_impedance_raw   * (f.k_cal / h.k_cal) + 2*(h.v_detector - f.v_detector)/h.k_cal,
             escala            = s.calibration_hw_id
        from public.sessions s
        join public.calibrations f on f.id = s.calibration_id
        join public.calibrations h on h.id = s.calibration_hw_id
       where e.session_id = s.id $q$;
  end if;

  raise notice 'Recalculado desde _raw a la calibracion de cada placa: % sesiones, % muestras, % eventos, % muestras editadas.',
               n_ses, n_mea, n_evt, n_edi;
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
      -- impedancias YA en ohms de la placa con que se midio (calibration_hw_id)
      s.initial_impedance,
      s.final_impedance,
      round((s.final_impedance - s.initial_impedance)::numeric, 4) as delta_impedance,
      -- el original, para trazabilidad
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


-- Permisos de la vista (mantenimiento 10/10/2026). La vista se borra y se
-- vuelve a crear en cada corrida, y Supabase le da todos los permisos a la
-- clave pública a lo que se crea en `public`. Sin este bloque, cada corrida
-- de este archivo volvía a dejar el dataset legible con la clave pública.
do $$
begin
  revoke all on public.v_dataset_sesiones from anon;
  revoke insert, update, delete, truncate, references, trigger on public.v_dataset_sesiones from authenticated;
  if current_setting('server_version_num')::int >= 150000 then
    alter view public.v_dataset_sesiones set (security_invoker = true);
  else
    revoke all on public.v_dataset_sesiones from authenticated;
  end if;
end $$;


-- ─── 6 · REPORTE FINAL ─────────────────────────────────────────────────
-- Lo que devuelve el editor. Si algo salió mal, se ve acá.

select
  s.calibration_id                                        as firmware,
  s.calibration_hw_id                                     as placa,
  s.calibration_shown                                     as escala_actual,
  s.calibration_matched                                   as etiqueta_verificada,
  s.adc_lineal_asumido                                    as adc_aproximado,
  count(distinct s.id)                                    as sesiones,
  count(m.id)                                             as muestras,
  round(avg(m.impedance_raw)::numeric, 2)                 as z_original,
  round(avg(m.impedance)::numeric, 2)                     as z_calibrada,
  count(m.voltage_v)                                      as con_vadc
from public.sessions s
left join public.measurements m on m.session_id = s.id
group by 1, 2, 3, 4, 5
order by 1, 2, 3;


-- ═══════════════════════════════════════════════════════════════════════
--  CORREGIR UNA CLASIFICACIÓN MAL
--  Si una sesión quedó con la calibración equivocada, se arregla sin
--  pérdida: `_raw` nunca se pisó. Corregí la columna que corresponda y
--  volvé a correr el archivo entero; recalcula todo desde el original.
--
--   · el firmware usó otras constantes  → calibration_id
--   · la placa era otra                 → calibration_hw_id, o mejor, la
--                                          LISTA de la sección 3b
--
--   update public.sessions
--      set calibration_hw_id = 2
--    where created_at < timestamptz '2026-09-14 00:00:00-03:00';
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
--   -- y, si existen las ediciones (sql/edicion_sesiones.sql):
--   update public.measurements_edited set impedance = impedance_raw where impedance_raw is not null;
--   update public.session_edits       set initial_impedance = initial_impedance_raw,
--                                         final_impedance   = final_impedance_raw;
