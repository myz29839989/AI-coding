import crypto from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.resolve(__dirname, '../data');
const DB_PATH = path.join(DATA_DIR, 'db.json');
const TMP_PATH = path.join(DATA_DIR, 'db.tmp.json');
const PORT = Number(process.env.PORT || 3001);
const STATUSES = ['todo', 'doing', 'done'];

let writeQueue = Promise.resolve();

function now() {
  return new Date().toISOString();
}

function newId(prefix) {
  return `${prefix}_${crypto.randomUUID()}`;
}

function cleanText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function publicTeam(team) {
  return {
    id: team.id,
    name: team.name,
    createdAt: team.createdAt,
    updatedAt: team.updatedAt
  };
}

function publicTask(task) {
  return {
    id: task.id,
    teamId: task.teamId,
    title: task.title,
    description: task.description,
    status: task.status,
    version: task.version,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt
  };
}

function sendJson(res, status, body) {
  res.writeHead(status, {
    'access-control-allow-origin': '*',
    'access-control-allow-methods': 'GET,POST,PATCH,DELETE,OPTIONS',
    'access-control-allow-headers': 'content-type',
    'content-type': 'application/json; charset=utf-8'
  });
  res.end(JSON.stringify(body));
}

function sendError(res, status, code, message, extra = {}) {
  sendJson(res, status, { error: { code, message, ...extra } });
}

async function parseBody(req) {
  let raw = '';
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > 64 * 1024) {
      const error = new Error('request body too large');
      error.status = 413;
      throw error;
    }
  }
  return raw ? JSON.parse(raw) : {};
}

async function ensureDb() {
  await mkdir(DATA_DIR, { recursive: true });
  try {
    await readFile(DB_PATH, 'utf8');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    await writeFile(DB_PATH, JSON.stringify({ teams: [], tasks: [] }, null, 2));
  }
}

async function readDb() {
  await ensureDb();
  const raw = await readFile(DB_PATH, 'utf8');
  const data = JSON.parse(raw || '{}');
  return {
    teams: Array.isArray(data.teams) ? data.teams : [],
    tasks: Array.isArray(data.tasks) ? data.tasks : []
  };
}

async function writeDb(data) {
  await writeFile(TMP_PATH, `${JSON.stringify(data, null, 2)}\n`);
  await rename(TMP_PATH, DB_PATH);
}

function enqueueWrite(handler) {
  const job = writeQueue.then(async () => {
    const db = await readDb();
    const result = await handler(db);
    await writeDb(db);
    return result;
  });
  writeQueue = job.catch(() => {});
  return job;
}

function groupBoard(tasks) {
  return STATUSES.reduce((board, status) => {
    board[status] = tasks.filter((task) => task.status === status).map(publicTask);
    return board;
  }, {});
}

function matchPath(pathname, pattern) {
  const pathParts = pathname.split('/').filter(Boolean);
  const patternParts = pattern.split('/').filter(Boolean);
  if (pathParts.length !== patternParts.length) return null;
  const params = {};
  for (let index = 0; index < patternParts.length; index += 1) {
    const expected = patternParts[index];
    const actual = pathParts[index];
    if (expected.startsWith(':')) {
      params[expected.slice(1)] = decodeURIComponent(actual);
    } else if (expected !== actual) {
      return null;
    }
  }
  return params;
}

async function handleRequest(req, res) {
  res.setHeader('access-control-allow-origin', '*');
  res.setHeader('access-control-allow-methods', 'GET,POST,PATCH,DELETE,OPTIONS');
  res.setHeader('access-control-allow-headers', 'content-type');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = url.pathname;

  if (req.method === 'GET' && pathname === '/api/health') {
    sendJson(res, 200, { ok: true });
    return;
  }

  if (req.method === 'GET' && pathname === '/api/teams') {
    const db = await readDb();
    sendJson(res, 200, { teams: db.teams.map(publicTeam) });
    return;
  }

  if (req.method === 'POST' && pathname === '/api/teams') {
    const body = await parseBody(req);
    const name = cleanText(body.name);
    if (!name) return sendError(res, 400, 'VALIDATION_ERROR', 'name is required');
    if (name.length > 80) return sendError(res, 400, 'VALIDATION_ERROR', 'name must be 80 characters or fewer');

    const team = await enqueueWrite(async (db) => {
      const timestamp = now();
      const created = { id: newId('team'), name, createdAt: timestamp, updatedAt: timestamp };
      db.teams.push(created);
      return created;
    });

    sendJson(res, 201, { team: publicTeam(team) });
    return;
  }

  const deleteTeamParams = req.method === 'DELETE' ? matchPath(pathname, '/api/teams/:teamId') : null;
  if (deleteTeamParams) {
    const result = await enqueueWrite(async (db) => {
      const teamIndex = db.teams.findIndex((team) => team.id === deleteTeamParams.teamId);
      if (teamIndex === -1) return null;
      const [deleted] = db.teams.splice(teamIndex, 1);
      db.tasks = db.tasks.filter((task) => task.teamId !== deleteTeamParams.teamId);
      return deleted;
    });

    if (!result) return sendError(res, 404, 'TEAM_NOT_FOUND', 'team not found');
    sendJson(res, 200, { team: publicTeam(result) });
    return;
  }

  const boardParams = req.method === 'GET' ? matchPath(pathname, '/api/teams/:teamId/board') : null;
  if (boardParams) {
    const db = await readDb();
    const team = db.teams.find((item) => item.id === boardParams.teamId);
    if (!team) return sendError(res, 404, 'TEAM_NOT_FOUND', 'team not found');
    const tasks = db.tasks.filter((task) => task.teamId === boardParams.teamId);
    sendJson(res, 200, {
      team: publicTeam(team),
      statuses: STATUSES,
      tasks: tasks.map(publicTask),
      board: groupBoard(tasks)
    });
    return;
  }

  const createTaskParams = req.method === 'POST' ? matchPath(pathname, '/api/teams/:teamId/tasks') : null;
  if (createTaskParams) {
    const body = await parseBody(req);
    const title = cleanText(body.title);
    const description = cleanText(body.description);
    if (!title) return sendError(res, 400, 'VALIDATION_ERROR', 'title is required');
    if (title.length > 160) return sendError(res, 400, 'VALIDATION_ERROR', 'title must be 160 characters or fewer');

    const task = await enqueueWrite(async (db) => {
      const team = db.teams.find((item) => item.id === createTaskParams.teamId);
      if (!team) return null;
      const timestamp = now();
      const created = {
        id: newId('task'),
        teamId: createTaskParams.teamId,
        title,
        description,
        status: 'todo',
        version: 1,
        createdAt: timestamp,
        updatedAt: timestamp
      };
      db.tasks.push(created);
      team.updatedAt = timestamp;
      return created;
    });

    if (!task) return sendError(res, 404, 'TEAM_NOT_FOUND', 'team not found');
    sendJson(res, 201, { task: publicTask(task) });
    return;
  }

  const updateStatusParams = req.method === 'PATCH' ? matchPath(pathname, '/api/teams/:teamId/tasks/:taskId/status') : null;
  if (updateStatusParams) {
    const body = await parseBody(req);
    const status = cleanText(body.status);
    const version = Number(body.version);
    if (!STATUSES.includes(status)) return sendError(res, 400, 'VALIDATION_ERROR', 'status must be one of todo, doing, done');
    if (!Number.isInteger(version) || version < 1) return sendError(res, 400, 'VALIDATION_ERROR', 'version must be a positive integer');

    const result = await enqueueWrite(async (db) => {
      const team = db.teams.find((item) => item.id === updateStatusParams.teamId);
      if (!team) return { type: 'missing-team' };
      const task = db.tasks.find((item) => item.teamId === updateStatusParams.teamId && item.id === updateStatusParams.taskId);
      if (!task) return { type: 'missing-task' };
      if (task.version !== version) return { type: 'conflict', task };
      const timestamp = now();
      task.status = status;
      task.version += 1;
      task.updatedAt = timestamp;
      team.updatedAt = timestamp;
      return { type: 'ok', task };
    });

    if (result.type === 'missing-team') return sendError(res, 404, 'TEAM_NOT_FOUND', 'team not found');
    if (result.type === 'missing-task') return sendError(res, 404, 'TASK_NOT_FOUND', 'task not found');
    if (result.type === 'conflict') {
      return sendError(res, 409, 'VERSION_CONFLICT', 'task version conflict', { current: publicTask(result.task) });
    }
    sendJson(res, 200, { task: publicTask(result.task) });
    return;
  }

  sendError(res, 404, 'NOT_FOUND', `${req.method} ${pathname} not found`);
}

await ensureDb();

const server = http.createServer((req, res) => {
  handleRequest(req, res).catch((error) => {
    if (error instanceof SyntaxError) return sendError(res, 400, 'INVALID_JSON', 'request body must be valid JSON');
    sendError(res, error.status || 500, 'INTERNAL_ERROR', error.message || 'internal server error');
  });
});

server.listen(PORT, () => {
  console.log(`Task Board Lite backend listening on http://localhost:${PORT}`);
});
