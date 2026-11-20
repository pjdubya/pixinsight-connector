// A WBPP run counts as running only while its pid is alive and still PixInsight: Windows hands a dead
// process's number to another program (a svchost, say), which must not keep the run "running".
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isPixInsightPid } from '../src/process-probe.mjs';

const alive = () => {};
const gone = () => { throw Object.assign(new Error('no such process'), { code: 'ESRCH' }); };

test('isPixInsightPid: alive and PixInsight is true, on every OS', () => {
  assert.equal(isPixInsightPid(45040, { platform: 'win32', kill: alive, processName: () => 'PixInsight.exe' }), true);
  assert.equal(isPixInsightPid(45040, { platform: 'linux', kill: alive, processName: () => 'PixInsight' }), true);
  assert.equal(isPixInsightPid(45040, { platform: 'darwin', kill: alive, processName: () => 'PixInsight' }), true);
});

test('isPixInsightPid: a pid reused by another program is false', () => {
  assert.equal(isPixInsightPid(45040, { platform: 'win32', kill: alive, processName: () => 'svchost.exe' }), false);
});

test('isPixInsightPid: a gone pid is false without asking its name; an unknown name is null', () => {
  let asked = false;
  assert.equal(isPixInsightPid(45040, { kill: gone, processName: () => { asked = true; return 'PixInsight.exe'; } }), false);
  assert.equal(asked, false);
  assert.equal(isPixInsightPid(45040, { platform: 'win32', kill: alive, processName: () => null }), null);
  assert.equal(isPixInsightPid(0, { kill: alive, processName: () => 'PixInsight.exe' }), null);
});

test('isPixInsightPid: this test process is not PixInsight', () => {
  assert.equal(isPixInsightPid(process.pid), false);
});
