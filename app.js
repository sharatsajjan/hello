'use strict';

/* ============================== State ============================== */

const STORAGE_KEY = 'arrows_v1';

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return Object.assign(defaultState(), JSON.parse(raw));
  } catch (e) { /* ignore corrupt storage */ }
  return defaultState();
}

function defaultState() {
  return { level: 1, maxUnlocked: 1, drops: 3, theme: 'sand', sound: true };
}

function saveState() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch (e) { /* ignore */ }
}

let state = loadState();

/* ============================== Maze model ============================== */

const DIRS = {
  N: { dr: -1, dc: 0, opp: 'S' },
  S: { dr: 1, dc: 0, opp: 'N' },
  E: { dr: 0, dc: 1, opp: 'W' },
  W: { dr: 0, dc: -1, opp: 'E' },
};

function sizeForLevel(n) {
  const cols = Math.min(8 + Math.floor(n / 12), 15);
  const rows = Math.min(Math.round(cols * 1.4), 22);
  return { rows, cols };
}

function difficultyForLevel(n) {
  if (n <= 15) return 'Easy';
  if (n <= 40) return 'Medium';
  if (n <= 90) return 'Hard';
  if (n <= 150) return 'Very Hard';
  return 'Super Hard';
}

function makeGrid(rows, cols) {
  const grid = [];
  for (let r = 0; r < rows; r++) {
    const row = [];
    for (let c = 0; c < cols; c++) {
      row.push({ N: true, S: true, E: true, W: true, arrowDir: {} });
    }
    grid.push(row);
  }
  return grid;
}

function inBounds(rows, cols, r, c) {
  return r >= 0 && r < rows && c >= 0 && c < cols;
}

function generateMaze(rows, cols, rng) {
  const grid = makeGrid(rows, cols);
  const visited = Array.from({ length: rows }, () => new Array(cols).fill(false));
  const stack = [[0, 0]];
  visited[0][0] = true;

  while (stack.length) {
    const [r, c] = stack[stack.length - 1];
    const options = [];
    for (const key of Object.keys(DIRS)) {
      const { dr, dc } = DIRS[key];
      const nr = r + dr, nc = c + dc;
      if (inBounds(rows, cols, nr, nc) && !visited[nr][nc]) options.push(key);
    }
    if (options.length === 0) { stack.pop(); continue; }
    const dir = options[Math.floor(rng() * options.length)];
    const { dr, dc, opp } = DIRS[dir];
    const nr = r + dr, nc = c + dc;
    grid[r][c][dir] = false;
    grid[nr][nc][opp] = false;
    visited[nr][nc] = true;
    stack.push([nr, nc]);
  }

  // decorative flow direction per removed wall (random, purely visual)
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      for (const key of Object.keys(DIRS)) {
        grid[r][c].arrowDir[key] = rng() < 0.5;
      }
    }
  }

  return grid;
}

function bfs(grid, rows, cols, startR, startC) {
  const dist = Array.from({ length: rows }, () => new Array(cols).fill(-1));
  const parent = Array.from({ length: rows }, () => new Array(cols).fill(null));
  dist[startR][startC] = 0;
  const queue = [[startR, startC]];
  let qi = 0;
  while (qi < queue.length) {
    const [r, c] = queue[qi++];
    for (const key of Object.keys(DIRS)) {
      if (grid[r][c][key]) continue; // wall present
      const { dr, dc } = DIRS[key];
      const nr = r + dr, nc = c + dc;
      if (!inBounds(rows, cols, nr, nc) || dist[nr][nc] !== -1) continue;
      dist[nr][nc] = dist[r][c] + 1;
      parent[nr][nc] = [r, c];
      queue.push([nr, nc]);
    }
  }
  return { dist, parent };
}

function pathBetween(grid, rows, cols, fromR, fromC, toR, toC) {
  const { parent } = bfs(grid, rows, cols, fromR, fromC);
  const path = [];
  let cur = [toR, toC];
  while (cur) {
    path.push(cur);
    if (cur[0] === fromR && cur[1] === fromC) break;
    cur = parent[cur[0]][cur[1]];
  }
  path.reverse();
  return path;
}

function mulberry32(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* ============================== Game runtime ============================== */

let level = { rows: 0, cols: 0, grid: null, start: null, end: null };
let trail = [];
let hintPath = null;
let hintTimer = null;
let dragging = false;
let lastCell = null;

function buildLevel(n) {
  const { rows, cols } = sizeForLevel(n);
  const rng = mulberry32(n * 2654435761 % 2147483647);
  const grid = generateMaze(rows, cols, rng);
  const start = { r: rows - 1, c: 0 };
  const { dist } = bfs(grid, rows, cols, start.r, start.c);
  let best = { r: 0, c: cols - 1, d: -1 };
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (dist[r][c] > best.d) best = { r, c, d: dist[r][c] };
    }
  }
  level = { rows, cols, grid, start, end: { r: best.r, c: best.c } };
  trail = [{ r: start.r, c: start.c }];
  hintPath = null;
  clearTimeout(hintTimer);
}

/* ============================== Rendering ============================== */

const canvas = document.getElementById('mazeCanvas');
const ctx = canvas.getContext('2d');
let cellSize = 30;
let padding = 16;
let dpr = Math.max(1, window.devicePixelRatio || 1);

function computeCellSize() {
  const wrapWidth = Math.min(window.innerWidth - 32, 680);
  const availHeight = Math.max(window.innerHeight - 300, 300);
  const byWidth = (wrapWidth - padding * 2) / level.cols;
  const byHeight = (availHeight - padding * 2) / level.rows;
  cellSize = Math.max(14, Math.min(byWidth, byHeight, 44));
}

function cellCenter(r, c) {
  return { x: padding + c * cellSize + cellSize / 2, y: padding + r * cellSize + cellSize / 2 };
}

function styleColor(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

function drawArrowHead(cx, cy, dx, dy, size, color) {
  const tipX = cx + dx * size, tipY = cy + dy * size;
  const baseX = cx - dx * size * 0.7, baseY = cy - dy * size * 0.7;
  const px = -dy, py = dx;
  ctx.beginPath();
  ctx.moveTo(tipX, tipY);
  ctx.lineTo(baseX + px * size * 0.55, baseY + py * size * 0.55);
  ctx.lineTo(baseX - px * size * 0.55, baseY - py * size * 0.55);
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
}

function drawWallSegment(x1, y1, x2, y2, pointsForward, color) {
  ctx.strokeStyle = color;
  ctx.lineWidth = Math.max(1.6, cellSize * 0.09);
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();

  const mx = (x1 + x2) / 2, my = (y1 + y2) / 2;
  let dx = x2 - x1, dy = y2 - y1;
  const len = Math.hypot(dx, dy) || 1;
  dx /= len; dy /= len;
  if (!pointsForward) { dx = -dx; dy = -dy; }
  drawArrowHead(mx, my, dx, dy, cellSize * 0.18, color);
}

function render(time) {
  computeCellSize();
  const width = level.cols * cellSize + padding * 2;
  const height = level.rows * cellSize + padding * 2;
  canvas.width = width * dpr;
  canvas.height = height * dpr;
  canvas.style.width = width + 'px';
  canvas.style.height = height + 'px';
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  const cardColor = styleColor('--card');
  const wallColor = styleColor('--wall');
  const pathColor = styleColor('--path');
  const gemColor = styleColor('--gem');
  const accentColor = styleColor('--accent');
  const inkSoft = styleColor('--ink-soft');

  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = cardColor;
  roundRect(ctx, 0, 0, width, height, 18);
  ctx.fill();

  const g = level.grid;
  for (let r = 0; r < level.rows; r++) {
    for (let c = 0; c < level.cols; c++) {
      const x = padding + c * cellSize, y = padding + r * cellSize;
      const cell = g[r][c];
      if (cell.N) drawWallSegment(x, y, x + cellSize, y, cell.arrowDir.N, wallColor);
      if (cell.W) drawWallSegment(x, y, x, y + cellSize, cell.arrowDir.W, wallColor);
      if (c === level.cols - 1 && cell.E) drawWallSegment(x + cellSize, y, x + cellSize, y + cellSize, cell.arrowDir.E, wallColor);
      if (r === level.rows - 1 && cell.S) drawWallSegment(x, y + cellSize, x + cellSize, y + cellSize, cell.arrowDir.S, wallColor);
    }
  }

  // hint path glow
  if (hintPath && hintPath.length > 1) {
    const pulse = 0.5 + 0.5 * Math.sin((time || 0) / 260);
    ctx.save();
    ctx.strokeStyle = accentColor;
    ctx.globalAlpha = 0.35 + pulse * 0.35;
    ctx.lineWidth = cellSize * 0.32;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    hintPath.forEach((p, i) => {
      const { x, y } = cellCenter(p[0], p[1]);
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    });
    ctx.stroke();
    ctx.restore();
  }

  // trail
  if (trail.length > 1) {
    ctx.save();
    ctx.strokeStyle = pathColor;
    ctx.lineWidth = cellSize * 0.28;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    trail.forEach((p, i) => {
      const { x, y } = cellCenter(p.r, p.c);
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    });
    ctx.stroke();
    ctx.restore();
  }

  // start marker
  const startPos = cellCenter(level.start.r, level.start.c);
  ctx.beginPath();
  ctx.arc(startPos.x, startPos.y, cellSize * 0.16, 0, Math.PI * 2);
  ctx.fillStyle = inkSoft;
  ctx.fill();

  // end / gem marker with pulse
  const endPos = cellCenter(level.end.r, level.end.c);
  const pulse2 = 0.6 + 0.4 * Math.sin((time || 0) / 300);
  ctx.save();
  ctx.shadowColor = gemColor;
  ctx.shadowBlur = 10 + pulse2 * 10;
  ctx.fillStyle = gemColor;
  drawDiamond(endPos.x, endPos.y, cellSize * 0.28);
  ctx.restore();

  // player token
  const cur = trail[trail.length - 1];
  const curPos = cellCenter(cur.r, cur.c);
  ctx.beginPath();
  ctx.arc(curPos.x, curPos.y, cellSize * 0.22, 0, Math.PI * 2);
  ctx.fillStyle = accentColor;
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = cardColor;
  ctx.stroke();
}

function drawDiamond(cx, cy, s) {
  ctx.beginPath();
  ctx.moveTo(cx, cy - s);
  ctx.lineTo(cx + s, cy);
  ctx.lineTo(cx, cy + s);
  ctx.lineTo(cx - s, cy);
  ctx.closePath();
  ctx.fill();
}

function roundRect(c, x, y, w, h, r) {
  c.beginPath();
  c.moveTo(x + r, y);
  c.arcTo(x + w, y, x + w, y + h, r);
  c.arcTo(x + w, y + h, x, y + h, r);
  c.arcTo(x, y + h, x, y, r);
  c.arcTo(x, y, x + w, y, r);
  c.closePath();
}

let animHandle = null;
function loop(time) {
  render(time);
  animHandle = requestAnimationFrame(loop);
}
function startLoop() { if (!animHandle) animHandle = requestAnimationFrame(loop); }
function stopLoop() { if (animHandle) { cancelAnimationFrame(animHandle); animHandle = null; } }

/* ============================== Interaction ============================== */

function cellFromPoint(clientX, clientY) {
  const rect = canvas.getBoundingClientRect();
  const scaleX = canvas.width / dpr / rect.width;
  const scaleY = canvas.height / dpr / rect.height;
  const x = (clientX - rect.left) * scaleX;
  const y = (clientY - rect.top) * scaleY;
  const c = Math.floor((x - padding) / cellSize);
  const r = Math.floor((y - padding) / cellSize);
  if (r < 0 || c < 0 || r >= level.rows || c >= level.cols) return null;
  return { r, c };
}

function wallBetween(a, b) {
  const dr = b.r - a.r, dc = b.c - a.c;
  const cell = level.grid[a.r][a.c];
  if (dr === -1 && dc === 0) return cell.N;
  if (dr === 1 && dc === 0) return cell.S;
  if (dr === 0 && dc === 1) return cell.E;
  if (dr === 0 && dc === -1) return cell.W;
  return true;
}

function isAdjacent(a, b) {
  return Math.abs(a.r - b.r) + Math.abs(a.c - b.c) === 1;
}

function tryMove(target) {
  const cur = trail[trail.length - 1];
  if (target.r === cur.r && target.c === cur.c) return;
  if (trail.length >= 2) {
    const prev = trail[trail.length - 2];
    if (prev.r === target.r && prev.c === target.c) {
      trail.pop();
      playSound('back');
      return;
    }
  }
  if (isAdjacent(cur, target) && !wallBetween(cur, target)) {
    trail.push(target);
    playSound('move');
    if (target.r === level.end.r && target.c === level.end.c) {
      onWin();
    }
  }
}

canvas.addEventListener('pointerdown', (e) => {
  dragging = true;
  const cell = cellFromPoint(e.clientX, e.clientY);
  if (cell) { tryMove(cell); lastCell = cell; }
});
window.addEventListener('pointermove', (e) => {
  if (!dragging) return;
  const cell = cellFromPoint(e.clientX, e.clientY);
  if (cell && (!lastCell || cell.r !== lastCell.r || cell.c !== lastCell.c)) {
    tryMove(cell);
    lastCell = cell;
  }
});
window.addEventListener('pointerup', () => { dragging = false; lastCell = null; });

window.addEventListener('keydown', (e) => {
  if (document.getElementById('gameScreen').classList.contains('hidden')) return;
  const cur = trail[trail.length - 1];
  const map = { ArrowUp: 'N', ArrowDown: 'S', ArrowLeft: 'W', ArrowRight: 'E', w: 'N', s: 'S', a: 'W', d: 'E' };
  const dirKey = map[e.key];
  if (!dirKey) return;
  const { dr, dc } = DIRS[dirKey];
  const target = { r: cur.r + dr, c: cur.c + dc };
  if (inBounds(level.rows, level.cols, target.r, target.c)) { tryMove(target); e.preventDefault(); }
});

/* ============================== Sound ============================== */

let audioCtx = null;
function playSound(kind) {
  if (!state.sound) return;
  try {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const o = audioCtx.createOscillator();
    const g = audioCtx.createGain();
    o.connect(g); g.connect(audioCtx.destination);
    const now = audioCtx.currentTime;
    if (kind === 'move') { o.frequency.value = 420; g.gain.value = 0.05; o.start(now); o.stop(now + 0.06); }
    else if (kind === 'back') { o.frequency.value = 260; g.gain.value = 0.05; o.start(now); o.stop(now + 0.06); }
    else if (kind === 'win') {
      [523, 659, 784].forEach((f, i) => {
        const o2 = audioCtx.createOscillator(), g2 = audioCtx.createGain();
        o2.connect(g2); g2.connect(audioCtx.destination);
        o2.frequency.value = f; g2.gain.value = 0.06;
        o2.start(now + i * 0.09); o2.stop(now + i * 0.09 + 0.15);
      });
    }
  } catch (e) { /* audio unsupported */ }
}

/* ============================== UI wiring ============================== */

const homeScreen = document.getElementById('homeScreen');
const gameScreen = document.getElementById('gameScreen');
const levelGrid = document.getElementById('levelGrid');
const levelTitle = document.getElementById('levelTitle');
const difficultyLabel = document.getElementById('difficultyLabel');
const dropCountEl = document.getElementById('dropCount');
const hintAdBadge = document.getElementById('hintAdBadge');
const winOverlay = document.getElementById('winOverlay');
const winLevelText = document.getElementById('winLevelText');
const settingsModal = document.getElementById('settingsModal');
const adOverlay = document.getElementById('adOverlay');
const toastEl = document.getElementById('toast');

function applyTheme() {
  if (state.theme === 'sand') document.documentElement.removeAttribute('data-theme');
  else document.documentElement.setAttribute('data-theme', state.theme);
}

function renderLevelGrid() {
  levelGrid.innerHTML = '';
  const total = Math.max(state.maxUnlocked + 12, 30);
  for (let n = 1; n <= total; n++) {
    const btn = document.createElement('button');
    btn.className = 'level-cell';
    btn.textContent = n;
    const locked = n > state.maxUnlocked;
    if (locked) btn.classList.add('locked');
    if (n === state.level) btn.classList.add('current');
    btn.disabled = locked;
    btn.addEventListener('click', () => startLevel(n));
    levelGrid.appendChild(btn);
  }
}

function updateHud() {
  levelTitle.textContent = 'Level ' + state.level;
  difficultyLabel.textContent = difficultyForLevel(state.level);
  dropCountEl.innerHTML = '';
  for (let i = 0; i < 3; i++) {
    const span = document.createElement('span');
    span.textContent = '💧';
    if (i >= state.drops) span.classList.add('empty');
    dropCountEl.appendChild(span);
  }
  hintAdBadge.classList.toggle('hidden', state.drops > 0);
}

function showScreen(name) {
  homeScreen.classList.toggle('hidden', name !== 'home');
  gameScreen.classList.toggle('hidden', name !== 'game');
  if (name === 'game') startLoop(); else stopLoop();
}

function startLevel(n) {
  state.level = n;
  saveState();
  buildLevel(n);
  updateHud();
  showScreen('game');
  render();
}

function onWin() {
  playSound('win');
  if (state.level >= state.maxUnlocked) {
    state.maxUnlocked = state.level + 1;
    if (state.level % 5 === 0) state.drops = Math.min(state.drops + 1, 3);
  }
  saveState();
  winLevelText.textContent = 'You solved Level ' + state.level + '.';
  setTimeout(() => winOverlay.classList.remove('hidden'), 350);
}

function showToast(msg) {
  toastEl.textContent = msg;
  toastEl.classList.remove('hidden');
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => toastEl.classList.add('hidden'), 1800);
}

document.getElementById('backBtn').addEventListener('click', () => {
  renderLevelGrid();
  showScreen('home');
});

document.getElementById('themeBtn').addEventListener('click', () => {
  const order = ['sand', 'dusk', 'forest'];
  const idx = (order.indexOf(state.theme) + 1) % order.length;
  state.theme = order[idx];
  saveState();
  applyTheme();
  showToast('Theme: ' + state.theme[0].toUpperCase() + state.theme.slice(1));
});

document.getElementById('settingsBtn').addEventListener('click', () => {
  document.getElementById('soundToggle').checked = state.sound;
  settingsModal.classList.remove('hidden');
});
document.getElementById('closeSettingsBtn').addEventListener('click', () => settingsModal.classList.add('hidden'));
document.getElementById('soundToggle').addEventListener('change', (e) => {
  state.sound = e.target.checked;
  saveState();
});
document.getElementById('resetBtn').addEventListener('click', () => {
  if (confirm('Reset all progress?')) {
    state = defaultState();
    saveState();
    applyTheme();
    settingsModal.classList.add('hidden');
    renderLevelGrid();
    showScreen('home');
  }
});

document.getElementById('hintBtn').addEventListener('click', () => {
  if (state.drops > 0) {
    state.drops--;
    saveState();
    updateHud();
    const cur = trail[trail.length - 1];
    hintPath = pathBetween(level.grid, level.rows, level.cols, cur.r, cur.c, level.end.r, level.end.c);
    clearTimeout(hintTimer);
    hintTimer = setTimeout(() => { hintPath = null; }, 3000);
  } else {
    adOverlay.classList.remove('hidden');
    setTimeout(() => {
      adOverlay.classList.add('hidden');
      state.drops = Math.min(state.drops + 1, 3);
      saveState();
      updateHud();
      showToast('+1 hint drop!');
    }, 1400);
  }
});

document.getElementById('nextLevelBtn').addEventListener('click', () => {
  winOverlay.classList.add('hidden');
  startLevel(state.level + 1);
});
document.getElementById('winMenuBtn').addEventListener('click', () => {
  winOverlay.classList.add('hidden');
  renderLevelGrid();
  showScreen('home');
});

window.addEventListener('resize', () => { if (!gameScreen.classList.contains('hidden')) render(); });

/* ============================== Boot ============================== */

applyTheme();
renderLevelGrid();

const urlLevel = parseInt(new URLSearchParams(window.location.search).get('level'), 10);
if (urlLevel && urlLevel > 0) {
  state.maxUnlocked = Math.max(state.maxUnlocked, urlLevel);
  saveState();
  startLevel(urlLevel);
} else {
  showScreen('home');
}
