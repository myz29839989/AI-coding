const API_BASE = 'http://localhost:3001';
const statuses = [
  { id: 'todo', title: '待办' },
  { id: 'doing', title: '进行中' },
  { id: 'done', title: '已完成' }
];

const state = {
  teams: [],
  board: null,
  activeTeamId: '',
  notice: '',
  loading: false,
  draggingTaskId: ''
};

const app = document.querySelector('#app');

async function request(path, options = {}) {
  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      'content-type': 'application/json',
      ...(options.headers || {})
    }
  });
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    throw Object.assign(new Error(body?.error?.message || `请求失败 (${response.status})`), {
      status: response.status
    });
  }
  return body;
}

function setNotice(message) {
  state.notice = message;
  render();
}

function showError(error) {
  setNotice(error instanceof Error ? error.message : '操作失败');
}

async function loadTeams() {
  state.loading = true;
  render();
  try {
    const data = await request('/api/teams');
    state.teams = data.teams;
  } catch (error) {
    showError(error);
  } finally {
    state.loading = false;
    render();
  }
}

async function loadBoard(teamId = state.activeTeamId) {
  if (!teamId) return;
  state.loading = true;
  render();
  try {
    state.board = await request(`/api/teams/${teamId}/board`);
    state.activeTeamId = teamId;
  } catch (error) {
    showError(error);
  } finally {
    state.loading = false;
    render();
  }
}

async function createTeam(event) {
  event.preventDefault();
  const input = event.currentTarget.elements.teamName;
  const name = input.value.trim();
  if (!name) return;

  try {
    const data = await request('/api/teams', {
      method: 'POST',
      body: JSON.stringify({ name })
    });
    input.value = '';
    state.notice = `已创建团队：${data.team.name}`;
    await loadTeams();
    await loadBoard(data.team.id);
  } catch (error) {
    showError(error);
  }
}

async function deleteTeam(teamId) {
  const team = state.teams.find((item) => item.id === teamId);
  if (!window.confirm(`删除团队「${team?.name || teamId}」？`)) return;

  try {
    await request(`/api/teams/${teamId}`, { method: 'DELETE' });
    state.activeTeamId = '';
    state.board = null;
    state.notice = '团队已删除';
    await loadTeams();
  } catch (error) {
    showError(error);
  }
}

async function createTask(event) {
  event.preventDefault();
  const titleInput = event.currentTarget.elements.taskTitle;
  const descriptionInput = event.currentTarget.elements.taskDescription;
  const title = titleInput.value.trim();
  if (!title || !state.activeTeamId) return;

  try {
    await request(`/api/teams/${state.activeTeamId}/tasks`, {
      method: 'POST',
      body: JSON.stringify({
        title,
        description: descriptionInput.value.trim()
      })
    });
    titleInput.value = '';
    descriptionInput.value = '';
    state.notice = '任务已创建';
    await loadBoard();
  } catch (error) {
    showError(error);
  }
}

async function updateTaskStatus(taskId, status) {
  const task = state.board?.tasks.find((item) => item.id === taskId);
  if (!task || task.status === status) return;

  try {
    await request(`/api/teams/${state.activeTeamId}/tasks/${taskId}/status`, {
      method: 'PATCH',
      body: JSON.stringify({ status, version: task.version })
    });
    state.notice = '状态已更新';
    await loadBoard();
  } catch (error) {
    if (error.status === 409) {
      state.notice = '任务已被其他人更新，已刷新看板';
      await loadBoard();
      return;
    }
    showError(error);
  }
}

function openDashboard() {
  state.activeTeamId = '';
  state.board = null;
  state.notice = '';
  render();
  loadTeams();
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function render() {
  const activeTeam = state.teams.find((team) => team.id === state.activeTeamId) || state.board?.team;
  app.innerHTML = `
    <header class="topbar">
      <div>
        <h1>Task Board Lite</h1>
        <p>${activeTeam ? escapeHtml(activeTeam.name) : '主控面板'}</p>
      </div>
      <div class="topbar-actions">
        ${state.board ? '<button type="button" data-action="dashboard">返回主控</button>' : ''}
        ${state.loading ? '<span class="loading">加载中</span>' : ''}
      </div>
    </header>
    ${state.notice ? `<div class="notice">${escapeHtml(state.notice)}</div>` : ''}
    ${state.board ? renderBoard() : renderDashboard()}
  `;

  bindEvents();
}

function renderDashboard() {
  const teams = state.teams
    .map(
      (team) => `
        <article class="team-row">
          <div>
            <strong>${escapeHtml(team.name)}</strong>
            <small>${escapeHtml(team.id)}</small>
          </div>
          <div class="row-actions">
            <button type="button" data-action="enter" data-team-id="${team.id}">进入</button>
            <button class="danger" type="button" data-action="delete-team" data-team-id="${team.id}">删除</button>
          </div>
        </article>`
    )
    .join('');

  return `
    <section class="panel">
      <div class="panel-head">
        <h2>团队</h2>
        <form class="inline-form" data-form="create-team">
          <input name="teamName" placeholder="新团队名称" aria-label="新团队名称" />
          <button type="submit">创建</button>
        </form>
      </div>
      <div class="team-list">
        ${state.teams.length ? teams : '<p class="empty">暂无团队，先创建一个。</p>'}
      </div>
    </section>
  `;
}

function renderBoard() {
  const groups = Object.fromEntries(statuses.map((status) => [status.id, []]));
  for (const task of state.board.tasks) groups[task.status].push(task);

  const options = state.teams
    .map((team) => `<option value="${team.id}" ${team.id === state.activeTeamId ? 'selected' : ''}>${escapeHtml(team.name)}</option>`)
    .join('');

  const columns = statuses
    .map(
      (status) => `
        <section class="column" data-status="${status.id}">
          <header class="column-head">
            <h2>${status.title}</h2>
            <span>${groups[status.id].length}</span>
          </header>
          <div class="task-list">
            ${
              groups[status.id].length
                ? groups[status.id].map(renderTask).join('')
                : '<p class="empty">暂无任务</p>'
            }
          </div>
        </section>`
    )
    .join('');

  return `
    <section class="board-view">
      <div class="board-toolbar">
        <label>
          团队切换
          <select data-action="switch-team">${options}</select>
        </label>
        <form class="task-form" data-form="create-task">
          <input name="taskTitle" placeholder="任务标题" aria-label="任务标题" />
          <input name="taskDescription" placeholder="描述（可选）" aria-label="任务描述" />
          <button type="submit">新增任务</button>
        </form>
      </div>
      <div class="columns">${columns}</div>
    </section>
  `;
}

function renderTask(task) {
  return `
    <article class="task-card" draggable="true" data-task-id="${task.id}">
      <strong>${escapeHtml(task.title)}</strong>
      ${task.description ? `<p>${escapeHtml(task.description)}</p>` : ''}
      <small>v${task.version}</small>
    </article>
  `;
}

function bindEvents() {
  app.querySelector('[data-form="create-team"]')?.addEventListener('submit', createTeam);
  app.querySelector('[data-form="create-task"]')?.addEventListener('submit', createTask);
  app.querySelector('[data-action="dashboard"]')?.addEventListener('click', openDashboard);
  app.querySelector('[data-action="switch-team"]')?.addEventListener('change', (event) => loadBoard(event.target.value));

  app.querySelectorAll('[data-action="enter"]').forEach((button) => {
    button.addEventListener('click', () => loadBoard(button.dataset.teamId));
  });
  app.querySelectorAll('[data-action="delete-team"]').forEach((button) => {
    button.addEventListener('click', () => deleteTeam(button.dataset.teamId));
  });

  app.querySelectorAll('.task-card').forEach((card) => {
    card.addEventListener('dragstart', (event) => {
      state.draggingTaskId = card.dataset.taskId;
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData('text/plain', card.dataset.taskId);
    });
    card.addEventListener('dragend', () => {
      state.draggingTaskId = '';
    });
  });

  app.querySelectorAll('.column').forEach((column) => {
    column.addEventListener('dragover', (event) => event.preventDefault());
    column.addEventListener('drop', (event) => {
      event.preventDefault();
      const taskId = event.dataTransfer.getData('text/plain') || state.draggingTaskId;
      state.draggingTaskId = '';
      updateTaskStatus(taskId, column.dataset.status);
    });
  });
}

loadTeams();
