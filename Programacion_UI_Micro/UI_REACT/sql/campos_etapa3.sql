-- ═══════════════════════════════════════════════════════════════════════
--  CHIDORI · Etapa III · campos nuevos para el etiquetado
--
--  Solo AGREGA filas al catálogo `field_definitions`: no migra tablas, no
--  toca sesiones ni mediciones. Los campos aparecen solos en la app y en el
--  panel de administración (scope = session), y `v_dataset_modelo` los trae
--  dentro de `datos_sesion`. Se puede correr de nuevo: si la clave ya existe,
--  no hace nada.
--
--  Correr en Supabase → SQL Editor. Ninguno es obligatorio: las sesiones
--  viejas quedan sin estos datos y el análisis lo tolera.
--
--  Por qué cada uno (detalle en Analisis_EDA/README.md):
--    estabilización   sin ella el gel se asienta y Z baja sola
--    micción previa   la basal supone vejiga vacía
--    hidratación      la orina diluida conduce menos → menos caída por ml
--    temp. de piel    la conductividad de los electrolitos cambia ~2 %/°C
--    pliegue          grasa entre electrodos y vejiga
--    sitio            permite sesiones de control fuera del abdomen
--    placa            hay más de una placa y el firmware no la identifica
-- ═══════════════════════════════════════════════════════════════════════

insert into public.field_definitions (scope, key, label, type, unit, options, required, sort_order, help)
values
  ('session', 'electrode_site',      'Sitio de los electrodos',        'select', null,
     '["Abdomen (protocolo)","Muslo (control)","Otro"]'::jsonb, false, 5,
     'Muslo = sesión de control: mismo protocolo, sin vejiga en el camino de la corriente.'),
  ('session', 'board_id',            'Placa usada (identificador)',     'text',   null, null, false, 6,
     'La que está escrita en la placa (p. ej. "placa 3"). Hoy la base sabe el firmware, no qué placa física se usó.'),
  ('session', 'stabilization_min',   'Estabilización antes de iniciar', 'number', 'min', null, false, 70,
     'Minutos desde que se pegaron los electrodos hasta tocar Iniciar.'),
  ('session', 'minutes_since_void',  'Minutos desde la última micción', 'number', 'min', null, false, 75,
     'Al tocar Iniciar.'),
  ('session', 'urine_color',         'Color de la orina previa (1–8)',  'select', null,
     '["1","2","3","4","5","6","7","8"]'::jsonb, false, 80,
     'Escala de color de orina (1 = muy clara, 8 = muy oscura) de la micción previa a la sesión.'),
  ('session', 'fluid_24h_ml',        'Líquido últimas 24 h (estimado)', 'number', 'ml', null, false, 85, null),
  ('session', 'hours_no_fluid',      'Horas sin tomar antes de iniciar', 'number', 'h', null, false, 90, null),
  ('session', 'caffeine_24h',        'Cafeína en las últimas 24 h',     'boolean', null, null, false, 95, 'Café, mate, té, energizantes.'),
  ('session', 'alcohol_24h',         'Alcohol en las últimas 24 h',     'boolean', null, null, false, 100, null),
  ('session', 'skin_temp_start_c',   'Temperatura de piel al inicio',   'number', '°C', null, false, 105,
     'Termómetro infrarrojo entre los electrodos de tensión.'),
  ('session', 'skin_temp_end_c',     'Temperatura de piel al final',    'number', '°C', null, false, 110, null),
  ('session', 'abd_skinfold_mm',     'Pliegue cutáneo abdominal',       'number', 'mm', null, false, 115,
     'Plicómetro, sobre la línea de electrodos.')
on conflict (scope, key) do nothing;

select key, label, type, unit, sort_order
  from public.field_definitions
 where scope = 'session'
 order by sort_order;
