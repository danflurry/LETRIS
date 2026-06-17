"use strict";

const GRID_WIDTH = 5;
const GRID_HEIGHT = 15;
const CELL_SIZE = 56;
const CANVAS_WIDTH = GRID_WIDTH * CELL_SIZE;
const CANVAS_HEIGHT = GRID_HEIGHT * CELL_SIZE;
const STARTING_BLOCKS = 25;
const SECONDS_UNTIL_NEW_BLOCKS = 60;
const GRAVITY_ROWS = 58;
const TERMINAL_VELOCITY_ROWS = 26;
const COLLISION_RESTITUTION = 0.34;
const SETTLE_SPEED_ROWS = 1.25;
const SETTLE_DISTANCE_ROWS = 0.015;
const AIR_DRAG = 0.994;
const SQUASH_RECOVERY = 14;
const ROTATION_DAMPING = 0.86;
const SPECIAL_FLIP_DURATION = 0.42;
const STORAGE_KEY = "letris.web.v1";
const STAR = "*";
const WORD_CELEBRATION_MS = 3500;

const PALETTE = ["#f4f1de", "#f2cc8f", "#eab69f", "#81b29a", "#e07a5f", "#3d405b"];
const BLOCK_COLORS = [PALETTE[1], PALETTE[2], PALETTE[3]];
const TIMER_BLOCK_COLOR = PALETTE[5];
const WRONG_WORD_COLOR = PALETTE[4];
const WILD_CARD_BLOCK_COLOR = "#a1b5d8";
const DOUBLE_WORD_COLORS = ["#bfa5a0", "#e07a5f"];
const TRIPLE_WORD_COLORS = ["#6a8caf", "#81b29a"];
const WILD_CARD_GRADIENT = ["#c9d6b8", "#f2cc8f"];

const LETTER_WEIGHTS = {
  A: 8.2, B: 1.5, C: 2.8, D: 4.3, E: 12.7, F: 2.2, G: 2.0, H: 6.1, I: 7.0,
  J: 0.2, K: 0.8, L: 4.0, M: 2.4, N: 6.7, O: 7.5, P: 1.9, Q: 0.1, R: 6.0,
  S: 6.3, T: 9.1, U: 2.8, V: 1.0, W: 2.4, X: 0.2, Y: 2.0, Z: 0.1
};
const SCRABBLE_POINTS = {
  A: 1, B: 3, C: 3, D: 2, E: 1, F: 4, G: 2, H: 4, I: 1, J: 8, K: 5, L: 1,
  M: 3, N: 1, O: 1, P: 3, Q: 10, R: 1, S: 1, T: 1, U: 1, V: 4, W: 4, X: 8,
  Y: 4, Z: 10
};
const VOWELS = new Set(["A", "E", "I", "O", "U"]);

const $ = (id) => document.getElementById(id);
const state = loadState();
const homeTitle = {
  blocks: [],
  ready: false
};
const game = {
  grid: [],
  blocks: [],
  selected: [],
  floaters: [],
  level: 1,
  score: 0,
  highestLevel: 1,
  startingBlocks: STARTING_BLOCKS,
  secondsPerMove: SECONDS_UNTIL_NEW_BLOCKS,
  timeLeft: SECONDS_UNTIL_NEW_BLOCKS,
  initialTimerDelay: 2,
  levelThreshold: 3,
  blocksRemoved: 0,
  validBlocksCleared: 0,
  invalidWordPenalty: 1,
  specialBlockTimer: randomRange(10, 25),
  word: "",
  definition: "",
  wordStatus: "",
  wordCelebrationUntil: 0,
  selecting: false,
  tapSelecting: false,
  pointerStart: null,
  pointerMoved: false,
  paused: false,
  gameOver: false,
  levelCompleteTimer: null,
  wordsFoundThisLevel: [],
  username: "",
  playerFoundWords: new Set(),
  lastFrame: 0,
  wordBank: new Map(),
  wordsByLength: new Map(),
  loading: true
};

const canvas = $("gameCanvas");
const ctx = canvas.getContext("2d");
const modal = $("modal");
const modalTitle = $("modalTitle");
const modalBody = $("modalBody");
const modalActions = $("modalActions");
const modalClose = $("modalClose");

canvas.width = CANVAS_WIDTH;
canvas.height = CANVAS_HEIGHT;

init();

async function init() {
  syncViewportHeight();
  bindUi();
  drawLoading();
  await Promise.all([
    preloadAppAssets(),
    loadWordBank()
  ]);
  game.loading = false;
  const remembered = state.settings.lastUsername || "";
  $("username").value = remembered;
  $("rememberName").checked = Boolean(remembered);
  $("loadingScreen").classList.add("hidden");
  $("homeScreen").classList.remove("hidden");
  setupHomeTitlePhysics();
  requestAnimationFrame(loop);
}

function bindUi() {
  window.addEventListener("resize", syncViewportHeight);
  window.visualViewport?.addEventListener("resize", syncViewportHeight);
  window.visualViewport?.addEventListener("scroll", syncViewportHeight);
  $("playerForm").addEventListener("submit", (event) => {
    event.preventDefault();
    const username = normalizeUsername($("username").value);
    if (username.length < 3) {
      showMessage("Name Needed", "<p>Use 3 to 15 letters or numbers.</p>");
      return;
    }
    if ($("rememberName").checked) state.settings.lastUsername = username;
    else delete state.settings.lastUsername;
    ensurePlayer(username);
    saveState();
    startGame(username);
  });
  $("howToButton").addEventListener("click", showHowTo);
  $("scoresButton").addEventListener("click", showScores);
  $("homeButton").addEventListener("click", confirmQuit);
  $("pauseButton").addEventListener("click", togglePause);
  $("timerBox").addEventListener("click", expireTimerNow);
  modalClose.addEventListener("click", closeModal);
  canvas.addEventListener("pointerdown", pointerDown);
  canvas.addEventListener("pointermove", pointerMove);
  canvas.addEventListener("pointerup", pointerUp);
  canvas.addEventListener("pointercancel", pointerUp);
  canvas.addEventListener("contextmenu", (event) => event.preventDefault());
  window.addEventListener("keydown", (event) => {
    if ($("gameScreen").classList.contains("hidden")) return;
    if (event.code === "Space") {
      event.preventDefault();
      if (!game.paused) game.timeLeft = 0;
    }
    if (event.code === "ShiftLeft" || event.code === "ShiftRight") togglePause();
  });
}

async function preloadAppAssets() {
  const fontReady = document.fonts
    ? Promise.all([
      document.fonts.load("30px FredokaLetris"),
      document.fonts.ready
    ])
    : Promise.resolve();
  const imageReady = Promise.all([
    preloadImage("home_icon.png"),
    preloadImage("apple-touch-icon.png"),
    preloadImage("icon-192.png"),
    preloadImage("icon-512.png")
  ]);
  await Promise.all([fontReady, imageReady]);
}

function preloadImage(src) {
  return new Promise((resolve) => {
    const image = new Image();
    image.onload = resolve;
    image.onerror = resolve;
    image.src = src;
  });
}

function syncViewportHeight() {
  const viewportHeight = window.visualViewport?.height || window.innerHeight;
  document.documentElement.style.setProperty("--app-height", `${viewportHeight}px`);
}

async function loadWordBank() {
  try {
    const response = await fetch("word_bank.txt");
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const text = await response.text();
    for (const line of text.split(/\r?\n/)) {
      const at = line.indexOf("@");
      if (at < 1) continue;
      const word = line.slice(0, at).toUpperCase();
      const definition = line.slice(at + 1).split("[")[0].replace(/^"|"$/g, "").trim();
      if (!/^[A-Z]+$/.test(word)) continue;
      game.wordBank.set(word, definition || "No definition available.");
      if (!game.wordsByLength.has(word.length)) game.wordsByLength.set(word.length, []);
      game.wordsByLength.get(word.length).push(word);
    }
  } catch (error) {
    showMessage("Word Bank Missing", `<p>The browser could not load <strong>word_bank.txt</strong>. Run this from a local server or GitHub Pages.</p><p>${escapeHtml(error.message)}</p>`);
  }
}

function startGame(username) {
  game.username = username;
  game.playerFoundWords = new Set(state.players[username].wordsFound || []);
  resetRun();
  document.body.classList.add("playing");
  $("homeScreen").classList.add("hidden");
  $("gameScreen").classList.remove("hidden");
  syncViewportHeight();
}

function resetRun() {
  game.grid = Array.from({ length: GRID_HEIGHT }, () => Array(GRID_WIDTH).fill(null));
  game.blocks = [];
  game.selected = [];
  game.floaters = [];
  game.level = 1;
  game.score = 0;
  game.highestLevel = 1;
  game.startingBlocks = STARTING_BLOCKS;
  game.secondsPerMove = secondsForLevel(game.level);
  game.timeLeft = game.secondsPerMove;
  game.initialTimerDelay = 2;
  game.levelThreshold = levelThresholdFor(game.level);
  game.blocksRemoved = 0;
  game.validBlocksCleared = 0;
  game.specialBlockTimer = randomRange(10, 25);
  game.word = "";
  game.definition = "";
  game.wordStatus = "";
  game.wordCelebrationUntil = 0;
  game.wordsFoundThisLevel = [];
  game.paused = false;
  game.gameOver = false;
  populateInitialBlocks();
  updateHud();
}

function populateInitialBlocks() {
  game.grid = Array.from({ length: GRID_HEIGHT }, () => Array(GRID_WIDTH).fill(null));
  game.blocks = [];
  let placed = 0;
  for (let y = GRID_HEIGHT - 1; y >= 0 && placed < game.startingBlocks; y -= 1) {
    const cols = shuffle([...Array(GRID_WIDTH).keys()]);
    for (const x of cols) {
      if (placed >= game.startingBlocks) break;
      const block = makeBlock(weightedRandomLetter(), x, y, randomChoice(BLOCK_COLORS));
      block.drawY = -randomRange(2, 7);
      block.fallDelay = (GRID_HEIGHT - 1 - y) * 0.08 + randomRange(0, 0.08);
      addBlock(block);
      placed += 1;
    }
  }
}

function makeBlock(letter, x, y, color, isPenalty = false) {
  return {
    id: crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`,
    letter,
    x,
    y,
    drawY: y,
    color,
    isPenalty,
    selected: false,
    special: null,
    flip: null,
    specialTimer: 0,
    velocity: 0,
    angularVelocity: 0,
    rotation: 0,
    squash: 0,
    grounded: true,
    fallDelay: 0,
    flash: 0
  };
}

function addBlock(block) {
  game.grid[block.y][block.x] = block;
  game.blocks.push(block);
}

function removeBlock(block) {
  if (game.grid[block.y]?.[block.x] === block) game.grid[block.y][block.x] = null;
  game.blocks = game.blocks.filter((item) => item !== block);
}

function loop(now) {
  const dt = Math.min((now - (game.lastFrame || now)) / 1000, 0.05);
  game.lastFrame = now;
  updateHomeTitlePhysics(dt);
  if (!$("gameScreen").classList.contains("hidden") && !game.paused && !game.loading) update(dt);
  draw();
  requestAnimationFrame(loop);
}

function setupHomeTitlePhysics() {
  const spans = [...document.querySelectorAll(".brand-title span")];
  homeTitle.blocks = spans.map((element, index) => ({
    element,
    drawY: -randomRange(1.8, 3.4) - index * 0.22,
    y: 0,
    velocity: 0,
    squash: 0,
    rotation: randomRange(-0.11, 0.11),
    angularVelocity: randomRange(-0.03, 0.03),
    grounded: false,
    fallDelay: index * 0.085
  }));
  homeTitle.ready = true;
  updateHomeTitlePhysics(0);
}

function updateHomeTitlePhysics(dt) {
  if (!homeTitle.ready || document.body.classList.contains("playing")) return;
  for (const block of homeTitle.blocks) {
    const tileHeight = block.element.getBoundingClientRect().height || 64;
    if (block.fallDelay > 0) {
      block.fallDelay -= dt;
    } else {
      updateLooseBlockPhysics(block, dt);
    }
    const squash = Math.max(0, Math.min(1, block.squash || 0));
    const scaleX = 1 + squash * 0.09;
    const scaleY = 1 - squash * 0.12;
    block.element.style.transform = `translateY(${block.drawY * tileHeight}px) rotate(${block.rotation}rad) scale(${scaleX}, ${scaleY})`;
  }
}

function updateLooseBlockPhysics(block, dt) {
  const targetY = block.y;
  const airborne = block.drawY < targetY - SETTLE_DISTANCE_ROWS || block.velocity > SETTLE_SPEED_ROWS;

  if (airborne) {
    block.grounded = false;
    block.velocity = Math.min((block.velocity + GRAVITY_ROWS * dt) * AIR_DRAG, TERMINAL_VELOCITY_ROWS);
    block.drawY += block.velocity * dt;
  } else if (!block.grounded) {
    block.velocity += GRAVITY_ROWS * dt;
    block.drawY += block.velocity * dt;
  }

  if (block.drawY >= targetY) {
    const impactSpeed = Math.max(0, block.velocity);
    block.drawY = targetY;

    if (impactSpeed > SETTLE_SPEED_ROWS) {
      block.velocity = -impactSpeed * COLLISION_RESTITUTION;
      block.squash = Math.min(1, block.squash + impactSpeed / TERMINAL_VELOCITY_ROWS);
      block.angularVelocity += (Math.random() - 0.5) * Math.min(0.12, impactSpeed * 0.006);
    } else {
      block.velocity = 0;
      block.grounded = true;
      block.rotation *= 0.65;
      block.angularVelocity *= 0.5;
    }
  }

  if (block.drawY > targetY) block.drawY = targetY;
  block.squash = Math.max(0, block.squash - SQUASH_RECOVERY * dt);
  block.angularVelocity *= Math.pow(ROTATION_DAMPING, dt * 60);
  block.rotation += block.angularVelocity;
  block.rotation *= Math.pow(0.985, dt * 60);

  if (Math.abs(block.velocity) < 0.04 && Math.abs(block.drawY - targetY) < SETTLE_DISTANCE_ROWS) {
    block.drawY = targetY;
    block.velocity = 0;
    block.grounded = true;
  }
}

function update(dt) {
  if (game.gameOver) return;
  applyGravity(dt);
  updateTimer(dt);
  updateSpecials(dt);
  updateFloaters(dt);
  checkLevelCompletion(dt);
  updateHud();
  if (game.wordCelebrationUntil && performance.now() >= game.wordCelebrationUntil) {
    game.wordCelebrationUntil = 0;
    updateCurrentWord();
  }
}

function updateTimer(dt) {
  if (game.initialTimerDelay > 0) {
    game.initialTimerDelay = Math.max(0, game.initialTimerDelay - dt);
    game.timeLeft = game.secondsPerMove;
    return;
  }
  game.timeLeft -= dt;
  if (game.timeLeft <= 0) expireTimerNow();
}

function resetMoveTimer(delay = 0) {
  game.timeLeft = game.secondsPerMove;
  game.initialTimerDelay = delay;
  updateHud();
}

function expireTimerNow() {
  if ($("gameScreen").classList.contains("hidden") || game.paused || game.gameOver || game.loading) return;
  game.initialTimerDelay = 0;
  addNewBlocks(5, "timer");
  game.timeLeft = game.secondsPerMove;
  updateHud();
}

function updateSpecials(dt) {
  for (const block of game.blocks) {
    updateBlockFlip(block, dt);
    if (!block.special) continue;
    block.specialTimer -= dt;
    if (block.specialTimer <= 0) {
      startSpecialFlip(block, null);
      block.specialTimer = 0;
    }
  }
  game.specialBlockTimer -= dt;
  if (game.specialBlockTimer > 0) return;
  const candidates = game.blocks.filter((block) => !block.special && block.letter !== STAR);
  if (candidates.length) {
    const block = randomChoice(candidates);
    startSpecialFlip(block, Math.random() < 0.75 ? "double" : "triple");
  }
  game.specialBlockTimer = randomRange(5, 10);
}

function updateFloaters(dt) {
  for (const floater of game.floaters) {
    floater.age += dt;
    floater.y += floater.vy * dt;
    floater.x += floater.vx * dt;
    floater.vy += 42 * dt;
    floater.wobble += floater.spin * dt;
    for (const particle of floater.particles) {
      particle.age += dt;
      particle.x += particle.vx * dt;
      particle.y += particle.vy * dt;
      particle.vy += 80 * dt;
    }
  }
  game.floaters = game.floaters.filter((floater) => floater.age < floater.life);
}

function startSpecialFlip(block, nextSpecial) {
  if (block.flip) return;
  block.flip = {
    age: 0,
    duration: SPECIAL_FLIP_DURATION,
    from: block.special,
    to: nextSpecial,
    switched: false
  };
  if (nextSpecial) {
    block.specialTimer = 10;
    block.flash = Math.max(block.flash, 0.35);
  }
}

function updateBlockFlip(block, dt) {
  if (!block.flip) return;
  block.flip.age += dt;
  const halfway = block.flip.duration / 2;
  if (!block.flip.switched && block.flip.age >= halfway) {
    block.special = block.flip.to;
    block.flip.switched = true;
    block.flash = Math.max(block.flash, 0.22);
  }
  if (block.flip.age >= block.flip.duration) {
    block.special = block.flip.to;
    if (!block.special) block.specialTimer = 0;
    block.flip = null;
  }
}

function applyGravity(dt) {
  for (let x = 0; x < GRID_WIDTH; x += 1) {
    for (let y = GRID_HEIGHT - 2; y >= 0; y -= 1) {
      const block = game.grid[y][x];
      if (!block || game.grid[y + 1][x]) continue;
      game.grid[y][x] = null;
      let target = y;
      while (target + 1 < GRID_HEIGHT && !game.grid[target + 1][x]) target += 1;
      block.y = target;
      block.grounded = false;
      game.grid[target][x] = block;
    }
  }
  for (const block of game.blocks) {
    if (block.fallDelay > 0) {
      block.fallDelay -= dt;
      continue;
    }

    updateBlockPhysics(block, dt);
    if (block.flash > 0) block.flash = Math.max(0, block.flash - dt);
  }
}

function updateBlockPhysics(block, dt) {
  const targetY = block.y;
  const airborne = block.drawY < targetY - SETTLE_DISTANCE_ROWS || block.velocity > SETTLE_SPEED_ROWS;

  if (airborne) {
    block.grounded = false;
    block.velocity = Math.min((block.velocity + GRAVITY_ROWS * dt) * AIR_DRAG, TERMINAL_VELOCITY_ROWS);
    block.drawY += block.velocity * dt;
  } else if (!block.grounded) {
    block.velocity += GRAVITY_ROWS * dt;
    block.drawY += block.velocity * dt;
  }

  if (block.drawY >= targetY) {
    const impactSpeed = Math.max(0, block.velocity);
    block.drawY = targetY;

    if (impactSpeed > SETTLE_SPEED_ROWS) {
      block.velocity = -impactSpeed * COLLISION_RESTITUTION;
      block.squash = Math.min(1, block.squash + impactSpeed / TERMINAL_VELOCITY_ROWS);
      block.angularVelocity += (Math.random() - 0.5) * Math.min(0.12, impactSpeed * 0.006);
      transferImpactToStack(block, impactSpeed);
    } else {
      block.velocity = 0;
      block.grounded = true;
      block.rotation *= 0.65;
      block.angularVelocity *= 0.5;
    }
  }

  if (block.drawY > targetY) block.drawY = targetY;
  block.squash = Math.max(0, block.squash - SQUASH_RECOVERY * dt);
  block.angularVelocity *= Math.pow(ROTATION_DAMPING, dt * 60);
  block.rotation += block.angularVelocity;
  block.rotation *= Math.pow(0.985, dt * 60);

  if (Math.abs(block.velocity) < 0.04 && Math.abs(block.drawY - targetY) < SETTLE_DISTANCE_ROWS) {
    block.drawY = targetY;
    block.velocity = 0;
    block.grounded = true;
  }
}

function transferImpactToStack(block, impactSpeed) {
  const below = game.grid[block.y + 1]?.[block.x];
  if (!below) return;
  below.squash = Math.min(0.75, below.squash + impactSpeed / (TERMINAL_VELOCITY_ROWS * 1.8));
  below.angularVelocity += (Math.random() - 0.5) * Math.min(0.06, impactSpeed * 0.003);
}

function addNewBlocks(count, source = "timer") {
  const isPenalty = source === true || source === "penalty";
  const color = isPenalty ? WRONG_WORD_COLOR : source === "timer" ? TIMER_BLOCK_COLOR : null;
  for (let i = 0; i < count; i += 1) {
    const x = shortestOpenColumn();
    if (x === -1) {
      endGame();
      return;
    }
    const row = firstEmptyRow(x);
    if (row === -1) {
      endGame();
      return;
    }
    const block = makeBlock(weightedRandomLetter(), x, row, color || randomChoice(BLOCK_COLORS), isPenalty);
    block.drawY = -randomRange(1, 5);
    block.fallDelay = randomRange(0, 0.09);
    addBlock(block);
  }
  if (checkGameOver()) endGame();
}

function shortestOpenColumn() {
  const openColumns = [...Array(GRID_WIDTH).keys()].filter((x) => firstEmptyRow(x) !== -1);
  if (!openColumns.length) return -1;
  const minHeight = Math.min(...openColumns.map(columnHeight));
  return randomChoice(openColumns.filter((x) => columnHeight(x) === minHeight));
}

function firstEmptyRow(x) {
  for (let y = 0; y < GRID_HEIGHT; y += 1) {
    if (!game.grid[y][x]) return y;
  }
  return -1;
}

function columnHeight(x) {
  return game.grid.reduce((sum, row) => sum + (row[x] ? 1 : 0), 0);
}

function checkGameOver() {
  return [...Array(GRID_WIDTH).keys()].some((x) => columnHeight(x) >= GRID_HEIGHT - 1);
}

function checkLevelCompletion(dt) {
  const thresholdRow = GRID_HEIGHT - game.levelThreshold;
  const complete = game.blocks.length > 0 && game.blocks.every((block) => block.y >= thresholdRow);
  if (!complete) {
    game.levelCompleteTimer = null;
    return;
  }
  game.levelCompleteTimer = game.levelCompleteTimer === null ? 1 : game.levelCompleteTimer - dt;
  if (game.levelCompleteTimer <= 0) showLevelComplete();
}

function levelThresholdFor(level) {
  return Math.max(1, 3 - Math.floor(level / 10));
}

function secondsForLevel(level) {
  return Math.max(5, SECONDS_UNTIL_NEW_BLOCKS - Math.floor(level / 10) * 5);
}

function pointerDown(event) {
  event.preventDefault();
  if (game.paused || game.gameOver) return;
  if (canvas.setPointerCapture) canvas.setPointerCapture(event.pointerId);
  const pos = pointerPosition(event);
  const block = getBlockAt(pos.x, pos.y);
  game.definition = "";
  game.wordStatus = "";
  game.wordCelebrationUntil = 0;
  game.pointerStart = pos;
  game.pointerMoved = false;
  if (!block) {
    if (game.tapSelecting) finishTapSelection();
    return;
  }
  if (game.tapSelecting && block === game.selected.at(-1) && game.selected.length >= 3) {
    finishTapSelection();
    return;
  }
  if (!game.tapSelecting) clearSelection();
  addBlockToSelection(block);
  game.selecting = true;
  updateCurrentWord();
}

function pointerMove(event) {
  event.preventDefault();
  if (!game.selecting || game.paused || game.gameOver) return;
  const pos = pointerPosition(event);
  if (game.pointerStart && Math.hypot(pos.x - game.pointerStart.x, pos.y - game.pointerStart.y) > CELL_SIZE * 0.18) {
    game.pointerMoved = true;
    game.tapSelecting = false;
  }
  const candidate = getBlockAt(pos.x, pos.y);
  if (!candidate) return;
  const last = game.selected.at(-1);
  if (last && last !== candidate) {
    const candidateVector = [candidate.x - last.x, candidate.y - last.y];
    const mouseVector = [pos.x / CELL_SIZE - (last.x + 0.5), pos.y / CELL_SIZE - (last.y + 0.5)];
    if (angleBetween(mouseVector, candidateVector) > 35) return;
  }
  const existingIndex = game.selected.indexOf(candidate);
  if (existingIndex >= 0) {
    while (game.selected.length > existingIndex + 1) game.selected.pop().selected = false;
  } else if (isNeighbor(last, candidate)) {
    addBlockToSelection(candidate);
  }
  updateCurrentWord();
}

function pointerUp(event) {
  event?.preventDefault();
  if (event?.pointerId !== undefined && canvas.releasePointerCapture) {
    try {
      canvas.releasePointerCapture(event.pointerId);
    } catch {
      /* Pointer capture may already be released by Safari. */
    }
  }
  if (!game.selecting) return;
  const wasTapSelecting = game.tapSelecting;
  game.selecting = false;
  if (wasTapSelecting && !game.pointerMoved) {
    updateCurrentWord();
    return;
  }
  if (!game.pointerMoved && game.selected.length === 1) {
    game.tapSelecting = true;
    updateCurrentWord();
    return;
  }
  finishTapSelection();
}

function addBlockToSelection(block) {
  const existingIndex = game.selected.indexOf(block);
  if (existingIndex >= 0) {
    while (game.selected.length > existingIndex + 1) game.selected.pop().selected = false;
    return;
  }
  const last = game.selected.at(-1);
  if (!isNeighbor(last, block)) return;
  block.selected = true;
  game.selected.push(block);
}

function finishTapSelection() {
  game.tapSelecting = false;
  game.pointerStart = null;
  game.pointerMoved = false;
  if (game.selected.length) submitSelection();
}

function pointerPosition(event) {
  const rect = canvas.getBoundingClientRect();
  return {
    x: ((event.clientX - rect.left) / rect.width) * CANVAS_WIDTH,
    y: ((event.clientY - rect.top) / rect.height) * CANVAS_HEIGHT
  };
}

function getBlockAt(px, py) {
  let bestBlock = null;
  let bestDistance = Infinity;
  for (const block of game.blocks) {
    const cx = (block.x + 0.5) * CELL_SIZE;
    const cy = (block.drawY + 0.5) * CELL_SIZE;
    const distance = Math.hypot(px - cx, py - cy);
    if (distance < bestDistance && distance <= CELL_SIZE * 0.43) {
      bestBlock = block;
      bestDistance = distance;
    }
  }
  return bestBlock;
}

function isNeighbor(a, b) {
  if (!a || !b) return true;
  return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y)) <= 1;
}

function submitSelection() {
  let word = game.selected.map((block) => block.letter).join("").toUpperCase();
  let resolvedWord = word;
  if (word.includes(STAR)) {
    const matches = (game.wordsByLength.get(word.length) || []).filter((candidate) => wildcardMatch(word, candidate));
    if (matches.length) resolvedWord = randomChoice(matches);
  }

  if (resolvedWord.length >= 3 && game.wordBank.has(resolvedWord)) {
    acceptWord(word, resolvedWord);
  } else {
    rejectWord(word);
  }
  clearSelection();
  updateCurrentWord();
}

function acceptWord(displayWord, resolvedWord) {
  game.word = resolvedWord;
  game.definition = game.wordBank.get(resolvedWord);
  game.wordStatus = wordStatus(resolvedWord);
  game.wordCelebrationUntil = ["brand_new", "player_new"].includes(game.wordStatus) ? performance.now() + WORD_CELEBRATION_MS : 0;
  resetMoveTimer();
  game.blocksRemoved += game.selected.length;
  game.validBlocksCleared += game.selected.length;
  game.wordsFoundThisLevel.push(resolvedWord);
  game.playerFoundWords.add(resolvedWord);
  recordWord(resolvedWord);

  const basePoints = getWordScore(resolvedWord);
  const specialMultiplier = game.selected.reduce((product, block) => {
    if (block.special === "double") return product * 2;
    if (block.special === "triple") return product * 3;
    return product;
  }, 1);
  const totalPoints = basePoints * specialMultiplier;
  game.score += totalPoints;
  recordPlayerScore(resolvedWord, basePoints, totalPoints);
  const scoreOrigin = centerOfSelection();
  addFloater(resolvedWord, { x: scoreOrigin.x, y: scoreOrigin.y - 30 }, WILD_CARD_BLOCK_COLOR);
  addFloater(`+${totalPoints}`, scoreOrigin, PALETTE[5]);
  if (specialMultiplier > 1) {
    addFloater(`${specialMultiplier}X`, { x: scoreOrigin.x, y: scoreOrigin.y - 58 }, PALETTE[4]);
  }

  for (const block of game.selected) removeBlock(block);
  while (game.validBlocksCleared >= 20) {
    const block = randomChoice(game.blocks);
    if (block) {
      block.letter = STAR;
      block.color = WILD_CARD_BLOCK_COLOR;
      startSpecialFlip(block, null);
      block.flash = 0.8;
    }
    game.validBlocksCleared -= 20;
  }
  if (displayWord !== resolvedWord) {
    game.word = resolvedWord;
  }
}

function rejectWord(word) {
  game.word = "";
  game.definition = "";
  if (word.length < 3) return;
  const count = game.selected.length * game.invalidWordPenalty;
  for (const block of game.selected) removeBlock(block);
  addNewBlocks(count, "penalty");
}

function clearSelection() {
  for (const block of game.selected) block.selected = false;
  game.selected = [];
  game.tapSelecting = false;
  game.pointerStart = null;
  game.pointerMoved = false;
}

function updateCurrentWord() {
  const currentWord = $("currentWord");
  const word = game.selected.length
    ? game.selected.map((block) => block.letter === STAR ? "★" : block.letter).join("")
    : game.word;
  const celebrate = !game.selected.length && game.definition && performance.now() < game.wordCelebrationUntil;
  currentWord.classList.toggle("celebrate-word", celebrate);
  if (celebrate) {
    currentWord.innerHTML = [...word].map((letter, index) => `<span style="--i:${index}">${escapeHtml(letter)}</span>`).join("");
  } else {
    currentWord.textContent = word;
  }
  updateFindStatus();
  fitText(currentWord, 15, 30);
}

function updateFindStatus() {
  const findStatus = $("findStatus");
  if (!findStatus) return;
  findStatus.textContent = game.definition ? wordStatusLabel(game.wordStatus) : "";
  findStatus.classList.toggle("show", Boolean(findStatus.textContent));
}

function wordStatusLabel(status) {
  if (status === "brand_new") return "New Global Word Found!";
  if (status === "player_new") return "New Word Found!";
  return "";
}

function wordStatus(word) {
  const first = state.globalWords[word];
  if (!first) return "brand_new";
  if (!game.playerFoundWords.has(word)) return "player_new";
  return "already_found";
}

function recordWord(word) {
  if (!state.globalWords[word]) state.globalWords[word] = game.username;
  const player = state.players[game.username];
  if (!player.wordsFound.includes(word)) player.wordsFound.push(word);
  saveState();
}

function recordPlayerScore(word, basePoints, totalPoints) {
  const player = state.players[game.username];
  player.highScore = Math.max(player.highScore || 0, game.score);
  player.highestLevel = Math.max(player.highestLevel || 1, game.highestLevel);
  if (!player.longestWord || word.length > player.longestWord.length) player.longestWord = word;
  if (!player.bestBaseWord || basePoints > player.bestBasePoints) {
    player.bestBaseWord = word;
    player.bestBasePoints = basePoints;
  }
  if (!player.bestTotalWord || totalPoints > player.bestTotalPoints) {
    player.bestTotalWord = word;
    player.bestTotalPoints = totalPoints;
  }
  saveState();
}

function getWordScore(word) {
  const raw = [...word].reduce((sum, letter) => sum + (SCRABBLE_POINTS[letter] || 0), 0);
  const lengthMultiplier = word.length >= 15 ? 10 : word.length >= 10 ? 5 : word.length >= 7 ? 2.5 : word.length >= 5 ? 1.5 : 1;
  return Math.floor(Math.floor(raw * lengthMultiplier) * (1 + (game.level - 1) * 0.05));
}

function weightedRandomLetter() {
  const letters = Object.keys(LETTER_WEIGHTS);
  const counts = game.blocks.reduce((memo, block) => {
    if (VOWELS.has(block.letter)) memo.vowels += 1;
    else if (LETTER_WEIGHTS[block.letter]) memo.consonants += 1;
    return memo;
  }, { vowels: 0, consonants: 0 });
  const total = counts.vowels + counts.consonants;
  const needsVowels = total === 0 || counts.vowels / total < 0.4;
  const weighted = letters.map((letter) => ({
    letter,
    weight: LETTER_WEIGHTS[letter] * (VOWELS.has(letter) === needsVowels ? 1.5 : 1)
  }));
  const sum = weighted.reduce((value, item) => value + item.weight, 0);
  let roll = Math.random() * sum;
  for (const item of weighted) {
    roll -= item.weight;
    if (roll <= 0) return item.letter;
  }
  return "E";
}

function showLevelComplete() {
  game.paused = true;
  const words = [...new Set(game.wordsFoundThisLevel)].sort((a, b) => b.length - a.length);
  const list = words.length
    ? `<ul>${words.map((word) => `<li><strong>${word}</strong>: ${escapeHtml(game.wordBank.get(word) || "")}</li>`).join("")}</ul>`
    : "<p>No words found this level.</p>";
  showModal(`Level ${game.level} Complete`, list, [
    ["Continue", () => {
      closeModal();
      advanceLevel();
    }],
    ["Quit to Home", () => {
      closeModal();
      goHome();
    }]
  ]);
}

function advanceLevel() {
  game.level += 1;
  game.highestLevel = Math.max(game.highestLevel, game.level);
  game.startingBlocks = Math.min(game.startingBlocks + 1, GRID_WIDTH * GRID_HEIGHT - 1);
  game.secondsPerMove = secondsForLevel(game.level);
  game.timeLeft = game.secondsPerMove;
  game.initialTimerDelay = 2;
  game.levelThreshold = levelThresholdFor(game.level);
  game.wordsFoundThisLevel = [];
  game.levelCompleteTimer = null;
  game.paused = false;
  populateInitialBlocks();
}

function endGame() {
  game.gameOver = true;
  game.paused = true;
  recordPlayerScore(game.word || "", 0, 0);
  showModal("Game Over", `<p>${escapeHtml(game.username)} reached level ${game.highestLevel} with ${game.score} points.</p>`, [
    ["Play Again", () => {
      closeModal();
      startGame(game.username);
    }],
    ["Home", () => {
      closeModal();
      goHome();
    }]
  ]);
}

function confirmQuit() {
  game.paused = true;
  showModal("Quit Game?", "<p>Your local records are saved. The current board will end.</p>", [
    ["Quit", () => {
      closeModal();
      goHome();
    }],
    ["Resume", () => {
      closeModal();
      game.paused = false;
    }]
  ]);
}

function goHome() {
  document.body.classList.remove("playing");
  $("gameScreen").classList.add("hidden");
  $("homeScreen").classList.remove("hidden");
  syncViewportHeight();
}

function togglePause() {
  game.paused = !game.paused;
  $("pauseButton").textContent = game.paused ? ">" : "II";
}

function draw() {
  if ($("gameScreen").classList.contains("hidden")) return;
  ctx.clearRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
  drawBoardBackground();
  drawThreshold();
  for (const block of [...game.blocks].sort((a, b) => a.drawY - b.drawY)) drawBlock(block);
  drawSelectionLines();
  drawFloaters();
  if (game.paused && !game.gameOver && !modal.open) drawPauseOverlay();
  const definition = $("definition");
  definition.innerHTML = game.definition ? definitionHtml() : "";
  updateFindStatus();
  fitText(definition, 11, 16);
}

function drawBoardBackground() {
  ctx.save();
  ctx.globalCompositeOperation = "copy";
  ctx.fillStyle = PALETTE[0];
  ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
  ctx.restore();
}

function drawLoading() {
  ctx.fillStyle = PALETTE[0];
  ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
  ctx.fillStyle = PALETTE[5];
  ctx.font = "26px FredokaLetris, sans-serif";
  ctx.textAlign = "center";
  ctx.fillText("Loading words...", CANVAS_WIDTH / 2, CANVAS_HEIGHT / 2);
}

function drawGridLines() {
  // Intentionally blank: the board is cleaner without permanent gridlines.
}

function drawThreshold() {
  if (game.levelThreshold <= 0) return;
  const y = (GRID_HEIGHT - game.levelThreshold) * CELL_SIZE;
  roundRect(0, y, CANVAS_WIDTH, game.levelThreshold * CELL_SIZE, 14, "rgba(106,140,175,0.38)");
}

function drawBlock(block) {
  const squash = Math.max(0, Math.min(1, block.squash || 0));
  const wobble = Math.max(-0.11, Math.min(0.11, block.rotation || 0));
  const flipProgress = block.flip ? Math.min(1, block.flip.age / block.flip.duration) : 0;
  const flipScale = block.flip ? Math.max(0.08, Math.abs(Math.cos(flipProgress * Math.PI))) : 1;
  const squashX = squash * 4.5;
  const squashY = squash * 7;
  const x = block.x * CELL_SIZE + 4 - squashX;
  const y = block.drawY * CELL_SIZE + 4 + squashY;
  const size = CELL_SIZE - 8;
  const visualWidth = size + squashX * 2;
  const visualHeight = Math.max(size * 0.78, size - squashY * 1.35);
  const centerX = x + visualWidth / 2;
  const centerY = y + visualHeight / 2;

  ctx.save();
  ctx.translate(centerX, centerY);
  ctx.rotate(wobble);
  ctx.scale(flipScale, 1);
  ctx.translate(-centerX, -centerY);
  ctx.shadowColor = "rgba(61,64,91,0.25)";
  ctx.shadowBlur = 8 + squash * 5;
  ctx.shadowOffsetY = 4 + squash * 2;
  const fill = block.letter === STAR ? makeGradient(x, y, visualWidth, WILD_CARD_GRADIENT) : block.special ? makeGradient(x, y, visualWidth, block.special === "double" ? DOUBLE_WORD_COLORS : TRIPLE_WORD_COLORS) : block.color;
  roundRect(x, y, visualWidth, visualHeight, 8, fill);
  ctx.shadowColor = "transparent";
  if (block.selected) {
    ctx.lineWidth = 5;
    ctx.strokeStyle = PALETTE[5];
    strokeRoundRect(x + 2, y + 2, visualWidth - 4, visualHeight - 4, 8);
  }
  if (block.flash > 0) {
    ctx.globalAlpha = Math.min(0.45, block.flash);
    roundRect(x, y, visualWidth, visualHeight, 8, "#ffffff");
    ctx.globalAlpha = 1;
  }
  ctx.fillStyle = block.color === WRONG_WORD_COLOR ? PALETTE[5] : block.color === TIMER_BLOCK_COLOR ? PALETTE[0] : "#111111";
  ctx.font = block.letter === STAR ? "34px FredokaLetris, sans-serif" : "30px FredokaLetris, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(block.letter === STAR ? "★" : block.letter, centerX, centerY + 1);
  ctx.restore();
}

function drawSelectionLines() {
  if (game.selected.length < 2) return;
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
  for (const block of game.selected) {
    ctx.roundRect(block.x * CELL_SIZE + 6, block.drawY * CELL_SIZE + 6, CELL_SIZE - 12, CELL_SIZE - 12, 6);
  }
  ctx.clip("evenodd");
  ctx.strokeStyle = PALETTE[5];
  ctx.lineWidth = 5;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.beginPath();
  game.selected.forEach((block, index) => {
    const x = (block.x + 0.5) * CELL_SIZE;
    const y = (block.drawY + 0.5) * CELL_SIZE;
    if (index === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.stroke();
  ctx.restore();
}

function drawFloaters() {
  ctx.save();
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  for (const floater of game.floaters) {
    const progress = Math.min(1, floater.age / floater.life);
    const alpha = Math.max(0, 1 - Math.max(0, progress - 0.45) / 0.55);
    const pop = 1 + Math.sin(Math.min(1, progress * 2.2) * Math.PI) * 0.22;

    for (const particle of floater.particles) {
      const particleProgress = Math.min(1, particle.age / particle.life);
      ctx.globalAlpha = alpha * (1 - particleProgress);
      ctx.fillStyle = particle.color;
      ctx.beginPath();
      ctx.arc(particle.x, particle.y, particle.radius * (1 - particleProgress * 0.35), 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.globalAlpha = alpha * 0.28;
    ctx.strokeStyle = floater.color;
    ctx.lineWidth = 4 * (1 - progress);
    ctx.beginPath();
    ctx.arc(floater.originX, floater.originY, 12 + progress * 38, 0, Math.PI * 2);
    ctx.stroke();

    ctx.globalAlpha = alpha;
    ctx.fillStyle = floater.color;
    ctx.save();
    ctx.translate(floater.x, floater.y);
    ctx.rotate(Math.sin(floater.wobble) * 0.05);
    ctx.scale(pop, pop);
    ctx.shadowColor = "rgba(61,64,91,0.28)";
    ctx.shadowBlur = 10;
    ctx.shadowOffsetY = 4;
    ctx.font = `${floater.fontSize}px FredokaLetris, sans-serif`;
    ctx.strokeStyle = PALETTE[0];
    ctx.lineWidth = 5;
    ctx.strokeText(floater.text, 0, 0);
    ctx.fillText(floater.text, 0, 0);
    ctx.restore();
  }
  ctx.globalAlpha = 1;
  ctx.restore();
}

function drawPauseOverlay() {
  ctx.fillStyle = "rgba(244,241,222,0.72)";
  ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
  ctx.fillStyle = PALETTE[5];
  ctx.font = "36px FredokaLetris, sans-serif";
  ctx.textAlign = "center";
  ctx.fillText("Paused", CANVAS_WIDTH / 2, CANVAS_HEIGHT / 2);
}

function definitionHtml() {
  return escapeHtml(game.definition);
}

function makeGradient(x, y, size, colors) {
  const gradient = ctx.createLinearGradient(x, y, x + size, y + size);
  gradient.addColorStop(0, colors[0]);
  gradient.addColorStop(1, colors[1]);
  return gradient;
}

function roundRect(x, y, w, h, r, fillStyle) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
  ctx.fillStyle = fillStyle;
  ctx.fill();
}

function strokeRoundRect(x, y, w, h, r) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
  ctx.stroke();
}

function updateHud() {
  $("levelText").textContent = game.level;
  $("scoreText").textContent = game.score;
  $("removedText").textContent = game.blocksRemoved;
  const elapsed = 1 - Math.max(0, Math.min(1, game.timeLeft / game.secondsPerMove));
  const remainingColor = game.timeLeft <= game.secondsPerMove * 0.25 ? PALETTE[4] : PALETTE[3];
  $("timerBox").style.background = `conic-gradient(from -90deg, ${PALETTE[1]} 0deg ${elapsed * 360}deg, ${remainingColor} ${elapsed * 360}deg 360deg)`;
  $("timerText").textContent = Math.max(0, Math.ceil(game.timeLeft));
  $("timerBox").setAttribute("aria-label", `Drop blocks now. ${Math.max(0, Math.ceil(game.timeLeft))} seconds left`);
  $("pauseButton").textContent = game.paused ? ">" : "II";
  fitHudText();
}

function fitHudText() {
  for (const pill of document.querySelectorAll(".pill")) fitText(pill, 10, 16);
}

function fitText(element, minPx, maxPx) {
  if (!element || element.offsetParent === null) return;
  element.style.fontSize = `${maxPx}px`;
  let size = maxPx;
  while (size > minPx && (element.scrollWidth > element.clientWidth || element.scrollHeight > element.clientHeight + 1)) {
    size -= 1;
    element.style.fontSize = `${size}px`;
  }
}

function centerOfSelection() {
  if (!game.selected.length) return { x: CANVAS_WIDTH / 2, y: CANVAS_HEIGHT / 2 };
  const avg = game.selected.reduce((memo, block) => {
    memo.x += (block.x + 0.5) * CELL_SIZE;
    memo.y += (block.y + 0.5) * CELL_SIZE;
    return memo;
  }, { x: 0, y: 0 });
  return { x: avg.x / game.selected.length, y: avg.y / game.selected.length };
}

function addFloater(text, pos, color) {
  const particles = [];
  const particleCount = Math.min(18, Math.max(8, String(text).length + 7));
  for (let i = 0; i < particleCount; i += 1) {
    const angle = (Math.PI * 2 * i) / particleCount + randomRange(-0.16, 0.16);
    const speed = randomRange(34, 92);
    particles.push({
      x: pos.x,
      y: pos.y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed - 38,
      age: 0,
      life: randomRange(0.45, 0.85),
      radius: randomRange(1.8, 3.6),
      color: randomChoice([color, PALETTE[1], PALETTE[3], PALETTE[4], PALETTE[5]])
    });
  }
  game.floaters.push({
    text,
    originX: pos.x,
    originY: pos.y,
    x: pos.x,
    y: pos.y,
    vx: randomRange(-8, 8),
    vy: -64,
    age: 0,
    life: 1.45,
    color,
    fontSize: Math.max(18, Math.min(30, 31 - String(text).length * 0.8)),
    wobble: randomRange(0, Math.PI * 2),
    spin: randomRange(4, 8),
    particles
  });
}

function showHowTo() {
  showModal("How To Play", `
    <h3>Make Words</h3>
    <p>Drag through neighboring blocks to make a word. Release to submit it. Words must be at least three letters long.</p>
    <h3>Clear Levels</h3>
    <p>Clear blocks until every remaining block is inside the shaded win area at the bottom of the board.</p>
    <h3>Timer</h3>
    <p>When the timer runs out, five new blocks fall in. The timer starts at 60 seconds and drops by 5 seconds every 10 levels.</p>
    <h3>Scoring</h3>
    <p>Rare letters, longer words, later levels, and bonus blocks are worth more points.</p>
    <h3>Wild Cards</h3>
    <p>Every 20 valid blocks cleared turns a random block into a wild card.</p>
  `);
}

function showScores() {
  const players = Object.entries(state.players);
  const rows = players
    .sort((a, b) => (b[1].highScore || 0) - (a[1].highScore || 0))
    .slice(0, 20)
    .map(([name, player], index) => `<div class="score-row"><span>${index + 1}</span><strong>${escapeHtml(name)}</strong><span>${player.highScore || 0}p</span></div>`)
    .join("") || "<p>No scores yet.</p>";
  const bestWords = players
    .flatMap(([name, player]) => player.bestTotalWord ? [{ name, word: player.bestTotalWord, points: player.bestTotalPoints || 0 }] : [])
    .sort((a, b) => b.points - a.points)
    .slice(0, 10)
    .map((item, index) => `<div class="score-row"><span>${index + 1}</span><strong>${escapeHtml(item.word)} by ${escapeHtml(item.name)}</strong><span>${item.points}p</span></div>`)
    .join("");
  showModal("Local Scores", `${rows}${bestWords ? "<h3>Best Words</h3>" + bestWords : ""}`);
}

function showMessage(title, body) {
  showModal(title, body);
}

function showModal(title, body, actions = []) {
  modalTitle.textContent = title;
  modalBody.innerHTML = body;
  modalActions.innerHTML = "";
  for (const [label, handler] of actions) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = label;
    button.addEventListener("click", handler);
    modalActions.append(button);
  }
  if (!modal.open) modal.showModal();
  requestAnimationFrame(() => {
    fitText(modalTitle, 18, 24);
    for (const row of modalBody.querySelectorAll(".score-row strong, .score-row span")) fitText(row, 11, 16);
  });
}

function closeModal() {
  modal.close();
}

function loadState() {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (parsed && parsed.players && parsed.settings && parsed.globalWords) return parsed;
  } catch {
    /* use defaults */
  }
  return { players: {}, settings: {}, globalWords: {} };
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function ensurePlayer(username) {
  if (!state.players[username]) {
    state.players[username] = {
      highScore: 0,
      highestLevel: 1,
      longestWord: "",
      bestBaseWord: "",
      bestBasePoints: 0,
      bestTotalWord: "",
      bestTotalPoints: 0,
      wordsFound: []
    };
  }
}

function normalizeUsername(value) {
  return value.trim().replace(/[^a-z0-9]/gi, "").slice(0, 15).toUpperCase();
}

function wildcardMatch(selected, valid) {
  if (selected.length !== valid.length) return false;
  for (let i = 0; i < selected.length; i += 1) {
    if (selected[i] !== STAR && selected[i] !== valid[i]) return false;
  }
  return true;
}

function angleBetween(a, b) {
  const dot = a[0] * b[0] + a[1] * b[1];
  const mag = Math.hypot(a[0], a[1]) * Math.hypot(b[0], b[1]);
  if (!mag) return 0;
  return Math.acos(Math.max(-1, Math.min(1, dot / mag))) * 180 / Math.PI;
}

function randomChoice(items) {
  return items[Math.floor(Math.random() * items.length)];
}

function randomRange(min, max) {
  return min + Math.random() * (max - min);
}

function shuffle(items) {
  for (let i = items.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [items[i], items[j]] = [items[j], items[i]];
  }
  return items;
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;"
  })[char]);
}
