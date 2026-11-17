# diagnostico-thor

Diagnóstico de los logs de todos los procesos de pm2 en el servidor (thor, la Sergio).
Revisa las últimas 100 líneas de cada log, muestra **solo lo que parece error** y marca
cada línea como **REAL** o **FALSO POSITIVO** (con el motivo).

- Solo **lee**: no reinicia, no borra y no modifica nada.
- Es un repo **local** (sin remoto). Se lleva a thor a mano con `scp`.
- Necesita `node` y `pm2` en el servidor (pm2 ya lo trae).

## Archivos

| Archivo | Para qué |
|---|---|
| `diagnostico.js` | El script que se ejecuta. |
| `reglas.js` | Decide qué es error real y qué es falso positivo, y las pistas. Aquí se agregan reglas nuevas. |
| `prueba-reglas.js` | Prueba con líneas reales ya vistas. Se corre después de tocar `reglas.js`. |

## 1. Llevarlo a thor

Desde PowerShell, en tu PC:

```bash
scp -r G:\USA\lexchains.co\diagnostico-thor root@168.228.124.134:~/
```

Si ya estaba copiado y solo cambió algo, el mismo comando lo sobrescribe.

## 2. Entrar a thor y ejecutarlo

```bash
ssh root@168.228.124.134
```

```bash
cd ~/diagnostico-thor && node diagnostico.js
```

## 3. Opciones

Todas se agregan después de `node diagnostico.js`.

| Opción | Qué hace |
|---|---|
| (ninguna) | Revisa las últimas 100 líneas de cada log de cada proceso. |
| `--watch` | Se repite cada 10 s. Con `--watch=5` cambia el intervalo. Ctrl+C para salir. |
| `--lineas=500` | Revisa más líneas por log. |
| `--proceso=app-jobs` | Solo ese proceso. Varios con coma: `--proceso=app-jobs,pdf-api`. |
| `--sin-falsos` | Oculta los falsos positivos y deja solo lo real. |
| `--todo` | Lista cada línea, sin agrupar las repetidas. |
| `--ultimas=10` | Cuántos mensajes distintos se muestran por proceso (por defecto 5). |
| `--archivo=/ruta/log` | Agrega un log que no es de pm2. Se puede repetir. |
| `--ayuda` | Muestra esta lista. |

Ejemplos listos para pegar:

```bash
node diagnostico.js --watch
```

```bash
node diagnostico.js --proceso=app-jobs,pdf-api --lineas=500
```

```bash
node diagnostico.js --sin-falsos
```

```bash
node diagnostico.js --archivo=/home/desarrollo/purge.log
```

El script termina con código 1 si hay algo real o un proceso caído, y con 0 si todo está en orden.

## 4. Cómo leer la salida

1. **ESTADO**: una tabla con estado, reinicios, uptime, memoria, `lineas_leidas`,
   `errores_REALES` y `falsos_pos`.
   - `CAIDO`: el proceso no está `online`.
   - `REINICIO RECIENTE`: lleva menos de 5 minutos arriba.
   - `MUCHOS REINICIOS`: más de 5 reinicios acumulados (es un contador histórico; revisa si sube).
2. **LINEAS MARCADAS**, por proceso:
   - `REAL x4 | …`: error real; `x4` es cuántas veces se repitió (ids y números largos se
     tratan como iguales para agrupar). Debajo, una `pista:` con qué mirar primero.
   - `FALSO | …` y debajo `-> motivo`: parecía error pero no lo es (un número suelto como
     `503 ms`, un campo `error: null`, un nombre como `RUES_API_CALL_FAILED`, la palabra `terrorist`).
3. **RESUMEN**: caídos, reinicios recientes, errores en búsquedas (los bots y el RUES),
   errores en otros, procesos sin errores reales y cuántos falsos positivos ignoró.
   La última línea dice `ATENCION: error en …` o `Todo en orden`.

Los procesos que cuentan como «búsquedas» son `cruce-principal`, `cruce-secundario`,
`cruce-judiciales`, `rues-search-by-queue` y `orchestrator` (lista `BUSQUEDAS` al inicio de `diagnostico.js`).

## 5. Agregar un falso positivo nuevo

1. Copia la línea que se marcó mal.
2. Agrega el caso en `prueba-reglas.js` con lo que **debería** dar (`'real'`, `'falso'` o `'nada'`).
3. Ajusta `clasifica()` en `reglas.js` hasta que la prueba pase.

En tu PC, antes de copiar a thor:

```bash
cd G:\USA\lexchains.co\diagnostico-thor; node prueba-reglas.js
```

Debe decir `OK: <n> casos`.

## 6. Comandos útiles de apoyo (solo lectura)

Estado rápido de todos los procesos:

```bash
pm2 list
```

Últimas líneas de error de un proceso (cambia `app-jobs` por el nombre):

```bash
pm2 logs app-jobs --err --nostream --lines 60
```

Qué `.env` de thor apuntan a producción de LexChains (enmascara las contraseñas; revisa
la salida antes de pegarla en un chat):

```bash
grep -niE 'lexchains\.co|142\.93\.59\.27' /home/desarrollo/*/.env | sed -E 's#(://[^:/@]+:)[^@]+@#\1***@#'
```

Comparar la `JWT_KEY` de dos servicios sin mostrarla (si las huellas son iguales, la clave es la misma):

```bash
for d in app-jobs reportes; do echo -n "$d: "; grep -h '^JWT_KEY=' /home/desarrollo/$d/.env | sha256sum | cut -c1-12; done
```

Ver en qué puerto escucha cada proceso:

```bash
ss -ltnp | grep node
```

## 7. Caso conocido: PDFs de la Sergio con 404 (17-nov-2026)

Cómo se vio y qué lo causaba, para reconocerlo si vuelve:

- **Síntoma:** en `app-jobs`, cada 15 minutos `PDFs: 0 generados, 222 con error`, y cada caso con
  `falló: api-reportes respondió 404: No se encontró el registro`.
- **Causa:** el `.env` de `app-jobs` en thor tenía `REPORTS_URL=https://reports.lexchains.co`
  (producción de LexChains), así que pedía los PDFs de la Sergio al servicio equivocado.
  `pdf-api` de thor escucha en el puerto 5000 y no recibía las peticiones.
- **Cómo se comprobó:**

```bash
grep -E '^REPORTS_URL=' /home/desarrollo/app-jobs/.env
```

```bash
pm2 logs pdf-api --nostream --lines 5000 | grep -F "<id-del-caso>"
```

  (sin líneas con el id del caso = la petición nunca llegó a `pdf-api`).
- **Corrección acordada:** `REPORTS_URL=http://127.0.0.1:5000` en el `.env` de `app-jobs` y
  `pm2 restart app-jobs --update-env`. Antes de cambiar el `.env`, hacer copia
  (`cp /home/desarrollo/app-jobs/.env /home/desarrollo/app-jobs/.env.bak-$(date +%F)`).
- **Verificación:** tras el siguiente ciclo (minutos :00, :15, :30 y :45) debe aparecer
  `PDFs: N generados, M con error`:

```bash
pm2 logs app-jobs --nostream --lines 300 | grep -E "PDFs:|Corrida cortada|casos listos" | tail -5
```

## Reglas del servidor para no equivocarse

- En thor **no** se edita código para «probar»: la configuración (`.env`) sí se ajusta a mano, con copia antes.
- Lo de la Sergio debe apuntar a lo de la Sergio y lo de LexChains a lo de LexChains.
  Lo único que apunta a producción a propósito es `rues-search-by-queue` (RabbitMQ y Mongo).
- No pegues contraseñas, claves ni tokens en chats: usa los comandos que enmascaran.
