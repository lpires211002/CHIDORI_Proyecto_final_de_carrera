-- ═══════════════════════════════════════════════════════════════════════
--  CHIDORI · Mantenimiento · PASO 4 · Vista unificada del dataset
--
--  Crea una vista NUEVA, `v_dataset_modelo`: una fila por sesión con todo
--  lo que necesita el modelo, junto. No reemplaza ni borra `v_dataset` ni
--  `v_dataset_sesiones` (cada una tenía la mitad de la información):
--    · v_dataset          → paciente y campos, pero sin calibración
--    · v_dataset_sesiones → calibración, pero unida a `subjects` (vacía),
--                           sin código de paciente ni campos
--
--  · No toca datos: una vista no guarda nada, solo muestra las tablas.
--  · Se puede correr de nuevo cuando haga falta (create or replace +
--    permisos al final).
--  · Permisos: la clave pública no la ve; con una cuenta logueada respeta
--    RLS (el admin ve todas las sesiones, cada clínico solo las suyas).
--    Desde el SQL Editor de Supabase se ve todo.
--
--  Columnas:
--    identificación  session_id, paciente (P-00X), nro_sesion, fecha
--    campos          datos_paciente, datos_sesion (JSONB, claves definidas
--                    en field_definitions; en Python: pandas.json_normalize)
--    impedancia      z_inicial, z_final, delta_z (ohms de la placa con que
--                    se midió) y z_inicial_raw, z_final_raw (tal como los
--                    mandó el equipo)
--    calibración     cal_firmware, cal_placa, placa (nombre), cal_mostrada,
--                    cal_confirmada (el equipo reportó su K_CAL),
--                    k_cal_firmware, adc_lineal_asumido (anterior a v1.6.0)
--    sesión          duracion, n_muestras, t_ultima_muestra_s, notas
--    eventos         marcas, tomas_agua, agua_ml, micciones, miccion_ml,
--                    microcortes, segundos_perdidos, desconexiones
--
--  Al final muestra controles: la vista tiene que tener tantas filas como
--  `sessions` y tantas muestras como `measurements`.
-- ═══════════════════════════════════════════════════════════════════════

create or replace view public.v_dataset_modelo as
with muestras as (
  select session_id,
         count(*)          as n_muestras,
         max(elapsed_time) as t_ultima_muestra_s
    from public.measurements
   group by session_id
),
eventos as (
  select session_id,
         count(*) filter (where kind = 'mark')                       as marcas,
         count(*) filter (where kind = 'water')                      as tomas_agua,
         coalesce(sum(amount_ml) filter (where kind = 'water'), 0)   as agua_ml,
         count(*) filter (where kind = 'void')                       as micciones,
         coalesce(sum(amount_ml) filter (where kind = 'void'), 0)    as miccion_ml,
         count(*) filter (where kind = 'gap')                        as microcortes,
         -- en kind='gap', impedance_change guarda la duración del hueco en s
         coalesce(sum(impedance_change) filter (where kind = 'gap'), 0) as segundos_perdidos,
         count(*) filter (where kind = 'disconnect')                 as desconexiones
    from public.session_events
   group by session_id
)
select
  s.id                                                   as session_id,
  p.code                                                 as paciente,
  s.session_number                                       as nro_sesion,
  s.created_at                                           as fecha,
  coalesce(p.data, '{}'::jsonb)                          as datos_paciente,
  coalesce(s.session_data, '{}'::jsonb)                  as datos_sesion,
  s.initial_impedance                                    as z_inicial,
  s.final_impedance                                      as z_final,
  round((s.final_impedance - s.initial_impedance)::numeric, 4) as delta_z,
  s.initial_impedance_raw                                as z_inicial_raw,
  s.final_impedance_raw                                  as z_final_raw,
  s.calibration_id                                       as cal_firmware,
  s.calibration_hw_id                                    as cal_placa,
  h.label                                                as placa,
  s.calibration_shown                                    as cal_mostrada,
  s.calibration_matched                                  as cal_confirmada,
  s.k_cal_firmware,
  s.adc_lineal_asumido,
  s.elapsed_time_str                                     as duracion,
  coalesce(m.n_muestras, 0)                              as n_muestras,
  m.t_ultima_muestra_s,
  s.notes                                                as notas,
  coalesce(e.marcas, 0)                                  as marcas,
  coalesce(e.tomas_agua, 0)                              as tomas_agua,
  coalesce(e.agua_ml, 0)                                 as agua_ml,
  coalesce(e.micciones, 0)                               as micciones,
  coalesce(e.miccion_ml, 0)                              as miccion_ml,
  coalesce(e.microcortes, 0)                             as microcortes,
  coalesce(e.segundos_perdidos, 0)                       as segundos_perdidos,
  coalesce(e.desconexiones, 0)                           as desconexiones
from public.sessions s
left join public.patients     p on p.id = s.patient_id
left join public.calibrations h on h.id = s.calibration_hw_id
left join muestras            m on m.session_id = s.id
left join eventos             e on e.session_id = s.id
order by p.code nulls last, s.session_number, s.created_at;

comment on view public.v_dataset_modelo is
  'Una fila por sesion con paciente, campos (JSONB), impedancias en la escala de la placa, banderas de calibracion y resumen de eventos. Para exportar el dataset del modelo. Respeta RLS.';

-- Permisos · `create or replace` borra security_invoker y Supabase le da
-- todos los permisos a la clave pública a lo que se crea en `public`.
do $$
begin
  revoke all on public.v_dataset_modelo from anon;
  revoke insert, update, delete, truncate, references, trigger on public.v_dataset_modelo from authenticated;
  if current_setting('server_version_num')::int >= 150000 then
    alter view public.v_dataset_modelo set (security_invoker = true);
  else
    revoke all on public.v_dataset_modelo from authenticated;
  end if;
end $$;

-- ── Controles ──────────────────────────────────────────────────────────
select 'sesiones' as control,
       (select count(*) from public.v_dataset_modelo)::text as en_la_vista,
       (select count(*) from public.sessions)::text         as en_las_tablas,
       case when (select count(*) from public.v_dataset_modelo) = (select count(*) from public.sessions)
            then 'OK' else 'DIFERENTE · avisar' end         as estado
union all
select 'muestras',
       (select sum(n_muestras) from public.v_dataset_modelo)::text,
       (select count(*) from public.measurements)::text,
       case when (select sum(n_muestras) from public.v_dataset_modelo) = (select count(*) from public.measurements)
            then 'OK' else 'DIFERENTE · avisar (muestras sin sesión)' end
union all
select 'sesiones con paciente',
       (select count(*) from public.v_dataset_modelo where paciente is not null)::text,
       (select count(*) from public.sessions where patient_id is not null)::text,
       case when (select count(*) from public.v_dataset_modelo where paciente is not null)
               = (select count(*) from public.sessions where patient_id is not null)
            then 'OK' else 'DIFERENTE · avisar' end
union all
select 'sesiones sin calibración asignada',
       (select count(*) from public.v_dataset_modelo where cal_placa is null)::text,
       '0 esperado',
       case when (select count(*) from public.v_dataset_modelo where cal_placa is null) = 0
            then 'OK' else 'revisar' end
union all
select 'clave pública puede leerla',
       case when has_table_privilege('anon', 'public.v_dataset_modelo', 'select') then 'sí' else 'no' end,
       'no esperado',
       case when has_table_privilege('anon', 'public.v_dataset_modelo', 'select') then 'REVISAR' else 'OK' end;
