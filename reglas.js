'use strict';
// Reglas para decidir si una linea de log es un error REAL o un FALSO POSITIVO.
// Para agregar un falso positivo nuevo: edita clasifica() y agrega el caso en prueba-reglas.js.

// Palabras de error "de verdad". ECONN... va aparte y en mayuscula exacta,
// porque en minuscula coincidia con "Connection".
const fuerte = (l) =>
  /(error|exception|fatal|unhandled|out of memory|failed|fall.(?![a-z]))/i.test(l) ||
  /\b(ECONN\w+|ETIMEDOUT|ENOTFOUND|EADDRINUSE)\b/.test(l);

// Todo lo que PARECE error (se revisa, y luego clasifica() decide).
const amplio = (l) => fuerte(l) || /\b403\b|\b50[0-4]\b/.test(l);

// 50x solo cuenta como HTTP si hay contexto (status, code, "502 Bad Gateway"...).
const HTTP_CTX =
  /((status|http|code|responded with|respuesta)\D{0,20}\b50[0-4]\b|\b50[0-4]\s+(internal|bad gateway|service unavailable|gateway))/i;

// -> { real: true } o { real: false, motivo: '...' }
function clasifica(l) {
  if (/\b403\b/.test(l)) return { real: true }; // p. ej. "403 dependencia:" del AccessGuard
  if (HTTP_CTX.test(l)) return { real: true };

  // Quita lo que parece error pero no lo es y mira si queda algo fuerte.
  const limpia = l
    .replace(/\w*error\w*\s*[:=]\s*(null|undefined|0|false|''|"")/gi, ' ')
    .replace(/\b0\s+(con\s+)?error(es)?\b/gi, ' ')
    .replace(/\berror(es)?\s*[:=]\s*0\b/gi, ' ')
    .replace(/\b[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+\b/g, ' ')
    .replace(/\b\w+_(error|failed)\w*\b/gi, ' ')
    .replace(/terror\w*/gi, ' '); // "terrorist-data" contiene "error"
  if (fuerte(limpia)) return { real: true };

  if (!fuerte(l)) {
    return { real: false, motivo: 'numero suelto (hora o milisegundos), no es un codigo HTTP' };
  }
  if (
    /\w*error\w*\s*[:=]\s*(null|undefined|0|false)/i.test(l) ||
    /\b0\s+(con\s+)?error(es)?\b|\berror(es)?\s*[:=]\s*0\b/i.test(l)
  ) {
    return { real: false, motivo: 'campo o contador vacio (error: null, 0 con error)' };
  }
  return {
    real: false,
    motivo: 'la palabra esta dentro de un nombre o constante (X_ERROR, ..._FAILED, terrorist)',
  };
}

// Pistas para las lineas REALES conocidas: que mirar primero.
const PISTAS = [
  [/api-reportes respondi. 4\d\d/i, 'api-reportes no halla el caso: revisar REPORTS_URL de app-jobs (debe ser el pdf-api local, no lexchains.co)'],
  [/\b403 (dependencia|rol|usuario destino)/i, 'AccessGuard: el usuario pidio otra dependencia o no tiene el rol del endpoint'],
  [/\bEADDRINUSE\b/, 'el puerto ya esta ocupado por otro proceso'],
  [/\bECONNREFUSED\b/, 'un servicio al que se conecta esta caido, o el host/puerto del .env es otro'],
  [/\bENOTFOUND\b/, 'un nombre de host no se resuelve: revisar el .env o la red'],
  [/\bETIMEDOUT\b/, 'tiempo agotado: red o firewall'],
  [/invalid url|ERR_INVALID_URL/i, 'una URL del .env esta mal escrita'],
  [/out of memory/i, 'falta de memoria: revisar la columna mem_MB'],
  [/(status|http)\D{0,20}\b50[0-4]\b|\b50[0-4]\s+(internal|bad gateway|service unavailable|gateway)/i, 'el servidor o el proxy no alcanzo al backend (reinicio o caida)'],
];
const pista = (l) => {
  for (const [re, txt] of PISTAS) if (re.test(l)) return txt;
  return null;
};

const sinColor = (l) => l.replace(/\x1b\[[0-9;]*m/g, '').trim();

// Para agrupar lineas repetidas: quita pid/fecha de Nest, ids y numeros largos.
const normaliza = (l) =>
  l
    .replace(/\[Nest\]\s+\d+\s+-\s+[\d\/]+,\s+[\d:]+\s+[AP]M\s+/, '')
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '<id>')
    .replace(/\b\d{4,}\b/g, '<n>')
    .replace(/\s+/g, ' ');

module.exports = { fuerte, amplio, clasifica, pista, sinColor, normaliza };
