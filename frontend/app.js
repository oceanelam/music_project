/**
 * ============================================================================
 * EDITORIAL SPATIAL GLASS MUSIC PLAYER (frontend/app.js)
 * ============================================================================
 * Architecture Rules:
 * 1. Strict Reverse Proxy: Browser calls ONLY /api/recent-tracks.
 *    Zero requests to ws.audioscrobbler.com from the browser.
 * 2. Caching: 60s in-memory cache handled transparently by the backend proxy.
 * 3. Graceful Resilience: When Last.fm fails, displays a clean error message
 *    WITHOUT loading fake mock tracks, never leaving a blank screen.
 */

const state = {
  tracks: [],
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

/**
 * ============================================================================
 * 1. PROXY DATA FETCHING (Zero direct calls to Last.fm)
 * ============================================================================
 */
async function loadRecentTracks() {
  try {
    // Relative URL ensures call goes strictly through local backend proxy
    const response = await fetch('/api/recent-tracks?limit=15');
    const data = await response.json();

    if (!response.ok || data.error) {
      showErrorMessage(
        'Unable to load tracks from Last.fm',
        data.message || `Proxy returned HTTP ${response.status}. Please check your credentials.`
      );
      return;
    }

    if (!Array.isArray(data.tracks) || data.tracks.length === 0) {
      showErrorMessage(
        'No Recent Scrobbles Found',
        `User '${data.user || 'your account'}' has no recent tracks recorded on Last.fm yet. Start listening on Spotify or Last.fm to see your rotation here!`
      );
      return;
    }

    // Success: hide error state
    dom.errorContainer.classList.add('hidden');

    state.tracks = data.tracks;
    if (data.user) {
      dom.watermarkUser.textContent = `LISTENING HISTORY • ${data.user.toUpperCase()}`;
    }

    if (state.isOpened) {
      dom.openedContainer.classList.remove('hidden');
      dom.closedContainer.classList.add('hidden');
      renderSpatialCards();
    } else {
      dom.closedContainer.classList.remove('hidden');
      dom.openedContainer.classList.add('hidden');
      renderClosedArtifact();
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
 * Displays a clean error message in the center without loading fake mock songs
 */
function showErrorMessage(title, description) {
  state.tracks = [];
  dom.closedContainer.classList.add('hidden');
  dom.openedContainer.classList.add('hidden');
  dom.btnDockClose.classList.add('hidden');

  dom.errorTitle.textContent = title;
  dom.errorDesc.textContent = description;
  dom.errorContainer.classList.remove('hidden');
}

/**
 * ============================================================================
 * 2. CLOSED STATE: MINIMALIST MP3 OBJECT
 * ============================================================================
 */
function renderClosedArtifact() {
  if (state.tracks.length === 0) return;
  const current = state.tracks[state.activeIndex] || state.tracks[0];

  dom.closedCoverImg.src = current.image || 'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=500&auto=format&fit=crop&q=80';
  dom.closedTrackTitle.textContent = current.title;
  dom.closedTrackArtist.textContent = current.artist;
  updatePlayStateUI();
}

function openSpatialArena() {
  if (state.tracks.length === 0) return;
  state.isOpened = true;
  dom.closedContainer.classList.add('hidden');
  dom.openedContainer.classList.remove('hidden');
  dom.btnDockClose.classList.remove('hidden');
  renderSpatialCards();
}

function closeSpatialArena() {
  state.isOpened = false;
  dom.openedContainer.classList.add('hidden');
  dom.btnDockClose.classList.add('hidden');
  dom.closedContainer.classList.remove('hidden');
  renderClosedArtifact();
}

/**
 * ============================================================================
 * 3. OPENED STATE: ORGANIC FLOATING GLASS CARDS
 * ============================================================================
 */
function renderSpatialCards() {
  dom.spatialCardsField.innerHTML = '';
  if (state.tracks.length === 0) return;

  state.tracks.slice(0, 6).forEach((track, index) => {
    const card = document.createElement('article');
    const isLiked = state.likedTrackIds.has(track.id);
    const isActive = index === state.activeIndex;

    const positionIndex = (index - state.activeIndex + state.tracks.length) % state.tracks.length;
    const posClass = SPATIAL_POSITIONS[positionIndex] || 'pos-bg-far-right';

    card.className = `glass-track-card drifting ${posClass} ${isActive ? 'is-active' : ''}`;
    card.dataset.index = index;

    const coverArt = track.image || 'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=600&auto=format&fit=crop&q=80';

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
  dom.triggerPlayIcon.classList.toggle('hidden', state.isPlaying);
  dom.triggerPauseIcon.classList.toggle('hidden', !state.isPlaying);

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
