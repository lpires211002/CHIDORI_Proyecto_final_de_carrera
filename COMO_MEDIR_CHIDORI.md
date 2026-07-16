# Cómo medir con Chidori — guía rápida (modo AP)

> **TL;DR:** enchufás el ESP → en la Mac te conectás a la red WiFi **`Chidori`** → abrís la UI (`localhost:5173`) con dirección **`192.168.4.1`** → listo.
> Si el serial dice **`clientesWS=1`**, estás conectado y midiendo.

El Chidori ahora funciona en **modo Access Point**: el ESP **crea su propia red WiFi**. No depende de ningún router, hotspot ni credenciales, y la IP es **siempre `192.168.4.1`**. Funciona igual en tu casa, en la facultad o donde sea.

---

## 1. Procedimiento para medir (cada vez)

1. **Enchufá el ESP** por USB a una fuente estable (cargador de pared o la compu). Esperá ~15 s.
2. En la **Mac**, abrí el WiFi y conectate a la red:
   - Red: **`Chidori`**
   - Contraseña: **`chidori123`**
   - *(Mientras estés en esta red, la Mac no tiene internet — es normal. La sync a la nube se hace después, cuando vuelvas a tu WiFi.)*
3. Levantá la app **en local**:
   ```bash
   cd "Programacion_UI_Micro /UI_REACT"
   npm run dev
   ```
   Abrí **http://localhost:5173**
4. En el panel de Configuración, la dirección ya viene en **`192.168.4.1`**, puerto **`81`**. Si dice DESCONECTADO, apretá **Reconectar**.
5. Confirmá en el serial: **`clientesWS=1`**.
6. Calibrá (vejiga vacía) e **Iniciá adquisición**.

---

## 2. Los dos caminos de datos (clave para no confundirse)

- **Serial** (cable USB → Arduino IDE): el ESP imprime `Z = ...` **siempre** que mide, lo dispares con el botón físico o con la app. **No depende del WiFi.**
- **App web** (red `Chidori` → WebSocket): la app recibe los datos por la red del AP.
- El indicador que manda para saber si la app está conectada es **`clientesWS`** en el serial: `1` = enganchada ✅, `0` = no ❌.

---

## 3. El botón físico

- **Arrancar:** un toque corto.
- **Frenar desde el botón:** mantenelo apretado **~1.5 s hasta que suene el beep**. Un roce o glitch no llega a 1.5 s, así que **no te corta una sesión** de horas.
- **Frenar desde la app:** instantáneo.

---

## 4. Si no conecta — checklist de 30 segundos

1. **¿La Mac está conectada a la red `Chidori`?** Es lo primero. Revisá el ícono de WiFi.
2. **¿El serial muestra `Access Point activo` e `ip=192.168.4.1`?** Si no, reseteá el ESP.
3. **Dirección en la UI = `192.168.4.1`, puerto `81`.** Si la cambiaste, volvé a ponerla y Guardar.
4. **Test de puerto** (Terminal, estando conectado a la red Chidori):
   ```bash
   nc -vz 192.168.4.1 81      # tiene que decir succeeded!
   ```
5. **Navegador trabado:** hard reload con `Cmd + Shift + R` y Reconectar.

---

## 5. Sesiones largas (4 h continuas)

- **Que la Mac NO se duerma.** Abrí una Terminal y dejá corriendo toda la sesión:
  ```bash
  caffeinate -dimsu
  ```
- Mac y ESP **enchufados a corriente estable** (el ESP, mejor a un cargador de pared que a un puerto USB flojo).
- Dejá **abiertos** el `npm run dev`, la pestaña del navegador y el **Serial Monitor** (el serial imprime cada `Z` por cable pase lo que pase → respaldo).
- La medición **no se frena** si hay cualquier hipo de WiFi; el AP está siempre activo.

---

## 6. Comandos útiles (Terminal de la Mac)

```bash
# ¿El WebSocket del ESP está abierto? (conectado a la red Chidori)
nc -vz 192.168.4.1 81

# Levantar la app
cd "Programacion_UI_Micro /UI_REACT" && npm run dev

# Mantener la Mac despierta durante una sesión larga
caffeinate -dimsu
```

---

## Resumen

- El ESP crea su red **`Chidori`** (clave `chidori123`). Conectás la Mac ahí.
- La UI siempre apunta a **`192.168.4.1 : 81`**. No cambia nunca.
- Sin internet en la Mac mientras medís (sync a la nube después).
- `clientesWS=1` en el serial = todo conectado.
