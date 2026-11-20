// PixInsight slots (ap-hub's local patch): the connector's PixInsight is the instance in
// PIXINSIGHT_CONNECTOR_SLOT, and run_wbpp runs in PIXINSIGHT_CONNECTOR_WBPP_SLOT, so a watcher is never
// sent to a WBPP run (`-x` without a slot goes to the first running instance).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createBridge } from '../src/bridge.mjs';
import { createProcessProbe, slotFromEnv, slotOfCommandLine, slotOfTitle } from '../src/process-probe.mjs';
import { ensurePixInsight } from '../src/runtime.mjs';

test('a main window title gives its slot', () => {
  assert.equal(slotOfTitle('PixInsight'), 1);
  assert.equal(slotOfTitle('PixInsight (2)'), 2);
  assert.equal(slotOfTitle('N/A'), null);
  assert.equal(slotOfTitle(''), null);
});

test('a slot from the environment is 1..256 or nothing', () => {
  assert.equal(slotFromEnv('1'), 1);
  assert.equal(slotFromEnv('2'), 2);
  for (const v of [undefined, '', '0', '257', 'x', '1.5']) assert.equal(slotFromEnv(v), null);
});

const TASKLIST =
  '"PixInsight.exe","30616","Console","1","1,010,812 K","Running","POLARIS\\peter","0:57:26","PixInsight (2)"\r\n';

test('with a slot, only the instance in that slot is this connector\'s PixInsight', async () => {
  const exec = async (cmd, args) => (cmd === 'tasklist' && args.includes('/V') ? TASKLIST : '');
  assert.equal(await createProcessProbe({ platform: 'win32', exec, slot: 1 }).isRunning(), false);
  assert.equal(await createProcessProbe({ platform: 'win32', exec, slot: 2 }).isRunning(), true);
  // without a slot, any PixInsight counts, as before
  const plain = async (cmd, args) => (cmd === 'tasklist' && !args.includes('/V') ? TASKLIST : '');
  assert.equal(await createProcessProbe({ platform: 'win32', exec: plain }).isRunning(), true);
});

test('PixInsight is started in the connector\'s slot', async () => {
  let running = false;
  const spawned = [];
  const spawn = (bin, args) => {
    spawned.push(args);
    running = true;
    return { on() {}, unref() {} };
  };
  const probe = { isRunning: async () => running };
  const r = await ensurePixInsight({
    platform: { piBin: 'PixInsight.exe' },
    probe,
    spawn,
    log: () => {},
    env: { PIXINSIGHT_CONNECTOR_SLOT: '1' },
    timeoutMs: 1000,
  });
  assert.equal(r.started, true);
  assert.deepEqual(spawned, [['-n=1']]);
});

// What the processing PC showed on 2026-11-15: WBPP in slot 2, and two watcher handoffs to slot 1 (no
// instance there) each showing PixInsight's "Fatal Error" box. Slot 1 is not running.
const TASKLIST_HANDOFFS = [
  '"PixInsight.exe","27604","Console","1","3,390,936 K","Running","POLARIS\peter","0:45:25","PixInsight (2)"',
  '"PixInsight.exe","38472","Console","1","73,472 K","Running","POLARIS\peter","0:00:00","Fatal Error"',
  '"PixInsight.exe","34916","Console","1","95,368 K","Running","POLARIS\peter","0:00:00","Fatal Error"',
].join('\r\n');
const COMMAND_LINES = [
  '27604|"C:\Program Files\PixInsight\bin\PixInsight.exe" -n=2 --automation-mode "-r=C:/Program Files/PixInsight/src/scripts/BatchPreprocessing/WBPP.js,automationMode=true" --force-exit',
  '38472|"C:\Program Files\PixInsight\bin\PixInsight.exe" -x=1:D:/PixInsightMCPWorkspace/agentic/watcher/2.5.1/polaris-1435fda7/watcher.js',
  '34916|"C:\Program Files\PixInsight\bin\PixInsight.exe" -x=1:D:/PixInsightMCPWorkspace/agentic/watcher/2.5.1/polaris-1435fda7/watcher.js',
].join('\r\n');

test('a dialog\'s title is no slot', () => {
  assert.equal(slotOfTitle('Fatal Error'), null);
  assert.equal(slotOfTitle('Weighted Batch Preprocessing'), null);
});

test('a command line gives the slot, and a -x launch is a handoff, not an instance', () => {
  assert.equal(slotOfCommandLine('"C:\PixInsight.exe" -n=2 --automation-mode'), 2);
  assert.equal(slotOfCommandLine('"C:\PixInsight.exe" -n=1'), 1);
  assert.equal(slotOfCommandLine('"C:\PixInsight.exe" -x=1:D:/w/watcher.js'), 'handoff');
  assert.equal(slotOfCommandLine('"C:\PixInsight.exe"'), null);
});

test('handoffs and their error boxes are never taken for the slot\'s instance', async () => {
  const exec = async (cmd, args) =>
    cmd === 'powershell' ? COMMAND_LINES : cmd === 'tasklist' && args.includes('/V') ? TASKLIST_HANDOFFS : '';
  assert.equal(await createProcessProbe({ platform: 'win32', exec, slot: 1 }).isRunning(), false);
  assert.equal(await createProcessProbe({ platform: 'win32', exec, slot: 2 }).isRunning(), true);
  // an instance started by hand (no -n) goes by its title, as before
  const byHand = async (cmd, args) =>
    cmd === 'powershell'
      ? '5000|"C:\Program Files\PixInsight\bin\PixInsight.exe"'
      : cmd === 'tasklist' && args.includes('/V')
        ? '"PixInsight.exe","5000","Console","1","1 K","Running","x","0:00:01","PixInsight"'
        : '';
  assert.equal(await createProcessProbe({ platform: 'win32', exec: byHand, slot: 1 }).isRunning(), true);
  // no PowerShell answer: titles alone, and a "Fatal Error" box still is not slot 1
  const noPs = async (cmd, args) => {
    if (cmd === 'powershell') throw new Error('powershell missing');
    return cmd === 'tasklist' && args.includes('/V') ? TASKLIST_HANDOFFS : '';
  };
  assert.equal(await createProcessProbe({ platform: 'win32', exec: noPs, slot: 1 }).isRunning(), false);
});

test('a watcher handoff that never beats is ended when the bridge gives up', async (t) => {
  const { EventEmitter } = await import('node:events');
  const fs = await import('node:fs');
  const fsp = await import('node:fs/promises');
  const os = await import('node:os');
  const path = await import('node:path');
  const { setTimeout: delay } = await import('node:timers/promises');
  const root = fs.realpathSync.native(await fsp.mkdtemp(path.join(os.tmpdir(), 'pixinsight-slots-')));
  t.after(() => fsp.rm(root, { recursive: true, force: true }));
  const bridgeDir = path.join(root, 'bridge');
  await fsp.mkdir(path.join(bridgeDir, 'commands'), { recursive: true });
  await fsp.mkdir(path.join(bridgeDir, 'results'), { recursive: true });
  const clock = { t: 1_800_000_000_000 };
  const killed = [];
  const spawned = [];
  const ctx = createBridge({
    platform: { piBin: 'fake-pixinsight-bin' },
    probe: { isRunning: async () => true, startedAt: async () => null, memoryMB: async () => null },
    log: () => {},
    watcherPath: 'fake-watcher.js',
    bridgeDir,
    autoLaunch: true,
    pollIntervalMs: 2,
    deadCheckIntervalMs: 60_000,
    now: () => clock.t,
    sleep: async (ms) => {
      clock.t += ms;
      await delay(0);
    },
    pid: 4242,
    isPidAlive: () => true,
    env: { PIXINSIGHT_CONNECTOR_SLOT: '1' },
    spawnWatcher: (bin, args) => {
      spawned.push(args);
      const child = Object.assign(new EventEmitter(), { pid: 38472, exitCode: null, signalCode: null, unref() {} });
      child.kill = () => killed.push(child.pid);
      return child;
    },
  });
  await assert.rejects(ctx.pjsr('1;'), /did not start within 30s/);
  assert.deepEqual(spawned, [['-x=1:fake-watcher.js']]);
  assert.deepEqual(killed, [38472]);
});
