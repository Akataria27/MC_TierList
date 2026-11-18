'use strict';
// Runs the import in a worker thread so the window stays responsive.
const { parentPort, workerData } = require('worker_threads');
const importer = require('./importer');
let last = 0;
try {
  const r = importer.build(workerData, (p) => { const now = Date.now(); if (now - last > 60 || p.done === p.total) { last = now; parentPort.postMessage({ type: 'progress', p }); } });
  parentPort.postMessage({ type: 'done', result: r });
} catch (e) {
  parentPort.postMessage({ type: 'error', error: String((e && e.message) || e) });
}
