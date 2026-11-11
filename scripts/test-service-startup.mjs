import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtemp, readFile, rmdir, symlink, unlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const unit = await readFile(new URL('../deploy/systemd/kimia.service', import.meta.url), 'utf8');
const entry = /^ExecStart=\/usr\/bin\/node (.+)$/m.exec(unit)?.[1].trim();
assert.equal(entry, '--preserve-symlinks-main /opt/kimia/current/server/index.js');
const temp = await mkdtemp(path.join(tmpdir(), 'kimia-service-startup-'));
const current = path.join(temp, 'current');
try {
  await symlink(root, current, process.platform === 'win32' ? 'junction' : 'dir');
  const result = spawnSync(process.execPath, ['--preserve-symlinks-main', path.join(current, 'server', 'index.js')], {
    cwd: current,
    env: {...process.env, DATABASE_URL: '', UPLOAD_DIR: ''},
    encoding: 'utf8', windowsHide: true, timeout: 10000,
  });
  assert.ifError(result.error);
  assert.equal(result.status, 1, 'The service must enter startup validation, not silently exit successfully through the current symlink.');
  assert.match(result.stderr, /Kimia server could not start/);
} finally {
  await unlink(current);
  await rmdir(temp);
}
console.log('systemd entrypoint runs startup validation from a symlinked release working directory.');
