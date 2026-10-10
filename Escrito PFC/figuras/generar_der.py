"""Genera el DER de la base de Chidori como archivo de draw.io (.drawio)."""
from xml.sax.saxutils import escape

W, H0, RH = 320, 28, 20          # ancho de tabla, alto de encabezado, alto de fila
ENT = ("swimlane;fontStyle=1;childLayout=stackLayout;horizontal=1;startSize=28;horizontalStack=0;"
       "resizeParent=1;resizeParentMax=0;resizeLast=0;collapsible=0;marginBottom=0;html=1;"
       "fillColor=#E8E8E8;strokeColor=#333333;swimlaneFillColor=#FFFFFF;fontSize=14;fontFamily=Helvetica;")
ROW = ("text;strokeColor=none;fillColor=none;align=left;verticalAlign=middle;spacingLeft=6;spacingRight=4;"
       "overflow=hidden;rotatable=0;points=[[0,0.5],[1,0.5]];portConstraint=eastwest;html=1;"
       "fontSize=13;fontFamily=Courier New;")
ER = ("edgeStyle=entityRelationEdgeStyle;html=1;strokeColor=#333333;fontSize=10;fontFamily=Helvetica;"
      "endFill=0;startFill=0;labelBackgroundColor=#FFFFFF;")
DASH = ("edgeStyle=orthogonalEdgeStyle;html=1;dashed=1;endArrow=open;endFill=0;strokeColor=#808080;"
        "fontSize=10;fontColor=#606060;fontFamily=Helvetica;labelBackgroundColor=#FFFFFF;rounded=0;")

# (id, título, x, y, filas) · fila = (clave, nombre, tipo, nota)
ENTIDADES = [
  ("users", "auth.users  (Supabase Auth)", 40, 40, [
    ("PK", "id", "uuid", ""), ("", "email", "text", "")]),
  ("profiles", "profiles", 40, 145, [
    ("PK,FK", "id", "uuid", ""), ("", "email", "text", ""), ("", "display_name", "text", ""),
    ("", "role", "text", ""), ("", "is_approved", "boolean", ""), ("", "created_at", "timestamptz", "")]),
  ("patients", "patients", 40, 330, [
    ("PK", "id", "uuid", ""), ("UQ", "code", "text", "P-001"), ("", "first_name", "text", ""),
    ("", "last_name", "text", ""), ("", "data", "jsonb", ""), ("", "notes", "text", ""),
    ("", "active", "boolean", ""), ("FK", "created_by", "uuid", ""), ("", "created_at", "timestamptz", "")]),
  ("fields", "field_definitions", 40, 575, [
    ("PK", "id", "uuid", ""), ("UQ", "scope", "text", ""), ("UQ", "key", "text", ""),
    ("", "label", "text", ""), ("", "type", "text", ""), ("", "unit", "text", ""),
    ("", "options", "jsonb", ""), ("", "required", "boolean", ""), ("", "active", "boolean", ""),
    ("", "sort_order", "integer", "")]),
  ("sessions", "sessions", 470, 40, [
    ("PK", "id", "uuid", ""), ("FK", "user_id", "uuid", ""), ("", "created_at", "timestamptz", ""),
    ("", "elapsed_time_str", "text", ""), ("", "total_events", "integer", ""), ("", "notes", "text", ""),
    ("", "initial_impedance", "float8", ""), ("", "final_impedance", "float8", ""),
    ("", "initial_impedance_raw", "numeric", ""), ("", "final_impedance_raw", "numeric", ""),
    ("FK", "calibration_id", "smallint", ""), ("FK", "calibration_hw_id", "smallint", ""),
    ("FK", "calibration_shown", "smallint", ""), ("", "calibration_matched", "boolean", ""),
    ("", "k_cal_firmware", "numeric", ""), ("", "v_detector_firmware", "numeric", ""),
    ("", "adc_lineal_asumido", "boolean", ""), ("", "is_public", "boolean", ""),
    ("", "is_featured", "boolean", ""), ("FK", "patient_id", "uuid", ""),
    ("UQ", "session_number", "integer", ""), ("", "session_data", "jsonb", "")]),
  ("measurements", "measurements", 900, 40, [
    ("PK", "id", "uuid", ""), ("FK", "session_id", "uuid", ""), ("", "elapsed_time", "float8", ""),
    ("", "impedance", "float8", ""), ("", "impedance_raw", "numeric", ""), ("", "rate", "float8", ""),
    ("", "rate_raw", "numeric", ""), ("", "voltage_v", "numeric", ""), ("", "created_at", "timestamptz", "")]),
  ("events", "session_events", 900, 285, [
    ("PK", "id", "uuid", ""), ("FK", "session_id", "uuid", ""), ("", "event_number", "integer", ""),
    ("", "elapsed_time", "float8", ""), ("", "kind", "text", ""), ("", "impedance", "float8", ""),
    ("", "impedance_raw", "numeric", ""), ("", "impedance_change", "float8", ""),
    ("", "impedance_change_raw", "numeric", ""), ("", "amount_ml", "numeric", ""),
    ("", "created_at", "timestamptz", "")]),
  ("cal", "calibrations", 900, 575, [
    ("PK", "id", "smallint", ""), ("", "label", "text", ""), ("", "k_cal", "numeric", ""),
    ("", "v_detector", "numeric", ""), ("", "i_pp_a", "numeric", ""), ("", "g_receiver", "numeric", ""),
    ("", "method", "text", ""), ("", "valid_from", "date", ""), ("", "notes", "text", ""),
    ("UQ", "is_reference", "boolean", ""), ("FK", "hw_id", "smallint", "")]),
]

# (origen, destino, marca en origen, marca en destino, sale por, entra por, carril x)
RELACIONES = [
  ("users.id", "sessions.user_id",          "ERzeroToOne", "ERzeroToMany", 1, 0, 415),
  ("users.id", "profiles.id",               "ERmandOne",   "ERmandOne",    1, 1, 380),
  ("users.id", "patients.created_by",       "ERzeroToOne", "ERzeroToMany", 1, 1, 395),
  ("patients.id", "sessions.patient_id",    "ERzeroToOne", "ERzeroToMany", 1, 0, 435),
  ("sessions.id", "measurements.session_id", "ERmandOne",  "ERzeroToMany", 1, 0, 862),
  ("sessions.id", "events.session_id",      "ERmandOne",   "ERzeroToMany", 1, 0, 880),
  ("cal.id", "sessions.calibration_id",     "ERzeroToOne", "ERzeroToMany", 0, 1, 815),
  ("cal.id", "sessions.calibration_hw_id",  "ERzeroToOne", "ERzeroToMany", 0, 1, 830),
  ("cal.id", "sessions.calibration_shown",  "ERzeroToOne", "ERzeroToMany", 0, 1, 845),
]
ORTO = ("edgeStyle=orthogonalEdgeStyle;rounded=0;html=1;strokeColor=#333333;fontSize=10;fontFamily=Helvetica;"
        "endFill=0;startFill=0;startSize=10;endSize=10;")

def fila_txt(k, n, t, nota):
    clave = f"<b>{k}</b>" if k else ""
    nombre = f"<b>{escape(n)}</b>" if "PK" in k else escape(n)
    extra = f" <font color='#808080'>({escape(nota)})</font>" if nota else ""
    return f"{clave:>0}{'&nbsp;' * max(1, 7 - len(k))}{nombre} : <font color='#606060'>{t}</font>{extra}"

cells = ['<mxCell id="0"/>', '<mxCell id="1" parent="0"/>']
for eid, titulo, x, y, filas in ENTIDADES:
    h = H0 + RH * len(filas)
    cells.append(f'<mxCell id="{eid}" value="{escape(titulo)}" style="{ENT}" vertex="1" parent="1">'
                 f'<mxGeometry x="{x}" y="{y}" width="{W}" height="{h}" as="geometry"/></mxCell>')
    for i, (k, n, t, nota) in enumerate(filas):
        val = escape(fila_txt(k, n, t, nota), {'"': '&quot;'})
        st = ROW + ("fontStyle=0;" if "PK" not in k else "")
        cells.append(f'<mxCell id="{eid}.{n}" value="{val}" style="{st}" vertex="1" parent="{eid}">'
                     f'<mxGeometry y="{H0 + RH * i}" width="{W}" height="{RH}" as="geometry"/></mxCell>')

geo = {}
for eid, titulo, x, y, filas in ENTIDADES:
    for i, f in enumerate(filas):
        geo[f"{eid}.{f[1]}"] = (x, x + W, y + H0 + RH * i + RH / 2)

def arista(cid, src, dst, ma, mb, so, ei, carril, estilo, valor=""):
    sy, dy = geo[src][2], geo[dst][2]
    st = (f"{estilo}startArrow={ma};endArrow={mb};exitX={so};exitY=0.5;exitDx=0;exitDy=0;"
          f"entryX={ei};entryY=0.5;entryDx=0;entryDy=0;")
    return (f'<mxCell id="{cid}" value="{escape(valor)}" style="{st}" edge="1" parent="1" source="{src}" target="{dst}">'
            f'<mxGeometry relative="1" as="geometry"><Array as="points">'
            f'<mxPoint x="{carril}" y="{sy}"/><mxPoint x="{carril}" y="{dy}"/></Array></mxGeometry></mxCell>')

for i, (src, dst, ma, mb, so, ei, carril) in enumerate(RELACIONES):
    cells.append(arista(f"r{i}", src, dst, ma, mb, so, ei, carril, ORTO))

# Autorrelación de calibrations (hw_id → id), por el costado derecho
cells.append(arista("rself", "cal.hw_id", "cal.id", "ERzeroToMany", "ERzeroToOne", 1, 1, 1245, ORTO))

# Relaciones lógicas (no son claves foráneas): el catálogo define las claves de los JSONB
DASH2 = ("edgeStyle=orthogonalEdgeStyle;rounded=0;html=1;dashed=1;strokeColor=#808080;fontSize=10;"
         "fontColor=#606060;fontFamily=Helvetica;labelBackgroundColor=#FFFFFF;endFill=0;")
cells.append(arista("d1", "fields.key", "patients.data", "none", "open", 0, 0, 18, DASH2))
cells.append(arista("d2", "fields.scope", "sessions.session_data", "none", "open", 1, 0, 450, DASH2))

# Leyenda
ley = ("<b>Notación</b><br>PK clave primaria · FK clave foránea<br>UQ parte de una restricción única<br>"
       "Pata de gallo: muchos · barra: uno<br>círculo: opcional<br>"
       "Línea punteada: relación lógica (el catálogo<br>define las claves de los campos JSONB)<br><br>"
       "<b>Restricciones</b><br>"
       "sessions: único (patient_id, session_number)<br>"
       "field_definitions: único (scope, key)<br>"
       "calibrations: una sola con is_reference;<br>hw_id apunta a la placa real del firmware<br>"
       "measurements, session_events: borrado<br>en cascada con la sesión")
cells.append(f'<mxCell id="leyenda" value="{escape(ley, {chr(34): "&quot;"})}" style="text;html=1;align=left;'
             'verticalAlign=top;whiteSpace=wrap;spacing=10;strokeColor=#B3B3B3;fillColor=#FAFAFA;fontSize=12;'
             'fontFamily=Helvetica;rounded=0;" vertex="1" parent="1">'
             '<mxGeometry x="470" y="560" width="320" height="263" as="geometry"/></mxCell>')

xml = ('<mxfile host="app.diagrams.net"><diagram id="der-chidori" name="DER Chidori">'
       '<mxGraphModel dx="1400" dy="1000" grid="1" gridSize="10" guides="1" tooltips="1" connect="1" arrows="1" '
       'fold="1" page="1" pageScale="1" pageWidth="1270" pageHeight="850" math="0" shadow="0"><root>'
       + "".join(cells) + '</root></mxGraphModel></diagram></mxfile>')
open("der_base_datos.drawio", "w", encoding="utf-8").write(xml)
print("ok", len(cells), "celdas")
for eid, titulo, x, y, filas in ENTIDADES:
    print(f"{eid:12s} x={x} y={y} alto={H0 + RH*len(filas)} fin={y + H0 + RH*len(filas)}")
