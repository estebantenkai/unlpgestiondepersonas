// Pruebas del backend real (Code.gs) sobre la planilla simulada. Uso: node tests/backend.test.js
const fs = require('fs'), path = require('path'), assert = require('assert');
const { crearEntornoGAS } = require('../src/gas-mock.js');
const { cargarBackend, sembrarPlanilla } = require('../src/cargar-backend.js');
const C = require('../src/contenido.js');
const raiz = path.join(__dirname, '..');
const fuente = fs.readFileSync(path.join(raiz, 'backend/Code.gs'), 'utf8') + '\n' + fs.readFileSync(path.join(raiz, 'backend/Pruebas.gs'), 'utf8');

const env = crearEntornoGAS();
const B = cargarBackend(env, fuente);
B.api.configurarBitacora();
const padron = [
  ['41287/3', '40111222', 'camila.rossi@alu.econo.unlp.edu.ar', 'Rossi', 'Camila', 'A', 'G01'],
  ['41300/1', '40222333', 'tomas.paz@alu.econo.unlp.edu.ar', 'Paz', 'Tomás', 'A', 'G01'],
  ['41999/9', '40999888', 'sin.grupo@alu.econo.unlp.edu.ar', 'Gómez', 'Ana', 'B', '']
];
sembrarPlanilla(env, C, padron);
B.api.limpiarCache();
let ok = 0;
const t = (nombre, fn) => { fn(); ok++; console.log('  ✓ ' + nombre); };
const L = p => B.llamar(p);
const D = (s) => { const [d, h] = s.split(' '); const [y, m, dd] = d.split('-').map(Number); const [hh, mm] = (h || '0:0').split(':').map(Number); return new Date(y, m - 1, dd, hh, mm).getTime(); };

console.log('Backend GDPO');
t('probarBackend pasa con el contenido de ejemplo', () => { B.api.probarBackend(); assert(env._logs.some(l => l.startsWith('TODO OK'))); });

env._fijarAhora(D('2027-03-18 10:00'));
let cam;
t('rechaza mail que no corresponde al legajo', () => assert.equal(L({ accion: 'ingresar', mail: 'tomas.paz@alu.econo.unlp.edu.ar', legajo: '41287/3' }).error, 'acceso'));
t('ingresa sólo con mail + legajo (normaliza mayúsculas y espacios)', () => {
  cam = L({ accion: 'ingresar', mail: ' Camila.Rossi@alu.econo.unlp.edu.ar ', legajo: ' 41287/3' });
  assert(cam.ok && cam.token); assert.equal(cam.yo.grupo, 'G01'); assert.deepEqual(cam.yo.companeros, ['Camila Rossi', 'Tomás Paz']);
  assert.deepEqual(cam.yo.equipo.map(x => x.mail), ['camila.rossi@alu.econo.unlp.edu.ar', 'tomas.paz@alu.econo.unlp.edu.ar']);
  assert(cam.yo.equipo[0].yo && !cam.yo.equipo[1].yo);
});
t('cronograma: 10 checkpoints; clase 2 cierra 15 días después del fin de la unidad I', () => {
  const cps = cam.cronograma.filter(c => c.tiene_checkpoint);
  assert.equal(cps.length, 10);
  const c2 = cps.find(c => c.clase === '2');
  assert.equal(new Date(c2.cierra).toDateString(), new Date(2027, 3, 1).toDateString());
});
t('token adulterado no sirve', () => assert.equal(L({ accion: 'estado', token: cam.token.slice(0, -3) + 'abc' }).error, 'sesion'));
t('clase 3 todavía no abrió', () => assert.equal(L({ accion: 'comenzar', token: cam.token, clase: '3', parte: 'teorico' }).error, 'no_abierta'));
let com;
t('comenzar no manda las respuestas correctas', () => {
  com = L({ accion: 'comenzar', token: cam.token, clase: '2', parte: 'teorico' });
  assert(com.ok); assert.equal(com.preguntas.length, 3); assert(!('correcta' in com.preguntas[0]));
});
t('volver a comenzar conserva la hora de inicio', () => {
  env._fijarAhora(D('2027-03-18 10:03'));
  assert.equal(L({ accion: 'comenzar', token: cam.token, clase: '2', parte: 'teorico' }).inicio, com.inicio);
});
t('entrega 2 de 3 correctas en 12 min: aprobado y marcado como excedido', () => {
  env._fijarAhora(D('2027-03-18 10:12'));
  const r = L({ accion: 'entregar', token: cam.token, clase: '2', parte: 'teorico', respuestas: { 1: '1', 2: '2', 3: '0' } });
  assert(r.ok && r.aprobado); assert.equal(r.correctas, 2); assert.equal(r.segundos, 720); assert(r.excedido);
  assert.equal(r.correccion.length, 3); assert.equal(r.correccion[2].ok, false); assert.equal(r.correccion[2].correcta, '1'); assert.equal(r.correccion[2].elegida, '0');
});
t('no permite un segundo intento', () => assert.equal(L({ accion: 'entregar', token: cam.token, clase: '2', parte: 'teorico', respuestas: {} }).error, 'ya_entregado'));
t('cápsula de opción múltiple: se aprueba con 2 de 3 correctas', () => {
  const c = L({ accion: 'comenzar', token: cam.token, clase: '2', parte: 'capsula' });
  assert.equal(c.preguntas.length, 3); assert.equal(c.preguntas[0].tipo, 'opcion');
  const r = L({ accion: 'entregar', token: cam.token, clase: '2', parte: 'capsula', respuestas: { 1: '1', 2: '0', 3: '3' } });
  assert(r.aprobado); assert.equal(r.correctas, 2); assert.equal(r.total, 3);
});
t('correcciones: el alumno puede volver a ver y descargar lo que respondió', () => {
  const r = L({ accion: 'correcciones', token: cam.token });
  assert(r.ok); assert.equal(r.items.length, 2);
  const cap = r.items.find(i => i.parte === 'capsula');
  assert.deepEqual(cap.detalle.map(d => d.ok), [true, true, false]);
  assert.equal(L({ accion: 'correcciones', token: cam.token, clase: '2', parte: 'teorico' }).items.length, 1);
});
t('con ver_correctas = AL_CERRAR no se muestran hasta que cierra la clase', () => {
  env._libro.getSheetByName('Config').filas.forEach(f => { if (f[0] === 'ver_correctas') f[1] = 'AL_CERRAR'; });
  B.api.limpiarCache();
  const r = L({ accion: 'correcciones', token: cam.token });
  assert.equal(r.items.length, 0); assert.equal(r.ocultas, 2);
  env._libro.getSheetByName('Config').filas.forEach(f => { if (f[0] === 'ver_correctas') f[1] = 'AL_ENTREGAR'; });
  B.api.limpiarCache();
});
t('el progreso sobrevive a que se vacíe la caché (lo relee de la planilla)', () => {
  env._limpiarCache();
  const e = L({ accion: 'estado', token: cam.token });
  assert(e.progreso['2|teorico'].a && e.progreso['2|teorico'].x && e.progreso['2|capsula'].a);
});
t('con excedido_desaprueba = SI, pasarse desaprueba', () => {
  env._libro.getSheetByName('Config').filas.forEach(f => { if (f[0] === 'excedido_desaprueba') f[1] = 'SI'; });
  B.api.limpiarCache();
  const tom = L({ accion: 'ingresar', mail: 'tomas.paz@alu.econo.unlp.edu.ar', legajo: '41300/1' });
  L({ accion: 'comenzar', token: tom.token, clase: '2', parte: 'teorico' });
  env._fijarAhora(D('2027-03-18 10:30'));
  const r = L({ accion: 'entregar', token: tom.token, clase: '2', parte: 'teorico', respuestas: { 1: '1', 2: '2', 3: '1' } });
  assert.equal(r.correctas, 3); assert.equal(r.aprobado, false);
  env._libro.getSheetByName('Config').filas.forEach(f => { if (f[0] === 'excedido_desaprueba') f[1] = 'NO'; });
  B.api.limpiarCache();
});
t('después del cierre no se puede entregar', () => {
  env._fijarAhora(D('2027-04-02 09:00'));
  assert.equal(L({ accion: 'comenzar', token: cam.token, clase: '2', parte: 'capsula' }).error, 'cerrada');
});

// TP grupal
const tom = L({ accion: 'ingresar', mail: 'tomas.paz@alu.econo.unlp.edu.ar', legajo: '41300/1' });
let v0;
t('TP: guardar y leer desde otra cuenta del grupo', () => {
  const g = L({ accion: 'tpGuardar', token: cam.token, cambios: [{ campo: 'e1', valor: '<p>Diagnóstico =SUMA(1;2)</p>', base: 0 }] });
  assert(g.ok && g.guardados.e1);
  const r = L({ accion: 'tpLeer', token: tom.token });
  assert.equal(r.campos.e1.v, '<p>Diagnóstico =SUMA(1;2)</p>'); assert.equal(r.campos.e1.a, 'Camila Rossi');
  v0 = r.version; assert(v0 > 0);
});
t('TP: edición con versión vieja de otra persona da conflicto', () => {
  const g = L({ accion: 'tpGuardar', token: tom.token, cambios: [{ campo: 'e1', valor: 'pisado', base: 1 }] });
  assert.equal(g.conflictos.length, 1); assert.equal(g.conflictos[0].a, 'Camila Rossi');
});
t('TP: tpVersion cambia cuando alguien guarda', () => {
  env._fijarAhora(D('2027-04-02 09:05'));
  L({ accion: 'tpGuardar', token: tom.token, cambios: [{ campo: 'e2', valor: 'Dotación', base: 0 }] });
  assert(L({ accion: 'tpVersion', token: cam.token }).version > v0);
});
t('TP: alumno sin grupo no puede editar', () => {
  const ana = L({ accion: 'ingresar', mail: 'sin.grupo@alu.econo.unlp.edu.ar', legajo: '41999/9' });
  assert.equal(L({ accion: 'tpGuardar', token: ana.token, cambios: [{ campo: 'e1', valor: 'x' }] }).error, 'sin_grupo');
});
t('TP: después de la entrega final queda cerrado', () => {
  L({ accion: 'tpGuardar', token: cam.token, cambios: [{ campo: '_final', valor: 'Entregado', base: 0 }] });
  assert.equal(L({ accion: 'tpGuardar', token: tom.token, cambios: [{ campo: 'e3', valor: 'x' }] }).error, 'final');
});

// Docentes
let doc;
t('docente: clave incorrecta rechazada; correcta entra', () => {
  assert.equal(L({ accion: 'docIngresar', mail: 'brian@econo.unlp.edu.ar', clave: 'x' }).error, 'acceso');
  doc = L({ accion: 'docIngresar', mail: 'Brian@econo.unlp.edu.ar', clave: 'demo' }); assert(doc.ok);
});
t('docente: clave común de Config sirve para todos los de la hoja Docentes, y para nadie más', () => {
  env._libro.getSheetByName('Config').filas.forEach(f => { if (f[0] === 'clave_docentes') f[1] = 'gdpo2027'; if (f[0] === 'manual_url') f[1] = 'https://ejemplo/manual'; });
  B.api.limpiarCache();
  const r = L({ accion: 'docIngresar', mail: 'lina.zubiria@econo.unlp.edu.ar', clave: 'gdpo2027' });
  assert(r.ok); assert.equal(r.manual, 'https://ejemplo/manual');
  assert.equal(L({ accion: 'docIngresar', mail: 'intruso@gmail.com', clave: 'gdpo2027' }).error, 'acceso');
});
t('configurarBitacora en una planilla vieja agrega las claves nuevas sin pisar las existentes', () => {
  const hc = env._libro.getSheetByName('Config');
  hc.filas = hc.filas.filter(f => f[0] !== 'ver_correctas');
  B.api.configurarBitacora();
  assert(hc.filas.some(f => f[0] === 'ver_correctas'));
  assert.equal(hc.filas.find(f => f[0] === 'clave_docentes')[1], 'gdpo2027');
});
t('docente: un token de alumno no abre el tablero', () => assert.equal(L({ accion: 'docResumen', token: cam.token }).error, 'sesion'));
t('docente: resumen con alumnos, intentos y TP', () => {
  const r = L({ accion: 'docResumen', token: doc.token, fresco: true });
  assert.equal(r.alumnos.length, 3); assert.equal(r.intentos.length, 3); assert(r.tp.G01.e1.n > 0);
});
t('docente: nota grupal 1-10 se guarda, valida y llega al alumno', () => {
  assert.equal(L({ accion: 'docNota', token: doc.token, grupo: 'G01', nota: 11 }).error, 'nota');
  assert(L({ accion: 'docNota', token: doc.token, grupo: 'G01', nota: 8, comentario: 'Buen diagnóstico' }).ok);
  assert(L({ accion: 'docNota', token: doc.token, grupo: 'G01', nota: 9 }).ok);
  assert.equal(env._libro.getSheetByName('Notas').getLastRow(), 2);   // actualiza, no duplica
  assert.equal(L({ accion: 'tpLeer', token: tom.token }).nota.nota, 9);
  assert.equal(L({ accion: 'docResumen', token: doc.token }).notas.G01.nota, 9);
});
t('prueba de carga responde sólo con el interruptor activado', () => {
  assert(L({ accion: 'carga', quien: 'v1' }).ok);
  env._libro.getSheetByName('Config').filas.forEach(f => { if (f[0] === 'prueba_carga') f[1] = 'NO'; });
  B.api.limpiarCache();
  assert.equal(L({ accion: 'carga', quien: 'v1' }).error, 'deshabilitado');
});
t('docente: contenido completo con respuestas correctas; alumno no puede pedirlo', () => {
  {
    const r = L({ accion: 'docContenido', token: doc.token });
    assert(r.ok); assert.equal(r.clases.filter(c => c.tiene_checkpoint).length, 10);
    const c2 = r.clases.find(c => c.clase === '2');
    assert.equal(c2.teorico.length, 3); assert.equal(c2.capsula.length, 3); assert(c2.teorico[0].correcta !== undefined);
    assert(r.entregas.length > 0); assert(r.caso.length > 50);
  }
  assert.equal(L({ accion: 'docContenido', token: cam.token }).error, 'sesion');
});
t('nuevo cuatrimestre: respalda, vacía datos de alumnos, cierra sesiones y no arrastra caché', () => {
  const antes = L({ accion: 'ingresar', mail: 'camila.rossi@alu.econo.unlp.edu.ar', legajo: '41287/3' });
  assert(Object.keys(antes.progreso).length > 0);
  assert(Object.keys(L({ accion: 'tpLeer', token: antes.token }).campos).length > 0);
  const r = B.api.nuevoCuatrimestre_('2C 2027');
  assert.equal(env._libro.copias.length, 1); assert(r.respaldo.indexOf('1C 2027') > 0);
  ['Padron', 'Intentos', 'TP', 'TPHistorial', 'Notas'].forEach(n => assert.equal(env._libro.getSheetByName(n).getLastRow(), 1, n));
  assert(env._libro.getSheetByName('Docentes').getLastRow() > 1 && env._libro.getSheetByName('Preguntas').getLastRow() > 1);
  assert.equal(L({ accion: 'estado', token: antes.token }).error, 'sesion');
  assert.equal(L({ accion: 'ingresar', mail: 'camila.rossi@alu.econo.unlp.edu.ar', legajo: '41287/3' }).error, 'acceso');
  env._libro.getSheetByName('Padron').getRange(2, 1, 2, 7).setValues(padron.slice(0, 2));
  B.api.limpiarCache();
  const nueva = L({ accion: 'ingresar', mail: 'camila.rossi@alu.econo.unlp.edu.ar', legajo: '41287/3' });
  assert(nueva.ok); assert.equal(nueva.cuatrimestre || '2C 2027', '2C 2027');
  assert.deepEqual(nueva.progreso, {});
  assert.deepEqual(L({ accion: 'tpLeer', token: nueva.token }).campos, {});
});
t('acción desconocida no rompe', () => assert.equal(L({ accion: 'borrarTodo' }).error, 'accion'));
console.log(`\n${ok} pruebas OK`);
