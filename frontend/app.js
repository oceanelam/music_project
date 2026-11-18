/**
 * ============================================================================
 * EDITORIAL SPATIAL GLASS MUSIC PLAYER (frontend/app.js)
 * ============================================================================
 * Rules:
 * 1. Strict Reverse Proxy: Calls /api/recent-tracks exclusively.
 * 2. Caching: Handled by server (60s TTL).
 * 3. Never blank: Always renders either the MP3 player artifact,
 *    floating cards, or a clean frosted error state card.
 */

const state = {
  tracks: [],
  currentUser: '',
  activeIndex: 0,
  isOpened: false,
  isPlaying: false,
  progressSeconds: 30,
  trackDuration: 210,
  likedTrackIds: new Set(),
  audioCtx: null,
  synthOsc: null,
  synthGain: null,
};

const dom = {
  closedContainer: document.getElementById('closed-container'),
  closedCoverImg: document.getElementById('closed-cover-img'),
  closedTrackTitle: document.getElementById('closed-track-title'),
  closedTrackArtist: document.getElementById('closed-track-artist'),
  triggerPlayIcon: document.getElementById('trigger-play-icon'),
  triggerPauseIcon: document.getElementById('trigger-pause-icon'),

  openedContainer: document.getElementById('opened-container'),
  spatialCardsField: document.getElementById('spatial-cards-field'),
  btnDockClose: document.getElementById('btn-dock-close'),
  watermarkUser: document.getElementById('watermark-user'),

  errorContainer: document.getElementById('error-container'),
  errorTitle: document.getElementById('error-title'),
  errorDesc: document.getElementById('error-desc'),
};

const SPATIAL_POSITIONS = [
  'pos-fg-left',
  'pos-fg-right',
  'pos-bg-top',
  'pos-bg-bottom',
  'pos-bg-far-left',
  'pos-bg-far-right',
];

const DEFAULT_COVER = 'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=600&auto=format&fit=crop&q=80';

/**
 * ============================================================================
 * 1. PROXY DATA FETCHING (Zero direct calls to Last.fm)
 * ============================================================================
 */
async function loadRecentTracks() {
  try {
    const response = await fetch('/api/recent-tracks?limit=15');
    const data = await response.json();

    // Check if proxy returned an error
    if (!response.ok || data.error) {
      showErrorMessage(
        'Unable to load tracks from Last.fm',
        data.message || `Proxy returned HTTP ${response.status}. Please check your credentials.`
      );
      return;
    }

    state.currentUser = data.user || 'oceanelam17';
    if (dom.watermarkUser) {
      dom.watermarkUser.textContent = `LISTENING HISTORY • ${state.currentUser.toUpperCase()}`;
    }

    // Hide error container
    if (dom.errorContainer) dom.errorContainer.classList.add('hidden');

    // Case A: User has 0 scrobbled tracks so far
    if (!Array.isArray(data.tracks) || data.tracks.length === 0) {
      state.tracks = [];
      showEmptyAccountState(state.currentUser);
      return;
    }

    // Case B: User has tracks!
    state.tracks = data.tracks;
    if (state.isOpened) {
      showOpenedView();
    } else {
      showClosedView();
    }
  } catch (err) {
    console.error('Failed to load tracks through proxy:', err);
    showErrorMessage(
      'Connection Error',
      'The backend proxy server is unreachable. Please ensure the backend is running with npm start or docker compose up.'
    );
  }
}

/**
 * Empty Account State: User connected, but 0 tracks scrobbled yet
 */
function showEmptyAccountState(username) {
  if (dom.closedContainer) dom.closedContainer.classList.remove('hidden');
  if (dom.openedContainer) dom.openedContainer.classList.add('hidden');
  if (dom.btnDockClose) dom.btnDockClose.classList.add('hidden');
  if (dom.errorContainer) dom.errorContainer.classList.add('hidden');

  if (dom.closedCoverImg) dom.closedCoverImg.src = DEFAULT_COVER;
  if (dom.closedTrackTitle) dom.closedTrackTitle.textContent = 'No Scrobbles Yet';
  if (dom.closedTrackArtist) dom.closedTrackArtist.textContent = `User '${username}' • Play songs on Spotify`;
}

/**
 * Error state display
 */
function showErrorMessage(title, description) {
  state.tracks = [];
  if (dom.closedContainer) dom.closedContainer.classList.add('hidden');
  if (dom.openedContainer) dom.openedContainer.classList.add('hidden');
  if (dom.btnDockClose) dom.btnDockClose.classList.add('hidden');

  if (dom.errorTitle) dom.errorTitle.textContent = title;
  if (dom.errorDesc) dom.errorDesc.textContent = description;
  if (dom.errorContainer) dom.errorContainer.classList.remove('hidden');
}

/**
 * ============================================================================
 * 2. CLOSED STATE: MINIMALIST MP3 OBJECT
 * ============================================================================
 */
function showClosedView() {
  if (dom.closedContainer) dom.closedContainer.classList.remove('hidden');
  if (dom.openedContainer) dom.openedContainer.classList.add('hidden');
  if (dom.btnDockClose) dom.btnDockClose.classList.add('hidden');
  if (dom.errorContainer) dom.errorContainer.classList.add('hidden');
  renderClosedArtifact();
}

function renderClosedArtifact() {
  if (state.tracks.length === 0) return;
  const current = state.tracks[state.activeIndex] || state.tracks[0];

  if (dom.closedCoverImg) dom.closedCoverImg.src = current.image || DEFAULT_COVER;
  if (dom.closedTrackTitle) dom.closedTrackTitle.textContent = current.title;
  if (dom.closedTrackArtist) dom.closedTrackArtist.textContent = current.artist;
  updatePlayStateUI();
}

function openSpatialArena() {
  state.isOpened = true;
  showOpenedView();
}

function closeSpatialArena() {
  state.isOpened = false;
  showClosedView();
}

/**
 * ============================================================================
 * 3. OPENED STATE: ORGANIC FLOATING GLASS CARDS
 * ============================================================================
 */
function showOpenedView() {
  if (dom.closedContainer) dom.closedContainer.classList.add('hidden');
  if (dom.openedContainer) dom.openedContainer.classList.remove('hidden');
  if (dom.btnDockClose) dom.btnDockClose.classList.remove('hidden');
  if (dom.errorContainer) dom.errorContainer.classList.add('hidden');
  renderSpatialCards();
}

function renderSpatialCards() {
  if (!dom.spatialCardsField) return;
  dom.spatialCardsField.innerHTML = '';

  // If user has 0 scrobbles, display a clean guidance card in the opened spatial field
  if (state.tracks.length === 0) {
    const emptyCard = document.createElement('div');
    emptyCard.className = 'glass-message-card';
    emptyCard.style.position = 'relative';
    emptyCard.innerHTML = `
      <div class="message-icon-wrap">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
          <circle cx="12" cy="12" r="10"></circle>
          <polygon points="10 8 16 12 10 16 10 8"></polygon>
        </svg>
      </div>
      <h2 class="message-title">Account Connected: ${state.currentUser}</h2>
      <p class="message-desc">Your Last.fm account is verified and ready. Once you stream music on Spotify or Last.fm, your recent rotation will appear here automatically.</p>
      <button class="message-btn" onclick="window.loadRecentTracks()">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <polyline points="23 4 23 10 17 10"></polyline>
          <polyline points="1 20 1 14 7 14"></polyline>
          <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path>
        </svg>
        <span>Refresh Scrobbles</span>
      </button>
    `;
    dom.spatialCardsField.appendChild(emptyCard);
    return;
  }

  // Render up to 6 tracks in spatial orbit
  state.tracks.slice(0, 6).forEach((track, index) => {
    const card = document.createElement('article');
    const isLiked = state.likedTrackIds.has(track.id);
    const isActive = index === state.activeIndex;

    const positionIndex = (index - state.activeIndex + state.tracks.length) % state.tracks.length;
    const posClass = SPATIAL_POSITIONS[positionIndex] || 'pos-bg-far-right';

    card.className = `glass-track-card drifting ${posClass} ${isActive ? 'is-active' : ''}`;
    card.dataset.index = index;

    const coverArt = track.image || DEFAULT_COVER;

    card.innerHTML = `
      <div class="card-artwork-wrap">
        <img class="card-artwork-img" src="${coverArt}" alt="${escapeHtml(track.title)}" loading="lazy" />
      </div>

      <div class="card-details">
        <h3 class="card-title" title="${escapeHtml(track.title)}">${escapeHtml(track.title)}</h3>
        <p class="card-artist" title="${escapeHtml(track.artist)}">${escapeHtml(track.artist)}</p>
      </div>

      <div class="card-timeline" onclick="event.stopPropagation(); window.handleTimelineScrub(event, ${index});">
        <div class="card-timeline-fill" id="timeline-fill-${index}"></div>
      </div>

      <div class="card-minimal-ctrls">
        <button class="minimal-icon-btn" onclick="event.stopPropagation(); window.shuffleTracks();" title="Shuffle" aria-label="Shuffle">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
            <polyline points="16 3 21 3 21 8"></polyline>
            <line x1="4" y1="20" x2="21" y2="3"></line>
            <polyline points="21 16 21 21 16 21"></polyline>
            <line x1="15" y1="15" x2="21" y2="21"></line>
            <line x1="4" y1="4" x2="9" y2="9"></line>
          </svg>
        </button>

        <button class="minimal-icon-btn" onclick="event.stopPropagation(); window.prevTrack();" title="Previous" aria-label="Previous">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
            <polygon points="19 20 9 12 19 4 19 20"></polygon>
            <line x1="5" y1="19" x2="5" y2="5" stroke="currentColor" stroke-width="2"></line>
          </svg>
        </button>

        <button class="round-white-play-btn" onclick="event.stopPropagation(); window.toggleCardPlay(${index});" title="Play or Pause" aria-label="Play">
          <svg class="icon-play ${isActive && state.isPlaying ? 'hidden' : ''}" width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
            <polygon points="6 4 20 12 6 20 6 4"></polygon>
          </svg>
          <svg class="icon-pause ${isActive && state.isPlaying ? '' : 'hidden'}" width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
            <rect x="6" y="4" width="4" height="16"></rect>
            <rect x="14" y="4" width="4" height="16"></rect>
          </svg>
        </button>

        <button class="minimal-icon-btn" onclick="event.stopPropagation(); window.nextTrack();" title="Next" aria-label="Next">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
            <polygon points="5 4 15 12 5 20 5 4"></polygon>
            <line x1="19" y1="5" x2="19" y2="19" stroke="currentColor" stroke-width="2"></line>
          </svg>
        </button>

        <button class="minimal-icon-btn ${isLiked ? 'is-active-btn' : ''}" onclick="event.stopPropagation(); window.toggleLike('${track.id}');" title="Favorite" aria-label="Favorite">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="${isLiked ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="1.8">
            <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"></path>
          </svg>
        </button>
      </div>
    `;

    card.onclick = () => selectTrack(index);
    dom.spatialCardsField.appendChild(card);
  });

  updateTimelineDisplays();
  updatePlayStateUI();
}

function selectTrack(index) {
  if (index < 0 || index >= state.tracks.length) return;
  state.activeIndex = index;
  state.progressSeconds = Math.floor(Math.random() * 30) + 15;
  renderClosedArtifact();
  renderSpatialCards();
}

/**
 * ============================================================================
 * 4. TACTILE AUDIO PLAYBACK & SYNTHESIS
 * ============================================================================
 */
function togglePlay() {
  state.isPlaying = !state.isPlaying;
  updatePlayStateUI();

  if (state.isPlaying) {
    startGentleSynth();
  } else {
    stopGentleSynth();
  }
}

function toggleCardPlay(index) {
  if (state.activeIndex !== index) {
    selectTrack(index);
    state.isPlaying = true;
    startGentleSynth();
  } else {
    togglePlay();
  }
  updatePlayStateUI();
}

function nextTrack() {
  if (state.tracks.length === 0) return;
  const next = (state.activeIndex + 1) % state.tracks.length;
  selectTrack(next);
}

function prevTrack() {
  if (state.tracks.length === 0) return;
  const prev = (state.activeIndex - 1 + state.tracks.length) % state.tracks.length;
  selectTrack(prev);
}

function shuffleTracks() {
  if (state.tracks.length === 0) return;
  const rand = Math.floor(Math.random() * state.tracks.length);
  selectTrack(rand);
}

function toggleLike(trackId) {
  if (state.likedTrackIds.has(trackId)) {
    state.likedTrackIds.delete(trackId);
  } else {
    state.likedTrackIds.add(trackId);
  }
  renderSpatialCards();
}

function handleTimelineScrub(e, index) {
  const rect = e.currentTarget.getBoundingClientRect();
  const clickX = e.clientX - rect.left;
  const ratio = Math.max(0, Math.min(1, clickX / rect.width));
  state.progressSeconds = Math.floor(ratio * state.trackDuration);
  updateTimelineDisplays();
}

function updatePlayStateUI() {
  if (dom.triggerPlayIcon) dom.triggerPlayIcon.classList.toggle('hidden', state.isPlaying);
  if (dom.triggerPauseIcon) dom.triggerPauseIcon.classList.toggle('hidden', !state.isPlaying);

  document.querySelectorAll('.glass-track-card').forEach((card, idx) => {
    const playIcon = card.querySelector('.icon-play');
    const pauseIcon = card.querySelector('.icon-pause');
    if (playIcon && pauseIcon) {
      if (idx === state.activeIndex && state.isPlaying) {
        playIcon.classList.add('hidden');
        pauseIcon.classList.remove('hidden');
      } else {
        playIcon.classList.remove('hidden');
        pauseIcon.classList.add('hidden');
      }
    }
  });
}

function updateTimelineDisplays() {
  const pct = (state.progressSeconds / state.trackDuration) * 100;
  const fillEl = document.getElementById(`timeline-fill-${state.activeIndex}`);
  if (fillEl) fillEl.style.width = `${pct}%`;
}

function startGentleSynth() {
  try {
    if (!state.audioCtx) {
      state.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }
    if (state.audioCtx.state === 'suspended') {
      state.audioCtx.resume();
    }

    stopGentleSynth();

    const osc = state.audioCtx.createOscillator();
    const gain = state.audioCtx.createGain();

    osc.type = 'sine';
    const chord = [220, 261.63, 329.63, 392];
    osc.frequency.setValueAtTime(chord[state.activeIndex % chord.length], state.audioCtx.currentTime);

    gain.gain.setValueAtTime(0.001, state.audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.035, state.audioCtx.currentTime + 0.5);

    osc.connect(gain);
    gain.connect(state.audioCtx.destination);
    osc.start();

    state.synthOsc = osc;
    state.synthGain = gain;
  } catch (e) {}
}

function stopGentleSynth() {
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

setInterval(() => {
  if (state.isPlaying) {
    state.progressSeconds = (state.progressSeconds + 1) % state.trackDuration;
    updateTimelineDisplays();
  }
}, 1000);

window.addEventListener('keydown', (e) => {
  if (e.code === 'Space') {
    e.preventDefault();
    togglePlay();
  } else if (e.code === 'ArrowRight') {
    e.preventDefault();
    nextTrack();
  } else if (e.code === 'ArrowLeft') {
    e.preventDefault();
    prevTrack();
  } else if (e.code === 'Escape' && state.isOpened) {
    e.preventDefault();
    closeSpatialArena();
  }
});

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

window.loadRecentTracks = loadRecentTracks;
window.openSpatialArena = openSpatialArena;
window.closeSpatialArena = closeSpatialArena;
window.toggleCardPlay = toggleCardPlay;
window.nextTrack = nextTrack;
window.prevTrack = prevTrack;
window.shuffleTracks = shuffleTracks;
window.toggleLike = toggleLike;
window.handleTimelineScrub = handleTimelineScrub;

window.addEventListener('DOMContentLoaded', () => {
  loadRecentTracks();
});
