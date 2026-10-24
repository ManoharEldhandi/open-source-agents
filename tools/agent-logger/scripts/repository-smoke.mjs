import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const source = process.argv[2];
if (!source) throw new Error('Usage: npm run test:repo -- ../trusted-node-repository');
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const exec = promisify(execFile);
const execute = async (file, args, cwd) =>
  (
    await exec(file, args, {
      cwd,
      encoding: 'utf8',
      timeout: 180000,
      maxBuffer: 16 * 1024 * 1024,
    })
  ).stdout;
const metadata = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
const archiveName = `${metadata.name.replace('@', '').replace('/', '-')}-${metadata.version}.tgz`;
const reportDirectory = join(root, '.agent-logs');
await mkdir(reportDirectory, { recursive: true, mode: 0o700 });
const reportMetadata = await lstat(reportDirectory);
if (
  !reportMetadata.isDirectory() ||
  reportMetadata.isSymbolicLink() ||
  (reportMetadata.mode & 0o077) !== 0
)
  throw new Error('Report directory must be private and must not be a symlink.');
const temporary = await mkdtemp(join(tmpdir(), 'agent-logger-repository-'));
let logger;
let stage = 'clone';
try {
  const repository = join(temporary, 'repository');
  await execute(
    'git',
    ['clone', '--local', '--no-hardlinks', resolve(source), repository],
    temporary,
  );
  const consumer = join(temporary, 'consumer');
  stage = 'consumer-install';
  await execute(
    npm,
    [
      'install',
      '--prefix',
      consumer,
      '--ignore-scripts',
      '--omit=dev',
      '--no-audit',
      '--no-fund',
      join(root, archiveName),
    ],
    root,
  );
  const packageRoot = join(consumer, 'node_modules', ...metadata.name.split('/'));
  stage = 'sdk-load';
  const sdk = await import(pathToFileURL(join(packageRoot, 'dist/index.js')));
  logger = await sdk.createAgentLogger({ directory: join(root, '.agent-logs') });
  const readPackage = logger.wrapTool('repository.read_package', async () =>
    JSON.parse(await readFile(join(repository, 'package.json'), 'utf8')),
  );
  const install = logger.wrapTool('repository.install', () =>
    execute(npm, ['ci', '--ignore-scripts', '--no-audit', '--no-fund'], repository),
  );
  const test = logger.wrap('repository.test', 'workflow', () =>
    execute(npm, ['test'], repository),
  );
  const output = await logger.run('external-repository-check', async () => {
    stage = 'subject-read';
    await readPackage();
    stage = 'subject-install';
    await install();
    stage = 'subject-test';
    return test();
  });
  const delivery = await logger.close();
  assert.equal(delivery.success, true);
  const events = await sdk.readLog(logger.filePath);
  assert.equal(events.filter((event) => event.status === 'failed').length, 0);
  assert.ok(
    events.some(
      (event) => event.name === 'repository.test' && event.status === 'completed',
    ),
  );
  await writeFile(join(root, '.agent-logs/repository-test-output.txt'), output, {
    mode: 0o600,
  });
  const report = {
    success: true,
    commit: (await execute('git', ['rev-parse', 'HEAD'], repository)).trim(),
    events: events.length,
    delivery,
    summary: output
      .split('\n')
      .filter((line) => /tests |pass |fail |suites /u.test(line))
      .slice(-25),
  };
  await writeFile(
    join(root, '.agent-logs/repository-validation.json'),
    JSON.stringify(report, null, 2),
    { mode: 0o600 },
  );
  console.log(JSON.stringify(report, null, 2));
  assert.ok(
    !(await readdir(repository)).includes('.agent-logs'),
    'SDK logs must remain outside the subject repository.',
  );
} catch (error) {
  const output = [error?.stdout, error?.stderr, error?.message]
    .filter(Boolean)
    .map(String)
    .join('\n');
  await writeFile(join(root, '.agent-logs/repository-test-output.txt'), output, {
    mode: 0o600,
  });
  await writeFile(
    join(root, '.agent-logs/repository-validation.json'),
    JSON.stringify({ success: false, stage, exitStatus: error?.status ?? null }),
    { mode: 0o600 },
  );
  console.error(
    `External repository validation failed at ${stage}; inspect .agent-logs/repository-test-output.txt.`,
  );
  process.exitCode = 1;
} finally {
  if (logger) await logger.close();
  await rm(temporary, { recursive: true, force: true });
}
