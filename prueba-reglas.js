'use strict';
// Prueba de las reglas con lineas REALES vistas en thor.
// Uso: node prueba-reglas.js   (sale con codigo 1 si algun caso falla)
const { amplio, clasifica } = require('./reglas');

// [linea, esperado]  esperado: 'real' | 'falso' | 'nada' (ni se marca)
const CASOS = [
  ['[Nest] 2554368  - 11/17/2026, 5:38:15 PM     LOG [RouterExplorer] Mapped {/terrorist-data/sync, POST} route +0ms', 'falso'],
  ['provisioning_error: null,', 'falso'],
  ['WorkspaceConnectionEntity {', 'nada'],
  ['2026-11-17 18:30:01,501 [INFO] df -h (tmpfs):', 'falso'],
  ['[Nest] LOG [CronManagerService] process_workspace_emails: terminó en 503 ms', 'falso'],
  ['[Nest] LOG [CronManagerService] trigger_rues_failed_queue: terminó en 5 ms', 'falso'],
  ['[Cron] === Iniciando ciclo sobre RUES_API_CALL_FAILED ===', 'falso'],
  ['[Nest] LOG [GeneratePendingPdfsTask] PDFs: 0 generados, 222 con error', 'real'],
  ['[Nest] LOG [GeneratePendingPdfsTask] PDFs: 5 generados, 0 con error', 'falso'],
  ['[Nest] WARN [GeneratePendingPdfsTask] [X] PDF del caso 2f31c0b2 falló: api-reportes respondió 404: {"allow":false}', 'real'],
  ['[Cron] → Reintentando RUES para 901601841 (falló originalmente en: getInfo)', 'real'],
  ['WARN [AccessGuard] 403 dependencia: x@y (ADMIN, dep a) pidio b en GET /dependences', 'real'],
  ['HttpException: request failed with status 502 en /pdf', 'real'],
  ['Error: ECONNREFUSED 10.0.0.1:443', 'real'],
  ['[Nest] LOG [NestApplication] Nest application successfully started +1ms', 'nada'],
  ['WebSocket connection failed: Unexpected response code: 502', 'real'],
];

let fallos = 0;
for (const [linea, esperado] of CASOS) {
  let obtenido;
  if (!amplio(linea)) obtenido = 'nada';
  else obtenido = clasifica(linea).real ? 'real' : 'falso';
  if (obtenido !== esperado) {
    fallos++;
    console.log(`FALLA: esperaba ${esperado}, dio ${obtenido} -> ${linea}`);
  }
}
console.log(fallos ? `${fallos} caso(s) fallaron de ${CASOS.length}` : `OK: ${CASOS.length} casos`);
process.exit(fallos ? 1 : 0);
