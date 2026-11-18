/**
 * ============================================================================
 * LAST.FM PROXY SERVICE (backend/lastfmService.js)
 * ============================================================================
 * Purpose:
 * 1. Architecture & Security: Keeps LASTFM_API_KEY and LASTFM_USERNAME safe on server.
 *    The browser NEVER contacts ws.audioscrobbler.com directly.
 * 2. Caching & Resilience: Works hand-in-hand with backend/cache.js (60s TTL).
 * 3. Graceful Fallbacks: If offline or if user/key not yet set, provides
 *    high-resolution fallback tracks so the editorial UI displays seamlessly.
 */

const LASTFM_BASE_URL = 'https://ws.audioscrobbler.com/2.0/';

/**
 * Editorial fallback tracks (used if offline or before .env is configured)
 */
const FALLBACK_TRACKS = [
  {
    id: 'track-1',
    title: 'Starboy',
    artist: 'The Weeknd, Daft Punk',
    album: 'Starboy',
    image: 'https://images.unsplash.com/photo-1514525253161-7a46d19cd819?w=700&auto=format&fit=crop&q=80',
    nowPlaying: true,
    url: 'https://www.last.fm/music/The+Weeknd/_/Starboy',
  },
  {
    id: 'track-2',
    title: 'Midnight City',
    artist: 'M83',
    album: 'Hurry Up, We\'re Dreaming',
    image: 'https://images.unsplash.com/photo-1470225620780-dba8ba36b745?w=700&auto=format&fit=crop&q=80',
    nowPlaying: false,
    url: 'https://www.last.fm/music/M83/_/Midnight+City',
  },
  {
    id: 'track-3',
    title: 'Instant Crush',
    artist: 'Daft Punk, Julian Casablancas',
    album: 'Random Access Memories',
    image: 'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=700&auto=format&fit=crop&q=80',
    nowPlaying: false,
    url: 'https://www.last.fm/music/Daft+Punk/_/Instant+Crush',
  },
  {
    id: 'track-4',
    title: 'Nightcall',
    artist: 'Kavinsky',
    album: 'OutRun',
    image: 'https://images.unsplash.com/photo-1508700115892-45ecd05ae2ad?w=700&auto=format&fit=crop&q=80',
    nowPlaying: false,
    url: 'https://www.last.fm/music/Kavinsky/_/Nightcall',
  },
  {
    id: 'track-5',
    title: 'Resonance',
    artist: 'HOME',
    album: 'Odyssey',
    image: 'https://images.unsplash.com/photo-1498038432885-c6f3f1b912ee?w=700&auto=format&fit=crop&q=80',
    nowPlaying: false,
    url: 'https://www.last.fm/music/HOME/_/Resonance',
  },
  {
    id: 'track-6',
    title: 'Get Lucky',
    artist: 'Daft Punk, Pharrell Williams',
    album: 'Random Access Memories',
    image: 'https://images.unsplash.com/photo-1465847899084-d164df4dedc6?w=700&auto=format&fit=crop&q=80',
    nowPlaying: false,
    url: 'https://www.last.fm/music/Daft+Punk/_/Get+Lucky',
  },
];

/**
 * Extracts the best cover art URL from Last.fm's image array
 */
function extractBestImage(imageArray) {
  if (!Array.isArray(imageArray) || imageArray.length === 0) return null;
  const preferredSizes = ['extralarge', 'large', 'medium', 'small'];
  for (const size of preferredSizes) {
    const found = imageArray.find((img) => img.size === size && img['#text']);
    if (found && found['#text'].trim().length > 0) {
      return found['#text'].trim();
    }
  }
  const fallback = imageArray.find((img) => img['#text'] && img['#text'].trim().length > 0);
  return fallback ? fallback['#text'].trim() : null;
}

/**
 * Fetch recent tracks from Last.fm API for the configured user
 * @param {string} username - Target Last.fm username from process.env.LASTFM_USERNAME
 * @param {number} limit - Number of tracks (default 6)
 */
async function fetchRecentTracks(username, limit = 6) {
  const apiKey = (process.env.LASTFM_API_KEY || '').trim();
  const targetUser = (username || process.env.LASTFM_USERNAME || '').trim();

  // Guard: Ensure user and API key are configured in .env
  if (!targetUser || targetUser === 'YOUR_LASTFM_USERNAME') {
    console.warn('[NOTICE] LASTFM_USERNAME not configured in .env. Showing editorial preview tracks.');
    return {
      success: true,
      user: 'You',
      isFallback: true,
      warning: 'Please set your LASTFM_USERNAME in your .env file to load your personal music history.',
      tracks: FALLBACK_TRACKS.slice(0, limit),
      totalTracks: FALLBACK_TRACKS.length,
    };
  }

  if (!apiKey || apiKey === 'YOUR_LASTFM_API_KEY') {
    console.warn('[NOTICE] LASTFM_API_KEY not configured in .env. Showing editorial preview tracks.');
    return {
      success: true,
      user: targetUser,
      isFallback: true,
      warning: 'Please set your LASTFM_API_KEY in your .env file.',
      tracks: FALLBACK_TRACKS.slice(0, limit),
      totalTracks: FALLBACK_TRACKS.length,
    };
  }

  // Construct Last.fm endpoint URL
  const params = new URLSearchParams({
    method: 'user.getrecenttracks',
    user: targetUser,
    api_key: apiKey,
    format: 'json',
    limit: String(limit),
  });

  const targetUrl = `${LASTFM_BASE_URL}?${params.toString()}`;
  console.log(`[OUTBOUND PROXY] Fetching Last.fm recent tracks for user '${targetUser}'...`);

  try {
    // 6-second timeout using native AbortSignal
    const response = await fetch(targetUrl, {
      signal: AbortSignal.timeout(6000),
      headers: {
        'User-Agent': 'EditorialMusicProxy/2.0.0',
      },
    });

    if (!response.ok) {
      const errorBody = await response.text();
      console.error(`[LAST.FM ERROR] Status ${response.status}: ${errorBody}`);
      throw new Error(`Last.fm API returned HTTP ${response.status}`);
    }

    const json = await response.json();

    if (json.error) {
      console.warn(`[LAST.FM LOGICAL ERROR] Code ${json.error}: ${json.message}`);
      throw new Error(`Last.fm: ${json.message || 'Unknown API error'}`);
    }

    const rawTracks = json.recenttracks?.track || [];
    const trackList = Array.isArray(rawTracks) ? rawTracks : [rawTracks];

    const normalizedTracks = trackList.map((t, index) => {
      const isNowPlaying = t['@attr'] && t['@attr'].nowplaying === 'true';
      const rawImage = extractBestImage(t.image);
      const image = rawImage || FALLBACK_TRACKS[index % FALLBACK_TRACKS.length].image;

      return {
        id: `track-${index}-${(t.name || '').replace(/\s+/g, '-').toLowerCase()}`,
        title: t.name || 'Untitled',
        artist: t.artist?.['#text'] || t.artist?.name || 'Unknown Artist',
        album: t.album?.['#text'] || '',
        image: image,
        nowPlaying: Boolean(isNowPlaying),
        url: t.url || `https://www.last.fm/user/${encodeURIComponent(targetUser)}`,
      };
    });

    return {
      success: true,
      user: json.recenttracks?.['@attr']?.user || targetUser,
      isFallback: false,
      totalTracks: parseInt(json.recenttracks?.['@attr']?.total || String(normalizedTracks.length), 10),
      tracks: normalizedTracks,
    };
  } catch (err) {
    console.error(`[EXCEPTION] Error fetching from Last.fm: ${err.message}`);
    return {
      success: true,
      user: targetUser,
      isFallback: true,
      warning: `Unable to reach Last.fm (${err.message}). Showing editorial fallback tracks.`,
      tracks: FALLBACK_TRACKS.slice(0, limit),
      totalTracks: FALLBACK_TRACKS.length,
    };
  }
}

module.exports = {
  fetchRecentTracks,
  FALLBACK_TRACKS,
};
