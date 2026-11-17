#!/usr/bin/env node
'use strict';
// Diagnostico de los procesos pm2: estado + errores en los logs, con falsos positivos marcados.
// Solo LEE: no reinicia ni modifica nada. Pensado para correr en el servidor (thor).
//
//   node diagnostico.js                      revisa las ultimas 100 lineas de cada log
//   node diagnostico.js --watch              se repite cada 10 s (Ctrl+C para salir)
//   node diagnostico.js --lineas=500         mas lineas por log
//   node diagnostico.js --proceso=app-jobs   solo ese (o varios: a,b)
//   node diagnostico.js --sin-falsos         oculta los falsos positivos
//   node diagnostico.js --todo               lista TODAS las lineas, sin agrupar
//   node diagnostico.js --archivo=/ruta/log  agrega un log que no es de pm2 (se puede repetir)
//   node diagnostico.js --ayuda
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { amplio, clasifica, pista, sinColor, normaliza } = require('./reglas');

// Procesos que hacen las busquedas. El resto se agrupa como "otros".
const BUSQUEDAS = new Set([
  'cruce-principal',
  'cruce-secundario',
  'cruce-judiciales',
  'rues-search-by-queue',
  'orchestrator',
]);

function leeArgs(argv) {
  const o = { lineas: 100, ultimas: 5, falsos: 2, procesos: null, sinFalsos: false, todo: false, watch: 0, stdin: false, archivos: [] };
  for (const a of argv) {
    let m;
    if (a === '--ayuda' || a === '-h') {
      console.log(fs.readFileSync(__filename, 'utf8').split('\n').slice(2, 13).map((l) => l.replace(/^\/\/ ?/, '')).join('\n'));
      process.exit(0);
    } else if (a === '--stdin') o.stdin = true;
    else if (a === '--sin-falsos') o.sinFalsos = true;
    else if (a === '--todo') o.todo = true;
    else if (a === '--watch') o.watch = 10;
    else if ((m = a.match(/^--watch=(\d+)$/))) o.watch = Math.max(2, +m[1]);
    else if ((m = a.match(/^--lineas=(\d+)$/))) o.lineas = Math.max(1, +m[1]);
    else if ((m = a.match(/^--ultimas=(\d+)$/))) o.ultimas = Math.max(1, +m[1]);
    else if ((m = a.match(/^--proceso=(.+)$/))) o.procesos = m[1].split(',').map((s) => s.trim());
    else if ((m = a.match(/^--archivo=(.+)$/))) o.archivos.push(m[1]);
    else {
      console.error('Opcion desconocida: ' + a + '  (usa --ayuda)');
      process.exit(2);
    }
  }
  if (o.stdin && o.watch) {
    console.error('--stdin y --watch no se pueden combinar');
    process.exit(2);
  }
  return o;
}

const tty = process.stdout.isTTY && !process.env.NO_COLOR;
const color = (cod, s) => (tty ? `\x1b[${cod}m${s}\x1b[0m` : s);
const rojo = (s) => color(31, s);
const amarillo = (s) => color(33, s);
const verde = (s) => color(32, s);
const tenue = (s) => color(2, s);

// Ultimas n lineas de un archivo, leyendo como mucho 2 MB del final.
function cola(ruta, n) {
  try {
    const st = fs.statSync(ruta);
    const len = Math.min(st.size, 2 * 1024 * 1024);
    const buf = Buffer.alloc(len);
    const fd = fs.openSync(ruta, 'r');
    fs.readSync(fd, buf, 0, len, st.size - len);
    fs.closeSync(fd);
    return buf.toString('utf8').split(/\r?\n/).filter(Boolean).slice(-n).map(sinColor);
  } catch {
    return null; // no existe o no se puede leer
  }
}

function obtenLista(o) {
  let entrada;
  if (o.stdin) entrada = fs.readFileSync(0, 'utf8');
  else {
    try {
      entrada = execSync('pm2 jlist', { encoding: 'utf8', maxBuffer: 1 << 26, stdio: ['ignore', 'pipe', 'ignore'] });
    } catch (e) {
      console.error('No se pudo ejecutar "pm2 jlist" (¿pm2 instalado y con el usuario correcto?)');
      process.exit(1);
    }
  }
  // pm2 puede imprimir avisos como "[PM2] ..." antes del JSON: se busca "[{".
  const i = entrada.indexOf('[{');
  const lista = i < 0 ? [] : JSON.parse(entrada.slice(i));
  for (const f of o.archivos) {
    lista.push({ name: path.basename(f), archivo: true, pm2_env: { status: 'archivo', pm_out_log_path: f }, monit: {} });
  }
  return o.procesos ? lista.filter((p) => o.procesos.includes(p.name)) : lista;
}

// Devuelve true si hay algo REAL (error, proceso caido).
function corre(o) {
  const lista = obtenLista(o);
  const filas = [];
  const conLineas = [];
  const caidos = [];
  const recientes = [];
  const sinLog = new Set();
  const limpios = [];
  let totalFalsos = 0;

  for (const p of lista) {
    const env = p.pm2_env || {};
    const esArchivo = !!p.archivo;
    const estado = env.status;
    const reinicios = env.restart_time || 0;
    const upMin = env.pm_uptime ? Math.round((Date.now() - env.pm_uptime) / 60000) : 0;

    let alerta = 'ok';
    if (esArchivo) alerta = '-';
    else if (estado !== 'online') {
      alerta = 'CAIDO';
      caidos.push(p.name);
    } else if (upMin < 5) {
      alerta = 'REINICIO RECIENTE';
      recientes.push(p.name);
    } else if (reinicios > 5) alerta = 'MUCHOS REINICIOS';

    const reales = [];
    const falsos = [];
    let leidas = 0;
    for (const ruta of [env.pm_err_log_path, env.pm_out_log_path]) {
      if (!ruta) continue;
      const lineas = cola(ruta, o.lineas);
      if (lineas === null) {
        sinLog.add(p.name);
        continue;
      }
      leidas += lineas.length;
      for (const l of lineas) {
        if (!amplio(l)) continue;
        const c = clasifica(l);
        if (c.real) reales.push(l);
        else falsos.push({ l, motivo: c.motivo });
      }
    }
    totalFalsos += falsos.length;

    let mostrarReales;
    if (o.todo) mostrarReales = reales.map((l) => [l, 1]);
    else {
      const grupos = new Map();
      for (const l of reales) {
        const k = normaliza(l);
        grupos.set(k, (grupos.get(k) || 0) + 1);
      }
      mostrarReales = [...grupos.entries()].sort((a, b) => b[1] - a[1]).slice(0, o.ultimas);
    }
    if (reales.length || (falsos.length && !o.sinFalsos)) {
      conLineas.push({
        nombre: p.name,
        reales: reales.length,
        falsos: falsos.length,
        mostrarReales,
        mostrarFalsos: o.sinFalsos ? [] : o.todo ? falsos : falsos.slice(-o.falsos),
      });
    }
    if (!reales.length && !(esArchivo ? false : estado !== 'online')) limpios.push(p.name);

    filas.push({
      nombre: p.name,
      estado,
      reinicios: esArchivo ? '-' : reinicios,
      uptime_min: esArchivo ? '-' : upMin,
      mem_MB: esArchivo ? '-' : Math.round(((p.monit && p.monit.memory) || 0) / 1048576),
      lineas_leidas: leidas,
      errores_REALES: reales.length,
      falsos_pos: falsos.length,
      alerta,
    });
  }

  console.log(`\n=== ESTADO  (${new Date().toLocaleString('es-CO')}) ===`);
  console.table(filas);

  const hayLineas = conLineas.length > 0;
  if (hayLineas) {
    console.log(`=== LINEAS MARCADAS (ultimas ${o.lineas} lineas de cada log) ===`);
    for (const c of conLineas) {
      console.log(`\n[${c.nombre}] ${c.reales} real(es), ${c.falsos} falso(s) positivo(s)`);
      for (const [m, n] of c.mostrarReales) {
        console.log(rojo(`  REAL x${n} | `) + corta(m));
        const h = pista(m);
        if (h) console.log(tenue('            pista: ' + h));
      }
      for (const f of c.mostrarFalsos) {
        console.log(amarillo('  FALSO     | ') + tenue(corta(f.l)));
        console.log(tenue('            -> ' + f.motivo));
      }
    }
    console.log('');
  }

  const L = (a) => (a.length ? a.join(', ') : 'ninguno');
  const F = (c) => `${c.nombre} (${c.reales})`;
  const reales = conLineas.filter((c) => c.reales > 0);
  const bus = reales.filter((c) => BUSQUEDAS.has(c.nombre));
  const otros = reales.filter((c) => !BUSQUEDAS.has(c.nombre));

  console.log('=== RESUMEN (solo cuentan las REALES) ===');
  console.log('CAIDOS:                  ' + L(caidos));
  console.log('REINICIO RECIENTE (<5m): ' + L(recientes));
  console.log('ERROR en busquedas:      ' + L(bus.map(F)));
  console.log('ERROR en otros:          ' + L(otros.map(F)));
  console.log('Sin errores reales:      ' + L(limpios));
  console.log('Falsos positivos ignorados: ' + totalFalsos);
  if (sinLog.size) console.log('SIN LOG LEGIBLE:         ' + [...sinLog].join(', '));

  const problema = reales.length > 0 || caidos.length > 0;
  console.log(
    problema
      ? '\n' + rojo('>> ATENCION: error en ' + L([...new Set([...caidos, ...reales.map((c) => c.nombre)])]))
      : '\n' + verde('>> Todo en orden: sin caidos ni errores reales en las lineas revisadas.'),
  );
  return problema;
}

const corta = (l) => (l.length > 200 ? l.slice(0, 200) + '...' : l);

const o = leeArgs(process.argv.slice(2));
if (o.watch) {
  const tick = () => {
    process.stdout.write('\x1Bc');
    corre(o);
    console.log(tenue(`\nSe actualiza cada ${o.watch} s. Ctrl+C para salir.`));
  };
  tick();
  setInterval(tick, o.watch * 1000);
} else {
  process.exitCode = corre(o) ? 1 : 0;
}
