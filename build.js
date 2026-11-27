// Arma index.html (una sola página, sin dependencias) y las plantillas CSV de la planilla.
// Uso: node build.js
const fs = require('fs'), path = require('path');
const R = (...p) => path.join(__dirname, ...p);
const leer = f => fs.readFileSync(R(f), 'utf8');
const C = require('./src/contenido.js');

const backend = leer('backend/Code.gs');
const demo = [
  leer('src/gas-mock.js'), leer('src/cargar-backend.js'), leer('src/contenido.js'),
  'window.CODIGO_BACKEND = ' + JSON.stringify(backend).replace(/<\//g, '<\\/') + ';',
  leer('src/demo.js')
].join('\n;\n');
let html = leer('src/app.html')
  .replace('/*@@LOGOS@@*/', leer('src/logos.css').trim())
  .replace('<!--@@DEMO@@-->', '<script>\n' + demo.replace(/<\/script/gi, '<\\/script') + '\n</script>');
// Mientras SITIO_REAL sea false, la dirección principal muestra la demo.
// /app/ está siempre conectada a la planilla real y /demo/ es siempre la demo con todo habilitado (para docentes).
const SITIO_REAL = false;
const comoDemo = (h, modo) => h.replace(/var API = '[^']*';/, "var API = '';" + (modo ? " window.GDPO_DEMO_MODO = '" + modo + "';" : ''));
const escribir = (f, h) => { fs.mkdirSync(path.dirname(R(f)), { recursive: true }); fs.writeFileSync(R(f), h); console.log(f, Math.round(h.length / 1024) + ' KB'); };
escribir('index.html', SITIO_REAL ? html : comoDemo(html, 'abierto'));
escribir('app/index.html', html);
escribir('demo/index.html', comoDemo(html, 'abierto'));

const csv = filas => filas.map(f => f.map(v => { v = String(v == null ? '' : v); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; }).join(',')).join('\n') + '\n';
const enc = n => ({
  Cronograma: ['clase', 'fecha', 'unidad', 'tema', 'abre', 'cierra', 'tiene_checkpoint', 'capsula_titulo', 'capsula_url'],
  Preguntas: ['clase', 'parte', 'n', 'tipo', 'enunciado', 'opciones', 'correcta'],
  EntregasTP: ['entrega', 'clase', 'titulo', 'consigna', 'abre', 'vence'],
  Docentes: ['mail', 'nombre', 'rol', 'clave'],
  Padron: ['legajo', 'dni', 'mail', 'apellido', 'nombre', 'comision', 'grupo']
})[n];
fs.mkdirSync(R('plantillas'), { recursive: true });
const pl = {
  Cronograma: C.cronograma, Preguntas: C.filasPreguntas(), EntregasTP: C.entregasTP,
  Docentes: C.docentes.map(d => [d[0], d[1], d[2], 'CAMBIAR-' + d[1].split(' ')[0].toUpperCase()]),
  Padron: [['41287/3', '40111222', 'camila.rossi@alu.econo.unlp.edu.ar', 'Rossi', 'Camila', 'A', 'G01'], ['41300/1', '40222333', 'tomas.paz@alu.econo.unlp.edu.ar', 'Paz', 'Tomás', 'A', 'G01']]
};
Object.keys(pl).forEach(n => fs.writeFileSync(R('plantillas', n + '.csv'), csv([enc(n)].concat(pl[n]))));
fs.writeFileSync(R('plantillas', 'caso_tp.txt'), C.caso + '\n');
console.log('plantillas:', Object.keys(pl).join(', '));
