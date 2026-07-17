import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, before, test } from 'node:test';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BACKEND_DIR = path.resolve(__dirname, '../backend');
const PORT = 3101;
const BASE_URL = `http://127.0.0.1:${PORT}`;

let server;
let dataDir;

async function request(pathname, options = {}) {
  const response = await fetch(`${BASE_URL}${pathname}`, {
    ...options,
    headers: {
      'content-type': 'application/json',
      ...(options.headers || {})
    }
  });
  const body = await response.json();
  return { response, body };
}

async function waitForServer() {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    try {
      const { response } = await request('/api/health');
      if (response.ok) return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  throw new Error('server did not become ready');
}

before(async () => {
  dataDir = await mkdtemp(path.join(tmpdir(), 'task-board-lite-test-'));

  server = spawn(process.execPath, ['src/server.js'], {
    cwd: BACKEND_DIR,
    env: { ...process.env, DATA_DIR: dataDir, PORT: String(PORT) },
    stdio: 'ignore'
  });

  await waitForServer();
});

after(async () => {
  if (server) {
    server.kill();
    await new Promise((resolve) => server.once('exit', resolve));
  }

  if (dataDir) await rm(dataDir, { recursive: true, force: true });
});

test('isolates tasks by team, cascades team deletion, and rejects stale task versions', async () => {
  const teamA = await request('/api/teams', {
    method: 'POST',
    body: JSON.stringify({ name: 'QA-A' })
  });
  assert.equal(teamA.response.status, 201);

  const teamB = await request('/api/teams', {
    method: 'POST',
    body: JSON.stringify({ name: 'QA-B' })
  });
  assert.equal(teamB.response.status, 201);

  const teamAId = teamA.body.team.id;
  const teamBId = teamB.body.team.id;

  const taskA = await request(`/api/teams/${teamAId}/tasks`, {
    method: 'POST',
    body: JSON.stringify({ title: 'A-only-task' })
  });
  assert.equal(taskA.response.status, 201);
  assert.equal(taskA.body.task.status, 'todo');
  assert.equal(taskA.body.task.version, 1);

  const boardB = await request(`/api/teams/${teamBId}/board`);
  assert.equal(boardB.response.status, 200);
  assert.deepEqual(boardB.body.tasks, []);
  assert.equal(boardB.body.board.todo.length, 0);

  const crossTeamUpdate = await request(`/api/teams/${teamBId}/tasks/${taskA.body.task.id}/status`, {
    method: 'PATCH',
    body: JSON.stringify({ status: 'doing', version: taskA.body.task.version })
  });
  assert.equal(crossTeamUpdate.response.status, 404);
  assert.equal(crossTeamUpdate.body.error.code, 'TASK_NOT_FOUND');

  const update = await request(`/api/teams/${teamAId}/tasks/${taskA.body.task.id}/status`, {
    method: 'PATCH',
    body: JSON.stringify({ status: 'doing', version: taskA.body.task.version })
  });
  assert.equal(update.response.status, 200);
  assert.equal(update.body.task.status, 'doing');
  assert.equal(update.body.task.version, 2);

  const staleUpdate = await request(`/api/teams/${teamAId}/tasks/${taskA.body.task.id}/status`, {
    method: 'PATCH',
    body: JSON.stringify({ status: 'done', version: taskA.body.task.version })
  });
  assert.equal(staleUpdate.response.status, 409);
  assert.equal(staleUpdate.body.error.code, 'VERSION_CONFLICT');
  assert.equal(staleUpdate.body.error.current.status, 'doing');
  assert.equal(staleUpdate.body.error.current.version, 2);

  const deleteTeamA = await request(`/api/teams/${teamAId}`, { method: 'DELETE' });
  assert.equal(deleteTeamA.response.status, 200);

  const deletedBoard = await request(`/api/teams/${teamAId}/board`);
  assert.equal(deletedBoard.response.status, 404);

  const survivingBoard = await request(`/api/teams/${teamBId}/board`);
  assert.equal(survivingBoard.response.status, 200);
  assert.deepEqual(survivingBoard.body.tasks, []);
});
