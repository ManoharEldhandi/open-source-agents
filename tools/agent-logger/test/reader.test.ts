import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import test from 'node:test';
import { createAgentLogger, readLog } from '../src/index.js';

test('reader and CLI inspect an actual JSONL run', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'agent-log-reader-'));
  const logger = await createAgentLogger({ directory });
  await logger.run('task', async () => logger.wrapTool('search', () => 'found')());
  await logger.close();
  assert.ok(logger.filePath);
  const events = await readLog(logger.filePath);
  assert.equal(events.length, 4);
  const { stdout } = await promisify(execFile)(process.execPath, [
    'test-dist/src/cli.js',
    'view',
    logger.filePath,
  ]);
  assert.match(stdout, /tool search completed/);
  assert.match(stdout, /Events: 4/);
});

test('reader rejects malformed schemas and unsafe numeric fields', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'agent-log-invalid-'));
  const filePath = join(directory, 'bad.jsonl');
  await writeFile(filePath, '{"schemaVersion":9}\n');
  await assert.rejects(readLog(filePath));
  await writeFile(filePath, 'not-json\n');
  await assert.rejects(readLog(filePath));
});
