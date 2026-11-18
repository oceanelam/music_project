/**
 * ============================================================================
 * EDITORIAL SPATIAL GLASS MUSIC PLAYER (frontend/app.js)
 * ============================================================================
 * Architecture Rules:
 * 1. Strict Reverse Proxy: Calls /api/recent-tracks exclusively.
 * 2. Caching: 60s in-memory cache handled transparently by the backend proxy.
 * 3. Exact Center Focus: Active card is always at x: 0, scale: 1.08, crisp focus.
 * 4. Interactive Drag, Swipe & Scroll: Smooth tactile gestures with loop navigation.
 */

const state = {
  tracks: [],
  currentUser: '',
  activeIndex: 0,
  isOpened: false,
  isPlaying: false,
  progressSeconds: 0,
  trackDuration: 30,
  likedTracks: new Map(), // id -> track object
  audioEl: null,
  currentAudioTrackId: null,
  isAudioLoading: false,
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

  realAudioPlayer: document.getElementById('real-audio-player'),
  likedCountBadge: document.getElementById('liked-count'),
  modalLikedCount: document.getElementById('modal-liked-count'),
  likedModalBackdrop: document.getElementById('liked-modal-backdrop'),
  likedTracksList: document.getElementById('liked-tracks-list'),
};

const DEFAULT_COVER = 'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=600&auto=format&fit=crop&q=80';

// Drag & Gesture State
let isPointerDown = false;
let pointerStartX = 0;
let dragDeltaX = 0;
let hasDragged = false;
let lastWheelTimestamp = 0;

/**
 * ============================================================================
 * 1. PROXY DATA FETCHING (Zero direct calls to Last.fm)
 * ============================================================================
 */
async function loadRecentTracks() {
  try {
    const response = await fetch('/api/recent-tracks?limit=20');
    const data = await response.json();

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

    if (dom.errorContainer) dom.errorContainer.classList.add('hidden');

    // If account has 0 scrobbles recorded on Last.fm
    if (!Array.isArray(data.tracks) || data.tracks.length === 0) {
      state.tracks = [];
      showEmptyAccountState(state.currentUser);
      return;
    }

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

function showEmptyAccountState(username) {
  if (dom.closedContainer) dom.closedContainer.classList.remove('hidden');
  if (dom.openedContainer) dom.openedContainer.classList.add('hidden');
  if (dom.btnDockClose) dom.btnDockClose.classList.add('hidden');
  if (dom.errorContainer) dom.errorContainer.classList.add('hidden');

  if (dom.closedCoverImg) dom.closedCoverImg.src = DEFAULT_COVER;
  if (dom.closedTrackTitle) dom.closedTrackTitle.textContent = 'No Scrobbles Yet';
  if (dom.closedTrackArtist) dom.closedTrackArtist.textContent = `User '${username}' • Play songs on Spotify`;
}

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
  updateTimelineDisplays();
}

/**
 * Click-Wheel Closed Controls (Prev / Next / Play-Pause with event.stopPropagation())
 * Ensures clicking |<<, >>|, or >|| updates LCD playback WITHOUT opening spatial cards.
 */
function closedPrev(e) {
  if (e) {
    e.stopPropagation();
    e.preventDefault();
  }
  prevTrack();
  renderClosedArtifact();
}

function closedNext(e) {
  if (e) {
    e.stopPropagation();
    e.preventDefault();
  }
  nextTrack();
  renderClosedArtifact();
}

function closedTogglePlay(e) {
  if (e) {
    e.stopPropagation();
    e.preventDefault();
  }
  togglePlay();
  renderClosedArtifact();
}

function initClickWheelControls() {
  const prevBtn = document.getElementById('wheel-prev-btn');
  const nextBtn = document.getElementById('wheel-next-btn');
  const playBtn = document.getElementById('wheel-play-btn');
  const menuBtn = document.getElementById('wheel-menu-btn');
  const centerBtn = document.getElementById('wheel-center-btn');

  if (prevBtn) {
    prevBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      e.preventDefault();
      closedPrev(e);
    });
  }

  if (nextBtn) {
    nextBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      e.preventDefault();
      closedNext(e);
    });
  }

  if (playBtn) {
    playBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      e.preventDefault();
      closedTogglePlay(e);
    });
  }

  if (menuBtn) {
    menuBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      e.preventDefault();
      openSpatialArena();
    });
  }

  if (centerBtn) {
    centerBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      e.preventDefault();
      openSpatialArena();
    });
  }
}

function openSpatialArena() {
  if (state.isOpened) return;
  state.isOpened = true;

  // Camera-zoom dive transition into the MP3 device screen
  if (dom.closedContainer) {
    dom.closedContainer.classList.add('dive-in');
  }

  setTimeout(() => {
    if (dom.closedContainer) {
      dom.closedContainer.classList.add('hidden');
      dom.closedContainer.classList.remove('dive-in');
    }
    if (dom.openedContainer) {
      dom.openedContainer.classList.remove('hidden');
      dom.openedContainer.classList.remove('dive-out');
    }
    if (dom.btnDockClose) dom.btnDockClose.classList.remove('hidden');
    if (dom.errorContainer) dom.errorContainer.classList.add('hidden');

    buildSpatialCardElements();
    updateSpatialTransforms(0);
  }, 480);
}

function closeSpatialArena() {
  if (!state.isOpened) return;
  state.isOpened = false;

  // Automatically pause audio when closing the player
  pauseCurrentAudio();

  // Zoom back out of the spatial cosmos to the MP3 device
  if (dom.openedContainer) {
    dom.openedContainer.classList.add('dive-out');
  }
  if (dom.closedContainer) {
    dom.closedContainer.classList.remove('hidden');
    dom.closedContainer.classList.add('zoom-back-in');
  }

  setTimeout(() => {
    if (dom.openedContainer) {
      dom.openedContainer.classList.add('hidden');
      dom.openedContainer.classList.remove('dive-out');
    }
    if (dom.btnDockClose) dom.btnDockClose.classList.add('hidden');
    if (dom.closedContainer) {
      dom.closedContainer.classList.remove('zoom-back-in');
    }
    renderClosedArtifact();
  }, 460);
}

/**
 * ============================================================================
 * 3. OPENED STATE: CENTER FOCUS & 3D SPATIAL CAROUSEL
 * ============================================================================
 */
function showOpenedView() {
  if (dom.closedContainer) dom.closedContainer.classList.add('hidden');
  if (dom.openedContainer) dom.openedContainer.classList.remove('hidden');
  if (dom.btnDockClose) dom.btnDockClose.classList.remove('hidden');
  if (dom.errorContainer) dom.errorContainer.classList.add('hidden');

  buildSpatialCardElements();
  updateSpatialTransforms(0);
}

/**
 * Build card DOM nodes only once or on track update
 */
function buildSpatialCardElements() {
  if (!dom.spatialCardsField) return;
  dom.spatialCardsField.innerHTML = '';

  if (state.tracks.length === 0) {
    const emptyCard = document.createElement('div');
    emptyCard.className = 'glass-message-card';
    emptyCard.innerHTML = `
      <div class="message-icon-wrap">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
          <circle cx="12" cy="12" r="10"></circle>
          <polygon points="10 8 16 12 10 16 10 8"></polygon>
        </svg>
      </div>
      <h2 class="message-title">Account Connected: ${state.currentUser}</h2>
      <p class="message-desc">Your Last.fm account is verified and ready. Start listening to music on Spotify/Last.fm to see your rotation float here.</p>
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

  state.tracks.forEach((track, index) => {
    const card = document.createElement('article');
    const isLiked = state.likedTracks.has(String(track.id));
    card.className = 'glass-track-card';
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
        <!-- Shuffle -->
        <button class="minimal-icon-btn" onclick="event.stopPropagation(); window.shuffleTracks();" title="Shuffle" aria-label="Shuffle">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
            <polyline points="16 3 21 3 21 8"></polyline>
            <line x1="4" y1="20" x2="21" y2="3"></line>
            <polyline points="21 16 21 21 16 21"></polyline>
            <line x1="15" y1="15" x2="21" y2="21"></line>
            <line x1="4" y1="4" x2="9" y2="9"></line>
          </svg>
        </button>

        <!-- Previous -->
        <button class="minimal-icon-btn" onclick="event.stopPropagation(); window.prevTrack();" title="Previous" aria-label="Previous">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
            <polygon points="19 20 9 12 19 4 19 20"></polygon>
            <line x1="5" y1="19" x2="5" y2="5" stroke="currentColor" stroke-width="2"></line>
          </svg>
        </button>

        <!-- Round Solid White Play/Pause Button -->
        <button class="round-white-play-btn" onclick="event.stopPropagation(); window.toggleCardPlay(${index});" title="Play or Pause" aria-label="Play">
          <svg class="icon-play" width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
            <polygon points="6 4 20 12 6 20 6 4"></polygon>
          </svg>
          <svg class="icon-pause hidden" width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
            <rect x="6" y="4" width="4" height="16"></rect>
            <rect x="14" y="4" width="4" height="16"></rect>
          </svg>
        </button>

        <!-- Next -->
        <button class="minimal-icon-btn" onclick="event.stopPropagation(); window.nextTrack();" title="Next" aria-label="Next">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
            <polygon points="5 4 15 12 5 20 5 4"></polygon>
            <line x1="19" y1="5" x2="19" y2="19" stroke="currentColor" stroke-width="2"></line>
          </svg>
        </button>

        <!-- Heart / Favorite -->
        <button class="minimal-icon-btn card-heart-btn ${isLiked ? 'is-liked' : ''}" onclick="event.stopPropagation(); window.toggleLike('${track.id}');" title="${isLiked ? 'Unlike' : 'Favorite'}" aria-label="Favorite">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="${isLiked ? '#e11d48' : 'none'}" stroke="${isLiked ? '#e11d48' : 'currentColor'}" stroke-width="1.8">
            <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"></path>
          </svg>
        </button>
      </div>
    `;

    // Clicking anywhere on a card centers it, unless the user was dragging
    card.addEventListener('click', (e) => {
      if (hasDragged) return;
      if (e.target.closest('button, a')) return;
      selectTrack(index);
    });

    dom.spatialCardsField.appendChild(card);
  });

  updatePlayStateUI();
}

/**
 * Compute and apply 3D transforms symmetrically around activeIndex
 * @param {number} [dragOffsetPx=0] Real-time drag delta for tactile micro-feedback
 */
function updateSpatialTransforms(dragOffsetPx = 0) {
  const cards = document.querySelectorAll('.glass-track-card');
  const N = state.tracks.length;
  if (N === 0 || cards.length === 0) return;

  const isMobile = window.innerWidth <= 768;
  const stepX = isMobile ? Math.min(270, window.innerWidth * 0.72) : 340;

  cards.forEach((card) => {
    const index = parseInt(card.dataset.index, 10);

    // Calculate signed shortest distance in loop (-N/2 to N/2)
    let offset = index - state.activeIndex;
    while (offset > N / 2) offset -= N;
    while (offset < -N / 2) offset += N;

    const isActive = offset === 0;

    let tx = 0;
    let ty = 0;
    let tz = 0;
    let rot = 0;
    let sc = 1;
    let opacity = 1;
    let blur = 0;
    let zIndex = 1;
    let pointerEvents = 'auto';

    if (isActive) {
      // EXACT CENTER FOREGROUND
      tx = dragOffsetPx;
      ty = 0;
      tz = 80;
      rot = dragOffsetPx * 0.02;
      sc = 1.08;
      opacity = 1;
      blur = 0;
      zIndex = 30;
      card.classList.add('is-active');
    } else {
      card.classList.remove('is-active');

      if (offset === -1) {
        // Immediate Left
        tx = -stepX + dragOffsetPx * 0.85;
        ty = -16;
        tz = -35;
        rot = -2.8;
        sc = 0.85;
        opacity = 0.85;
        blur = 0.4;
        zIndex = 20;
      } else if (offset === 1) {
        // Immediate Right
        tx = stepX + dragOffsetPx * 0.85;
        ty = 16;
        tz = -35;
        rot = 2.8;
        sc = 0.85;
        opacity = 0.85;
        blur = 0.4;
        zIndex = 20;
      } else if (offset === -2) {
        // Far Left
        tx = -stepX * 1.85 + dragOffsetPx * 0.65;
        ty = 26;
        tz = -120;
        rot = -5;
        sc = 0.72;
        opacity = 0.55;
        blur = 1.5;
        zIndex = 10;
      } else if (offset === 2) {
        // Far Right
        tx = stepX * 1.85 + dragOffsetPx * 0.65;
        ty = -24;
        tz = -120;
        rot = 4.5;
        sc = 0.72;
        opacity = 0.55;
        blur = 1.5;
        zIndex = 10;
      } else {
        // Hidden beyond view
        const sign = offset < 0 ? -1 : 1;
        tx = sign * (stepX * 2.6) + dragOffsetPx * 0.4;
        ty = 35;
        tz = -220;
        rot = sign * 8;
        sc = 0.55;
        opacity = 0;
        blur = 3;
        zIndex = 1;
        pointerEvents = 'none';
      }
    }

    card.style.transform = `translate3d(${tx}px, ${ty}px, ${tz}px) rotate(${rot}deg) scale(${sc})`;
    card.style.opacity = String(opacity);
    card.style.filter = blur > 0 ? `blur(${blur}px)` : 'none';
    card.style.zIndex = String(zIndex);
    card.style.pointerEvents = pointerEvents;
  });

  updateTimelineDisplays();
  updatePlayStateUI();
}

/**
 * Select track and bring smoothly to exact center
 */
function selectTrack(index) {
  if (index < 0 || index >= state.tracks.length) return;
  const changed = state.activeIndex !== index;
  state.activeIndex = index;

  if (changed) {
    state.progressSeconds = 0;
    if (state.audioEl) {
      state.audioEl.currentTime = 0;
    }
  }

  renderClosedArtifact();
  updateSpatialTransforms(0);

  if (changed && state.isPlaying) {
    playCurrentAudio();
  }
}

function nextTrack() {
  if (state.tracks.length === 0) return;
  selectTrack((state.activeIndex + 1) % state.tracks.length);
}

function prevTrack() {
  if (state.tracks.length === 0) return;
  selectTrack((state.activeIndex - 1 + state.tracks.length) % state.tracks.length);
}

function shuffleTracks() {
  if (state.tracks.length === 0) return;
  let rand = Math.floor(Math.random() * state.tracks.length);
  if (rand === state.activeIndex && state.tracks.length > 1) {
    rand = (rand + 1) % state.tracks.length;
  }
  selectTrack(rand);
}

/**
 * ============================================================================
 * 4. DRAG, SWIPE & WHEEL GESTURE ENGINE
 * ============================================================================
 */
function setupGestureControls() {
  const container = dom.openedContainer;
  if (!container) return;

  // Pointer / Mouse / Touch Down
  function handleStart(clientX) {
    isPointerDown = true;
    pointerStartX = clientX;
    dragDeltaX = 0;
    hasDragged = false;
    container.classList.add('is-grabbing');
    document.querySelectorAll('.glass-track-card').forEach((c) => c.classList.add('is-dragging'));
  }

  // Pointer / Mouse / Touch Move
  function handleMove(clientX) {
    if (!isPointerDown) return;
    const dx = clientX - pointerStartX;
    if (Math.abs(dx) > 6) {
      hasDragged = true;
    }
    dragDeltaX = dx;
    updateSpatialTransforms(dragDeltaX);
  }

  // Pointer / Mouse / Touch End
  function handleEnd() {
    if (!isPointerDown) return;
    isPointerDown = false;
    container.classList.remove('is-grabbing');
    document.querySelectorAll('.glass-track-card').forEach((c) => c.classList.remove('is-dragging'));

    const threshold = 55; // pixels to step forward/backward
    if (dragDeltaX < -threshold) {
      nextTrack();
    } else if (dragDeltaX > threshold) {
      prevTrack();
    } else {
      updateSpatialTransforms(0);
    }

    dragDeltaX = 0;
    setTimeout(() => {
      hasDragged = false;
    }, 60);
  }

  // Unified Pointer Events
  container.addEventListener('pointerdown', (e) => {
    if (e.target.closest('button, a, input')) return;
    handleStart(e.clientX);
  });

  window.addEventListener('pointermove', (e) => {
    if (!isPointerDown) return;
    handleMove(e.clientX);
  });

  window.addEventListener('pointerup', () => {
    if (isPointerDown) handleEnd();
  });

  window.addEventListener('pointercancel', () => {
    if (isPointerDown) handleEnd();
  });

  // Touch fallback
  container.addEventListener('touchstart', (e) => {
    if (e.touches.length > 0 && !e.target.closest('button, a')) {
      handleStart(e.touches[0].clientX);
    }
  }, { passive: true });

  window.addEventListener('touchmove', (e) => {
    if (isPointerDown && e.touches.length > 0) {
      handleMove(e.touches[0].clientX);
    }
  }, { passive: true });

  window.addEventListener('touchend', () => {
    if (isPointerDown) handleEnd();
  });

  // Mouse wheel / trackpad scroll
  container.addEventListener('wheel', (e) => {
    e.preventDefault();
    const now = Date.now();
    if (now - lastWheelTimestamp < 220) return; // Throttled to prevent skipping cards
    const delta = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
    if (Math.abs(delta) > 12) {
      lastWheelTimestamp = now;
      if (delta > 0) {
        nextTrack();
      } else {
        prevTrack();
      }
    }
  }, { passive: false });
}

/**
 * ============================================================================
 * 5. REAL AUDIO PLAYBACK (Via Backend /api/preview Proxy) & SYNTH FALLBACK
 * ============================================================================
 */
function initHtml5Audio() {
  const audioEl = document.getElementById('real-audio-player');
  if (!audioEl) return;
  state.audioEl = audioEl;

  audioEl.addEventListener('timeupdate', () => {
    if (audioEl.duration && !isNaN(audioEl.duration) && audioEl.duration > 0) {
      state.progressSeconds = Math.floor(audioEl.currentTime);
      state.trackDuration = Math.floor(audioEl.duration);
    }
    updateTimelineDisplays();
  });

  audioEl.addEventListener('ended', () => {
    // Automatically advance to the next track on preview end
    nextTrack();
  });

  audioEl.addEventListener('play', () => {
    state.isPlaying = true;
    updatePlayStateUI();
  });

  audioEl.addEventListener('pause', () => {
    state.isPlaying = false;
    updatePlayStateUI();
  });

  audioEl.addEventListener('error', (e) => {
    console.warn('HTML5 Audio encountered error or missing stream. Falling back to ambient synth.', e);
    if (state.isPlaying) {
      startGentleSynth();
    }
  });
}

async function togglePlay() {
  if (state.tracks.length === 0) return;
  const current = state.tracks[state.activeIndex] || state.tracks[0];
  if (!current) return;

  if (state.isPlaying) {
    pauseCurrentAudio();
  } else {
    await playCurrentAudio();
  }
}

async function toggleCardPlay(index) {
  if (state.activeIndex !== index) {
    selectTrack(index);
    await playCurrentAudio();
  } else {
    await togglePlay();
  }
  updatePlayStateUI();
}

async function playCurrentAudio() {
  if (state.tracks.length === 0) return;
  const current = state.tracks[state.activeIndex] || state.tracks[0];
  if (!current) return;

  const audioEl = state.audioEl || document.getElementById('real-audio-player');
  if (!audioEl) {
    state.isPlaying = true;
    startGentleSynth();
    updatePlayStateUI();
    return;
  }

  // If this audio preview is already loaded on the element, simply resume
  if (state.currentAudioTrackId === String(current.id) && audioEl.src) {
    try {
      await audioEl.play();
      state.isPlaying = true;
      stopGentleSynth();
      updatePlayStateUI();
      return;
    } catch (e) {
      console.warn('Audio resume interrupted, reloading stream:', e);
    }
  }

  // Load 30s preview from backend proxy route exclusively (zero external requests in browser)
  setAudioLoadingUI(true);
  try {
    const res = await fetch(`/api/preview?track=${encodeURIComponent(current.title)}&artist=${encodeURIComponent(current.artist)}`);
    const data = await res.json();

    if (data.success && data.hasPreview && data.previewUrl) {
      audioEl.src = data.previewUrl;
      state.currentAudioTrackId = String(current.id);
      state.trackDuration = data.durationSeconds || 30;
      await audioEl.play();
      state.isPlaying = true;
      stopGentleSynth();
    } else {
      console.log(`[AUDIO] No iTunes preview found for "${current.title}", using gentle synth fallback.`);
      state.isPlaying = true;
      startGentleSynth();
    }
  } catch (err) {
    console.error('Failed to load audio preview from proxy:', err);
    state.isPlaying = true;
    startGentleSynth();
  } finally {
    setAudioLoadingUI(false);
    updatePlayStateUI();
    updateTimelineDisplays();
  }
}

function pauseCurrentAudio() {
  state.isPlaying = false;
  const audioEl = state.audioEl || document.getElementById('real-audio-player');
  if (audioEl) {
    audioEl.pause();
  }
  stopGentleSynth();
  updatePlayStateUI();
}

function setAudioLoadingUI(isLoading) {
  state.isAudioLoading = isLoading;
  const lcdFill = document.querySelector('.lcd-progress-fill');
  if (lcdFill) lcdFill.classList.toggle('is-loading', isLoading);

  const cardFill = document.getElementById(`timeline-fill-${state.activeIndex}`);
  if (cardFill) cardFill.classList.toggle('is-loading', isLoading);
}

function handleTimelineScrub(e, index) {
  if (state.activeIndex !== index) {
    selectTrack(index);
  }
  const rect = e.currentTarget.getBoundingClientRect();
  const clickX = e.clientX - rect.left;
  const ratio = Math.max(0, Math.min(1, clickX / rect.width));
  const targetTime = ratio * state.trackDuration;
  state.progressSeconds = Math.floor(targetTime);

  const audioEl = state.audioEl || document.getElementById('real-audio-player');
  if (audioEl && !isNaN(audioEl.duration) && audioEl.duration > 0) {
    audioEl.currentTime = targetTime;
  }
  updateTimelineDisplays();
}

/**
 * ============================================================================
 * 6. LIKED TRACKS (Heart Toggle, LocalStorage Persistence & Drawer Modal)
 * ============================================================================
 */
function loadLikedTracksFromStorage() {
  try {
    const raw = localStorage.getItem('spatial_liked_tracks');
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        state.likedTracks = new Map(parsed.map((t) => [String(t.id), t]));
      }
    }
  } catch (e) {
    console.warn('Failed to parse liked tracks from localStorage:', e);
    state.likedTracks = new Map();
  }
  updateLikedCountUI();
}

function saveLikedTracksToStorage() {
  try {
    const list = Array.from(state.likedTracks.values());
    localStorage.setItem('spatial_liked_tracks', JSON.stringify(list));
  } catch (e) {}
  updateLikedCountUI();
}

function updateLikedCountUI() {
  const count = state.likedTracks.size;
  const countBadge = document.getElementById('liked-count');
  const modalCount = document.getElementById('modal-liked-count');
  if (countBadge) countBadge.textContent = String(count);
  if (modalCount) modalCount.textContent = String(count);
}

function toggleLike(trackId) {
  const idStr = String(trackId);
  const isLiked = state.likedTracks.has(idStr);

  // Find track in current tracks or in liked list
  let trackObj = state.tracks.find((t) => String(t.id) === idStr) || state.likedTracks.get(idStr);

  if (isLiked) {
    state.likedTracks.delete(idStr);
  } else if (trackObj) {
    state.likedTracks.set(idStr, {
      id: trackObj.id,
      title: trackObj.title,
      artist: trackObj.artist,
      album: trackObj.album || '',
      image: trackObj.image || DEFAULT_COVER,
    });
  }

  saveLikedTracksToStorage();

  // Find heart button on active card to trigger pop animation
  const cardBtn = document.querySelector(`.glass-track-card[data-index="${state.activeIndex}"] .card-heart-btn`);
  if (cardBtn) {
    cardBtn.classList.add('pop');
    setTimeout(() => cardBtn.classList.remove('pop'), 450);
  }

  buildSpatialCardElements();
  updateSpatialTransforms(0);

  // If modal is open, re-render its list immediately
  const modal = document.getElementById('liked-modal-backdrop');
  if (modal && !modal.classList.contains('hidden')) {
    renderLikedDrawerContent();
  }
}

function toggleLikedDrawer() {
  const modal = document.getElementById('liked-modal-backdrop');
  if (!modal) return;
  const isHidden = modal.classList.contains('hidden');
  if (isHidden) {
    modal.classList.remove('hidden');
    renderLikedDrawerContent();
  } else {
    modal.classList.add('hidden');
  }
}

function closeLikedDrawer(e) {
  if (e && e.target && e.target !== e.currentTarget && !e.target.classList.contains('modal-close-btn')) {
    return;
  }
  const modal = document.getElementById('liked-modal-backdrop');
  if (modal) modal.classList.add('hidden');
}

function renderLikedDrawerContent() {
  const listEl = document.getElementById('liked-tracks-list');
  if (!listEl) return;
  listEl.innerHTML = '';

  const likedArr = Array.from(state.likedTracks.values());
  if (likedArr.length === 0) {
    listEl.innerHTML = `
      <div class="modal-empty-state">
        <div class="modal-empty-icon">♡</div>
        <h3 class="modal-empty-title">Your favorites collection is empty</h3>
        <p class="modal-empty-desc">Click the heart icon on any floating music card to save songs into your personal archive.</p>
      </div>
    `;
    return;
  }

  likedArr.forEach((track) => {
    const row = document.createElement('div');
    row.className = 'liked-track-row';
    const artSrc = track.image || DEFAULT_COVER;

    row.innerHTML = `
      <img src="${artSrc}" alt="${escapeHtml(track.title)}" class="liked-row-art" />
      <div class="liked-row-meta">
        <span class="liked-row-title" title="${escapeHtml(track.title)}">${escapeHtml(track.title)}</span>
        <span class="liked-row-artist" title="${escapeHtml(track.artist)}">${escapeHtml(track.artist)}</span>
      </div>
      <div class="liked-row-actions">
        <button class="liked-row-play-btn" onclick="window.playLikedTrack('${track.id}')" title="Play ${escapeHtml(track.title)}" aria-label="Play track">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
            <polygon points="6 4 20 12 6 20 6 4"></polygon>
          </svg>
        </button>
        <button class="liked-row-remove-btn" onclick="window.toggleLike('${track.id}')" title="Remove from Favorites" aria-label="Remove favorite">
          ✕
        </button>
      </div>
    `;
    listEl.appendChild(row);
  });
}

function playLikedTrack(trackId) {
  const idStr = String(trackId);
  const trackIdx = state.tracks.findIndex((t) => String(t.id) === idStr);

  if (trackIdx !== -1) {
    selectTrack(trackIdx);
    playCurrentAudio();
  } else {
    const likedObj = state.likedTracks.get(idStr);
    if (likedObj) {
      state.tracks.unshift(likedObj);
      buildSpatialCardElements();
      selectTrack(0);
      playCurrentAudio();
    }
  }

  closeLikedDrawer();
}

/**
 * ============================================================================
 * 7. UI DISPLAY & SYNTHESIS CONTROLS
 * ============================================================================
 */
function updatePlayStateUI() {
  if (dom.triggerPlayIcon) dom.triggerPlayIcon.classList.toggle('hidden', state.isPlaying);
  if (dom.triggerPauseIcon) dom.triggerPauseIcon.classList.toggle('hidden', !state.isPlaying);

  // Sync retro MP3 LCD screen glyph & playback indicator
  const lcdGlyph = document.querySelector('.lcd-play-glyph');
  const lcdText = document.querySelector('.lcd-playing-indicator span:last-child');
  if (lcdGlyph) {
    lcdGlyph.textContent = state.isPlaying ? '▶' : '❚❚';
    lcdGlyph.style.color = state.isPlaying ? '#60a5fa' : '#9499a6';
  }
  if (lcdText) {
    lcdText.textContent = state.isPlaying ? 'Now playing' : 'Paused';
  }

  const lcdProgressFill = document.querySelector('.lcd-progress-fill');
  if (lcdProgressFill) {
    if (state.isPlaying) {
      lcdProgressFill.classList.add('is-animating');
    } else {
      lcdProgressFill.classList.remove('is-animating');
    }
  }

  document.querySelectorAll('.glass-track-card').forEach((card) => {
    const idx = parseInt(card.dataset.index, 10);
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

  // Sync retro MP3 LCD screen progress fill & times
  const lcdFill = document.querySelector('.lcd-progress-fill');
  if (lcdFill) lcdFill.style.width = `${pct}%`;

  const lcdTimeReadout = document.querySelector('.lcd-time-readout');
  if (lcdTimeReadout) {
    const mins = Math.floor(state.progressSeconds / 60);
    const secs = String(state.progressSeconds % 60).padStart(2, '0');
    const rem = Math.max(0, state.trackDuration - state.progressSeconds);
    const remMins = Math.floor(rem / 60);
    const remSecs = String(rem % 60).padStart(2, '0');
    lcdTimeReadout.innerHTML = `<span>${mins}:${secs}</span><span>-${remMins}:${remSecs}</span>`;
  }
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

// Fallback timer for synth progress if real audio element is inactive
setInterval(() => {
  if (state.isPlaying && (!state.audioEl || state.audioEl.paused)) {
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
  } else if (e.code === 'Escape') {
    e.preventDefault();
    const modal = document.getElementById('liked-modal-backdrop');
    if (modal && !modal.classList.contains('hidden')) {
      closeLikedDrawer();
    } else if (state.isOpened) {
      closeSpatialArena();
    }
  }
});

// Window resize listener to keep cards symmetrically centered
window.addEventListener('resize', () => {
  if (state.isOpened) {
    updateSpatialTransforms(0);
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
window.closedPrev = closedPrev;
window.closedNext = closedNext;
window.closedTogglePlay = closedTogglePlay;
window.toggleCardPlay = toggleCardPlay;
window.nextTrack = nextTrack;
window.prevTrack = prevTrack;
window.shuffleTracks = shuffleTracks;
window.toggleLike = toggleLike;
window.toggleLikedDrawer = toggleLikedDrawer;
window.closeLikedDrawer = closeLikedDrawer;
window.playLikedTrack = playLikedTrack;
window.handleTimelineScrub = handleTimelineScrub;

window.addEventListener('DOMContentLoaded', () => {
  initHtml5Audio();
  loadLikedTracksFromStorage();
  initClickWheelControls();
  setupGestureControls();
  loadRecentTracks();
});
