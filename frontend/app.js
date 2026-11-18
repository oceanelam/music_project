/**
 * ============================================================================
 * AURA MP-1 CLIENT APPLICATION (frontend/app.js)
 * ============================================================================
 * Architectural Key Points for Demo:
 * 1. Security & Proxy Rule: Zero calls to Last.fm (ws.audioscrobbler.com).
 *    All data flows exclusively through our Node.js backend proxy at /api/*.
 * 2. Caching Verification: Inspects X-Cache response header and _cache metadata
 *    to display live Cache HIT vs MISS badges in real time.
 * 3. Spatial UI Experience: Manages transitions between the Closed MP3 Player
 *    widget and the 3D Floating Glassmorphic cards arena.
 * 4. Interactive Simulation: Built-in Web Audio synth, scrubbable progress bars,
 *    and vinyl disk animation for a responsive live demo.
 */

// Application State
const state = {
  currentUser: 'rj',
  tracks: [],
  activeIndex: 0,
  isOpened: false,
  isPlaying: false,
  progressSeconds: 65,
  trackDuration: 215, // 3:35 simulated duration
  soundEnabled: true,
  audioCtx: null,
  synthOsc: null,
  synthGain: null,
  likedTrackIds: new Set(),
};

// DOM Element References
const dom = {
  // Navigation & Controls
  usernameInput: document.getElementById('username-input'),
  btnFetch: document.getElementById('btn-fetch'),
  cacheBadge: document.getElementById('cache-badge'),
  cacheText: document.getElementById('cache-text'),
  btnClearCache: document.getElementById('btn-clear-cache'),
  btnSoundToggle: document.getElementById('btn-sound-toggle'),
  soundIconOn: document.getElementById('sound-icon-on'),
  soundIconOff: document.getElementById('sound-icon-off'),
  fallbackBanner: document.getElementById('fallback-banner'),
  fallbackText: document.getElementById('fallback-text'),
  btnBannerDismiss: document.getElementById('btn-banner-dismiss'),
  loadingOverlay: document.getElementById('loading-overlay'),

  // Closed MP3 Player State
  closedContainer: document.getElementById('closed-player-container'),
  closedPlayer: document.getElementById('closed-mp3-player'),
  closedArtThumb: document.getElementById('closed-art-thumb'),
  lcdTrackTitle: document.getElementById('lcd-track-title'),
  lcdTrackArtist: document.getElementById('lcd-track-artist'),
  lcdUserDisplay: document.getElementById('lcd-user-display'),
  lcdStatusDisplay: document.getElementById('lcd-status-display'),
  deviceClock: document.getElementById('device-clock'),
  closedBtnPlay: document.getElementById('closed-btn-play'),
  closedIconPlay: document.getElementById('closed-icon-play'),
  closedIconPause: document.getElementById('closed-icon-pause'),

  // Opened Spatial State
  spatialArena: document.getElementById('spatial-arena'),
  floatingCardsContainer: document.getElementById('floating-cards-container'),
  dockInfoText: document.getElementById('dock-info-text'),
  dockPlayIcon: document.getElementById('dock-play-icon'),
  dockPauseIcon: document.getElementById('dock-pause-icon'),
  orbitPagination: document.getElementById('orbit-pagination'),
};

/**
 * ============================================================================
 * 1. BACKEND API PROXY INTEGRATION & CACHE TRACKING
 * ============================================================================
 */

/**
 * Fetch tracks strictly through the local proxy backend.
 * Zero requests ever hit ws.audioscrobbler.com from the browser.
 */
async function fetchTracks(username = 'rj', limit = 8) {
  showLoading(true);
  try {
    // Note the relative URL: we ONLY contact our backend proxy!
    const response = await fetch(`/api/recent-tracks?user=${encodeURIComponent(username)}&limit=${limit}`);

    // Read cache status from custom response headers provided by our Express proxy
    const cacheHeader = response.headers.get('X-Cache') || 'MISS';
    const cacheTTLHeader = response.headers.get('X-Cache-TTL');

    if (!response.ok) {
      throw new Error(`Proxy returned status ${response.status}`);
    }

    const data = await response.json();

    // Determine cache status from header or payload meta
    const isCacheHit = cacheHeader === 'HIT' || Boolean(data._cache && data._cache.hit);
    const ttlLeft = data._cache?.ttlRemainingSeconds || cacheTTLHeader || '60';

    updateCacheBadge(isCacheHit, ttlLeft);

    // Check if backend returned a graceful fallback warning
    if (data.isFallback && data.warning) {
      showFallbackBanner(data.warning);
    } else {
      hideFallbackBanner();
    }

    state.tracks = data.tracks || [];
    state.currentUser = data.user || username;
    state.activeIndex = 0;

    // Render both closed and opened player representations
    renderClosedPlayer();
    renderFloatingCards();

    console.log(`[CLIENT] Successfully loaded ${state.tracks.length} tracks via proxy. Cache: ${cacheHeader}`);
  } catch (err) {
    console.error('[CLIENT ERROR] Failed to fetch tracks:', err);
    showFallbackBanner(`Proxy error: ${err.message}. Please verify the backend is running.`);
  } finally {
    showLoading(false);
  }
}

/**
 * Update the Live Cache Indicator badge
 */
function updateCacheBadge(isHit, ttlRemaining) {
  if (isHit) {
    dom.cacheBadge.className = 'cache-pill cache-hit';
    dom.cacheText.textContent = `⚡ CACHE HIT (${ttlRemaining}s remaining)`;
    dom.lcdStatusDisplay.textContent = `CACHE: HIT (${ttlRemaining}s)`;
  } else {
    dom.cacheBadge.className = 'cache-pill cache-miss';
    dom.cacheText.textContent = `🌐 LIVE MISS (Cached 60s)`;
    dom.lcdStatusDisplay.textContent = `CACHE: MISS (SAVED)`;
  }
}

/**
 * Live Demo Feature: Clear backend cache to show immediate Cache Miss on next request
 */
async function clearCacheAndRefetch() {
  try {
    const res = await fetch('/api/clear-cache', { method: 'POST' });
    if (res.ok) {
      console.log('[CLIENT] In-memory cache wiped on backend.');
      await fetchTracks(state.currentUser);
    }
  } catch (e) {
    console.error('Failed to clear cache:', e);
  }
}

/**
 * ============================================================================
 * 2. CLOSED STATE: SLEEK MP3 PLAYER CONTROLLER
 * ============================================================================
 */

function renderClosedPlayer() {
  if (state.tracks.length === 0) return;
  const current = state.tracks[state.activeIndex] || state.tracks[0];

  dom.lcdTrackTitle.textContent = current.title;
  dom.lcdTrackArtist.textContent = current.artist;
  dom.lcdUserDisplay.textContent = `USER: ${state.currentUser.toUpperCase()}`;
  dom.closedArtThumb.src = current.image;
  dom.closedArtThumb.alt = `${current.title} by ${current.artist}`;

  updatePlayIcons();
}

/**
 * Open / Expand 3D Floating Spatial Arena
 */
function openSpatialArena() {
  state.isOpened = true;
  dom.closedContainer.classList.add('hidden');
  dom.spatialArena.classList.remove('hidden');
  renderFloatingCards();
}

/**
 * Close / Dock 3D Floating Cards back into the MP3 Player
 */
function closeSpatialArena() {
  state.isOpened = false;
  dom.spatialArena.classList.add('hidden');
  dom.closedContainer.classList.remove('hidden');
  renderClosedPlayer();
}

/**
 * ============================================================================
 * 3. OPENED STATE: 3D SPATIAL FLOATING GLASSMORPHIC TRACK CARDS
 * ============================================================================
 */

/**
 * Dynamically render track cards in spatial depth
 */
function renderFloatingCards() {
  dom.floatingCardsContainer.innerHTML = '';
  dom.orbitPagination.innerHTML = '';

  const total = state.tracks.length;
  if (total === 0) return;

  dom.dockInfoText.textContent = `${total} Tracks • User: ${state.currentUser}`;

  state.tracks.forEach((track, index) => {
    // 1. Compute Spatial 3D coordinates relative to active card
    const cardEl = createTrackCardElement(track, index);
    dom.floatingCardsContainer.appendChild(cardEl);

    // 2. Pagination Dot
    const dot = document.createElement('button');
    dot.className = `orbit-dot ${index === state.activeIndex ? 'is-active' : ''}`;
    dot.setAttribute('aria-label', `Track ${index + 1}: ${track.title}`);
    dot.onclick = () => selectTrack(index);
    dom.orbitPagination.appendChild(dot);
  });

  updateSpatialLayout();
}

/**
 * Create a single Frosted Glass Track Card element
 */
function createTrackCardElement(track, index) {
  const card = document.createElement('article');
  card.className = `spatial-card ${index % 2 === 0 ? 'floating-bob-1' : 'floating-bob-2'}`;
  card.dataset.index = index;

  const isLiked = state.likedTrackIds.has(track.id);
  const statusBadge = track.nowPlaying
    ? `<span class="status-badge status-nowplaying"><span class="pulse-dot"></span>Now Playing</span>`
    : `<span class="status-badge status-recent">${track.scrobbledAt}</span>`;

  card.innerHTML = `
    <!-- Artwork Stage with Vinyl Disc -->
    <div class="card-art-stage">
      <!-- Vinyl Disc sliding out on active -->
      <div class="vinyl-disc">
        <div class="vinyl-center-label">
          <div class="vinyl-spindle"></div>
        </div>
      </div>
      <!-- Album Cover Jacket -->
      <div class="album-cover-jacket">
        <img src="${track.image}" alt="${escapeHtml(track.title)}" loading="lazy" />
      </div>
    </div>

    <!-- Status & Last.fm Link Row -->
    <div class="card-badge-row">
      ${statusBadge}
      <a href="${track.url}" target="_blank" rel="noopener noreferrer" class="lastfm-link" title="View track on Last.fm" onclick="event.stopPropagation();">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path>
          <polyline points="15 3 21 3 21 9"></polyline>
          <line x1="10" y1="14" x2="21" y2="3"></line>
        </svg>
      </a>
    </div>

    <!-- Track Metadata -->
    <div class="card-track-meta">
      <h3 class="card-track-title" title="${escapeHtml(track.title)}">${escapeHtml(track.title)}</h3>
      <p class="card-track-artist" title="${escapeHtml(track.artist)}">${escapeHtml(track.artist)}</p>
      <p class="card-track-album">${track.album ? escapeHtml(track.album) : 'Single'}</p>
    </div>

    <!-- Scrubbable Progress Bar -->
    <div class="card-progress-wrapper" onclick="event.stopPropagation(); window.scrubProgress(event, ${index});">
      <div class="card-progress-bar">
        <div class="card-progress-fill" id="progress-fill-${index}"></div>
      </div>
      <div class="card-time-row">
        <span id="time-current-${index}">01:05</span>
        <span id="time-total-${index}">03:35</span>
      </div>
    </div>

    <!-- Tactile Card Controls -->
    <div class="card-controls">
      <button class="ctrl-btn ctrl-btn-heart ${isLiked ? 'is-liked' : ''}" onclick="event.stopPropagation(); window.toggleLike('${track.id}');" title="Favorite Track">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="${isLiked ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2">
          <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"></path>
        </svg>
      </button>

      <div style="display: flex; gap: 8px; align-items: center;">
        <button class="ctrl-btn" onclick="event.stopPropagation(); window.playerPrev();" title="Previous Track">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><polygon points="19 20 9 12 19 4 19 20"></polygon><line x1="5" y1="19" x2="5" y2="5" stroke="currentColor" stroke-width="2"></line></svg>
        </button>
        <button class="ctrl-btn ctrl-btn-play" onclick="event.stopPropagation(); window.toggleCardPlay(${index});" title="Play / Pause">
          <svg class="play-icon" width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>
          <svg class="pause-icon hidden" width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16"></rect><rect x="14" y="4" width="4" height="16"></rect></svg>
        </button>
        <button class="ctrl-btn" onclick="event.stopPropagation(); window.playerNext();" title="Next Track">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 4 15 12 5 20 5 4"></polygon><line x1="19" y1="5" x2="19" y2="19" stroke="currentColor" stroke-width="2"></line></svg>
        </button>
      </div>
    </div>
  `;

  // Clicking on an inactive card brings it smoothly into focus
  card.onclick = () => selectTrack(index);

  return card;
}

/**
 * Computes 3D spatial orbit positions for cards based on active index
 */
function updateSpatialLayout() {
  const cards = document.querySelectorAll('.spatial-card');
  const isMobile = window.innerWidth <= 768;
  const activeIdx = state.activeIndex;
  const total = state.tracks.length;

  cards.forEach((card, index) => {
    // Relative offset from current focused track
    let offset = index - activeIdx;

    const isActive = index === activeIdx;

    if (isActive) {
      card.classList.add('is-active');
      if (state.isPlaying) card.classList.add('is-playing');
      else card.classList.remove('is-playing');

      card.style.setProperty('--tx', '0px');
      card.style.setProperty('--ty', '0px');
      card.style.setProperty('--tz', '60px');
      card.style.setProperty('--ry', '0deg');
      card.style.setProperty('--sc', isMobile ? '1' : '1.04');
      card.style.zIndex = '30';
    } else {
      card.classList.remove('is-active', 'is-playing');

      if (isMobile) {
        // Mobile layout: stacked horizontal offset
        const tx = offset * 290;
        card.style.setProperty('--tx', `${tx}px`);
        card.style.setProperty('--ty', '0px');
        card.style.setProperty('--tz', `${-Math.abs(offset) * 40}px`);
        card.style.setProperty('--ry', '0deg');
        card.style.setProperty('--sc', `${Math.max(0.8, 1 - Math.abs(offset) * 0.15)}`);
      } else {
        // Laptop / Desktop: 3D spatial field with perspective & rotation
        let tx = 0, ty = 0, tz = 0, ry = 0, scale = 0.88;

        if (offset === -1) {
          tx = -310; ty = -10; tz = -60; ry = 14; scale = 0.88;
        } else if (offset === 1) {
          tx = 310; ty = -10; tz = -60; ry = -14; scale = 0.88;
        } else if (offset === -2) {
          tx = -520; ty = 25; tz = -140; ry = 22; scale = 0.76;
        } else if (offset === 2) {
          tx = 520; ty = 25; tz = -140; ry = -22; scale = 0.76;
        } else {
          // Cards further away
          const sign = offset < 0 ? -1 : 1;
          tx = sign * (600 + Math.abs(offset) * 80);
          ty = 40;
          tz = -220;
          ry = sign * 28;
          scale = 0.65;
        }

        card.style.setProperty('--tx', `${tx}px`);
        card.style.setProperty('--ty', `${ty}px`);
        card.style.setProperty('--tz', `${tz}px`);
        card.style.setProperty('--ry', `${ry}deg`);
        card.style.setProperty('--sc', `${scale}`);
      }

      card.style.zIndex = `${Math.max(1, 20 - Math.abs(offset))}`;
    }
  });

  // Update pagination dots
  const dots = document.querySelectorAll('.orbit-dot');
  dots.forEach((dot, idx) => {
    dot.className = `orbit-dot ${idx === activeIdx ? 'is-active' : ''}`;
  });

  updatePlayIcons();
}

/**
 * Select a specific track to bring to foreground
 */
function selectTrack(index) {
  if (index < 0 || index >= state.tracks.length) return;
  state.activeIndex = index;
  state.progressSeconds = Math.floor(Math.random() * 40) + 20;

  renderClosedPlayer();
  updateSpatialLayout();
}

/**
 * ============================================================================
 * 4. TACTILE AUDIO PLAYBACK & SYNTHESIS SIMULATION
 * ============================================================================
 */

function togglePlay() {
  state.isPlaying = !state.isPlaying;
  updatePlayIcons();

  if (state.isPlaying) {
    document.body.classList.add('is-playing');
    startAudioSynth();
  } else {
    document.body.classList.remove('is-playing');
    stopAudioSynth();
  }

  updateSpatialLayout();
}

function toggleCardPlay(index) {
  if (state.activeIndex !== index) {
    selectTrack(index);
    state.isPlaying = true;
    document.body.classList.add('is-playing');
    startAudioSynth();
  } else {
    togglePlay();
  }
}

function playerNext() {
  const nextIdx = (state.activeIndex + 1) % state.tracks.length;
  selectTrack(nextIdx);
}

function playerPrev() {
  const prevIdx = (state.activeIndex - 1 + state.tracks.length) % state.tracks.length;
  selectTrack(prevIdx);
}

function toggleLike(trackId) {
  if (state.likedTrackIds.has(trackId)) {
    state.likedTrackIds.delete(trackId);
  } else {
    state.likedTrackIds.add(trackId);
  }
  renderFloatingCards();
}

/**
 * Scrub progress bar by clicking on it
 */
function scrubProgress(e, index) {
  const rect = e.currentTarget.getBoundingClientRect();
  const clickX = e.clientX - rect.left;
  const ratio = Math.max(0, Math.min(1, clickX / rect.width));
  state.progressSeconds = Math.floor(ratio * state.trackDuration);
  updateProgressBarDisplay();
}

/**
 * Update UI icons for play/pause
 */
function updatePlayIcons() {
  const isPlaying = state.isPlaying;

  // Closed player buttons
  dom.closedIconPlay.classList.toggle('hidden', isPlaying);
  dom.closedIconPause.classList.toggle('hidden', !isPlaying);

  // Opened dock buttons
  dom.dockPlayIcon.classList.toggle('hidden', isPlaying);
  dom.dockPauseIcon.classList.toggle('hidden', !isPlaying);

  // Active card buttons
  document.querySelectorAll('.spatial-card').forEach((card, idx) => {
    const playIcon = card.querySelector('.play-icon');
    const pauseIcon = card.querySelector('.pause-icon');
    if (playIcon && pauseIcon) {
      if (idx === state.activeIndex && isPlaying) {
        playIcon.classList.add('hidden');
        pauseIcon.classList.remove('hidden');
      } else {
        playIcon.classList.remove('hidden');
        pauseIcon.classList.add('hidden');
      }
    }
  });
}

/**
 * Web Audio API Synth pad - simulates gentle ambient sound during the demo
 */
function startAudioSynth() {
  if (!state.soundEnabled) return;
  try {
    if (!state.audioCtx) {
      state.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }
    if (state.audioCtx.state === 'suspended') {
      state.audioCtx.resume();
    }

    stopAudioSynth();

    const osc = state.audioCtx.createOscillator();
    const gain = state.audioCtx.createGain();

    // Gentle mellow warm frequency
    osc.type = 'sine';
    const notes = [220, 261.63, 329.63, 392]; // A minor 7th chord
    const baseFreq = notes[state.activeIndex % notes.length];
    osc.frequency.setValueAtTime(baseFreq, state.audioCtx.currentTime);

    gain.gain.setValueAtTime(0.001, state.audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.04, state.audioCtx.currentTime + 0.4);

    osc.connect(gain);
    gain.connect(state.audioCtx.destination);
    osc.start();

    state.synthOsc = osc;
    state.synthGain = gain;
  } catch (e) {
    console.warn('Web Audio not allowed or unavailable:', e);
  }
}

function stopAudioSynth() {
  if (state.synthGain && state.audioCtx) {
    try {
      state.synthGain.gain.exponentialRampToValueAtTime(0.0001, state.audioCtx.currentTime + 0.3);
      setTimeout(() => {
        if (state.synthOsc) {
          state.synthOsc.stop();
          state.synthOsc.disconnect();
          state.synthOsc = null;
        }
      }, 350);
    } catch (e) {}
  }
}

/**
 * Interval timer for simulated playback progress & clock
 */
setInterval(() => {
  // Update device clock
  const now = new Date();
  const hours = now.getHours().toString().padStart(2, '0');
  const minutes = now.getMinutes().toString().padStart(2, '0');
  dom.deviceClock.textContent = `${hours}:${minutes}`;

  // Advance playback if active
  if (state.isPlaying) {
    state.progressSeconds = (state.progressSeconds + 1) % state.trackDuration;
    updateProgressBarDisplay();
  }
}, 1000);

function updateProgressBarDisplay() {
  const pct = (state.progressSeconds / state.trackDuration) * 100;
  const curMin = Math.floor(state.progressSeconds / 60);
  const curSec = (state.progressSeconds % 60).toString().padStart(2, '0');
  const totMin = Math.floor(state.trackDuration / 60);
  const totSec = (state.trackDuration % 60).toString().padStart(2, '0');

  const curStr = `${curMin}:${curSec}`;
  const totStr = `${totMin}:${totSec}`;

  const fillEl = document.getElementById(`progress-fill-${state.activeIndex}`);
  const timeCur = document.getElementById(`time-current-${state.activeIndex}`);
  const timeTot = document.getElementById(`time-total-${state.activeIndex}`);

  if (fillEl) fillEl.style.width = `${pct}%`;
  if (timeCur) timeCur.textContent = curStr;
  if (timeTot) timeTot.textContent = totStr;
}

/**
 * ============================================================================
 * 5. EVENT LISTENERS & INITIALIZATION
 * ============================================================================
 */

function setupEventListeners() {
  // Click on closed MP3 player anywhere -> open floating 3D cards
  dom.closedPlayer.addEventListener('click', () => {
    openSpatialArena();
  });

  // Center select button on clickwheel
  document.getElementById('clickwheel-center-trigger')?.addEventListener('click', (e) => {
    e.stopPropagation();
    openSpatialArena();
  });

  // Invalidate Cache Demo Button
  dom.btnClearCache.addEventListener('click', () => {
    clearCacheAndRefetch();
  });

  // Sound fx mute/unmute
  dom.btnSoundToggle.addEventListener('click', () => {
    state.soundEnabled = !state.soundEnabled;
    dom.soundIconOn.classList.toggle('hidden', !state.soundEnabled);
    dom.soundIconOff.classList.toggle('hidden', state.soundEnabled);
    if (!state.soundEnabled) stopAudioSynth();
    else if (state.isPlaying) startAudioSynth();
  });

  // Banner dismiss
  dom.btnBannerDismiss.addEventListener('click', () => {
    hideFallbackBanner();
  });

  // Keyboard Navigation: Spacebar (Play), Left Arrow (Prev), Right Arrow (Next), Esc (Close)
  window.addEventListener('keydown', (e) => {
    if (['input', 'textarea'].includes(document.activeElement?.tagName.toLowerCase())) {
      return;
    }
    if (e.code === 'Space') {
      e.preventDefault();
      togglePlay();
    } else if (e.code === 'ArrowRight') {
      e.preventDefault();
      playerNext();
    } else if (e.code === 'ArrowLeft') {
      e.preventDefault();
      playerPrev();
    } else if (e.code === 'Escape' && state.isOpened) {
      e.preventDefault();
      closeSpatialArena();
    }
  });

  // Resize listener to adapt 3D layout smoothly
  window.addEventListener('resize', () => {
    if (state.isOpened) updateSpatialLayout();
  });
}

function handleUserSubmit() {
  const val = dom.usernameInput.value.trim();
  if (val) {
    state.currentUser = val;
    fetchTracks(val);
  }
}

function showLoading(show) {
  dom.loadingOverlay.classList.toggle('hidden', !show);
}

function showFallbackBanner(msg) {
  dom.fallbackText.textContent = msg;
  dom.fallbackBanner.classList.remove('hidden');
}

function hideFallbackBanner() {
  dom.fallbackBanner.classList.add('hidden');
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// Global window exposure for inline event handlers
window.togglePlay = togglePlay;
window.toggleCardPlay = toggleCardPlay;
window.playerNext = playerNext;
window.playerPrev = playerPrev;
window.toggleLike = toggleLike;
window.scrubProgress = scrubProgress;
window.openSpatialArena = openSpatialArena;
window.closeSpatialArena = closeSpatialArena;
window.handleUserSubmit = handleUserSubmit;

// Boot application on load
window.addEventListener('DOMContentLoaded', () => {
  setupEventListeners();
  // Fetch initial tracks via our proxy
  fetchTracks(state.currentUser);
});
