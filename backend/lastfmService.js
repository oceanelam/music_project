/**
 * ============================================================================
 * LAST.FM PROXY SERVICE (backend/lastfmService.js)
 * ============================================================================
 * Purpose for Demo:
 * 1. Architecture & Security: Keeps LASTFM_API_KEY safe on the server.
 *    The browser NEVER contacts ws.audioscrobbler.com directly.
 * 2. Resilience: Includes timeouts (6s), error catching, and fallback data
 *    so the application never crashes even if Last.fm is down.
 * 3. Data Normalization: Cleans messy Last.fm XML-style JSON into a sleek,
 *    consistent format tailored for our floating MP3 UI.
 */

const LASTFM_BASE_URL = 'https://ws.audioscrobbler.com/2.0/';

/**
 * Procedural aesthetic gradients / high-res mock covers used as resilient fallbacks
 * when Last.fm returns an empty cover or when offline.
 */
const FALLBACK_TRACKS = [
  {
    id: 'mock-1',
    title: 'Starboy',
    artist: 'The Weeknd, Daft Punk',
    album: 'Starboy',
    image: 'https://images.unsplash.com/photo-1514525253161-7a46d19cd819?w=600&auto=format&fit=crop&q=80',
    nowPlaying: true,
    scrobbledAt: 'Now Playing',
    timestamp: Date.now(),
    url: 'https://www.last.fm/music/The+Weeknd/_/Starboy',
  },
  {
    id: 'mock-2',
    title: 'Midnight City',
    artist: 'M83',
    album: 'Hurry Up, We\'re Dreaming',
    image: 'https://images.unsplash.com/photo-1470225620780-dba8ba36b745?w=600&auto=format&fit=crop&q=80',
    nowPlaying: false,
    scrobbledAt: '14 minutes ago',
    timestamp: Date.now() - 14 * 60 * 1000,
    url: 'https://www.last.fm/music/M83/_/Midnight+City',
  },
  {
    id: 'mock-3',
    title: 'Instant Crush',
    artist: 'Daft Punk ft. Julian Casablancas',
    album: 'Random Access Memories',
    image: 'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=600&auto=format&fit=crop&q=80',
    nowPlaying: false,
    scrobbledAt: '42 minutes ago',
    timestamp: Date.now() - 42 * 60 * 1000,
    url: 'https://www.last.fm/music/Daft+Punk/_/Instant+Crush',
  },
  {
    id: 'mock-4',
    title: 'Nightcall',
    artist: 'Kavinsky',
    album: 'OutRun',
    image: 'https://images.unsplash.com/photo-1508700115892-45ecd05ae2ad?w=600&auto=format&fit=crop&q=80',
    nowPlaying: false,
    scrobbledAt: '1 hour ago',
    timestamp: Date.now() - 65 * 60 * 1000,
    url: 'https://www.last.fm/music/Kavinsky/_/Nightcall',
  },
  {
    id: 'mock-5',
    title: 'Resonance',
    artist: 'HOME',
    album: 'Odyssey',
    image: 'https://images.unsplash.com/photo-1498038432885-c6f3f1b912ee?w=600&auto=format&fit=crop&q=80',
    nowPlaying: false,
    scrobbledAt: '3 hours ago',
    timestamp: Date.now() - 180 * 60 * 1000,
    url: 'https://www.last.fm/music/HOME/_/Resonance',
  },
  {
    id: 'mock-6',
    title: 'Get Lucky',
    artist: 'Daft Punk ft. Pharrell Williams',
    album: 'Random Access Memories',
    image: 'https://images.unsplash.com/photo-1465847899084-d164df4dedc6?w=600&auto=format&fit=crop&q=80',
    nowPlaying: false,
    scrobbledAt: 'Yesterday',
    timestamp: Date.now() - 86400 * 1000,
    url: 'https://www.last.fm/music/Daft+Punk/_/Get+Lucky',
  },
];

/**
 * Format timestamp into human-friendly relative string
 */
function formatTimeAgo(timestampSeconds) {
  if (!timestampSeconds) return 'Recently';
  const seconds = Math.floor(Date.now() / 1000 - timestampSeconds);
  if (seconds < 60) return 'Just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

/**
 * Extracts the best cover art URL from Last.fm's image array
 */
function extractBestImage(imageArray) {
  if (!Array.isArray(imageArray) || imageArray.length === 0) return null;
  // Last.fm gives: small, medium, large, extralarge
  // We prioritize extralarge or large
  const preferredSizes = ['extralarge', 'large', 'medium', 'small'];
  for (const size of preferredSizes) {
    const found = imageArray.find((img) => img.size === size && img['#text']);
    if (found && found['#text'].trim().length > 0) {
      return found['#text'].trim();
    }
  }
  // If only arbitrary image exists
  const fallback = imageArray.find((img) => img['#text'] && img['#text'].trim().length > 0);
  return fallback ? fallback['#text'].trim() : null;
}

/**
 * Fetch recent tracks from Last.fm API with strict timeout & error handling
 * @param {string} username - Last.fm user account
 * @param {number} limit - Number of tracks to retrieve (default 8)
 * @returns {Promise<object>} - Normalized payload
 */
async function fetchRecentTracks(username = 'rj', limit = 8) {
  const apiKey = process.env.LASTFM_API_KEY;

  // Check if API key is configured
  if (!apiKey || apiKey.trim() === '' || apiKey === 'your_lastfm_api_key_here') {
    console.warn('[SECURITY WARNING] No valid LASTFM_API_KEY found in server environment variables.');
    return {
      success: true,
      user: username,
      isFallback: true,
      warning: 'No LASTFM_API_KEY set in server .env. Showing aesthetic demo tracks. Add your key to .env to fetch live data!',
      tracks: FALLBACK_TRACKS.slice(0, limit),
      totalTracks: FALLBACK_TRACKS.length,
    };
  }

  // Construct Last.fm endpoint URL
  const params = new URLSearchParams({
    method: 'user.getrecenttracks',
    user: username,
    api_key: apiKey,
    format: 'json',
    limit: String(limit),
  });

  const targetUrl = `${LASTFM_BASE_URL}?${params.toString()}`;
  console.log(`[OUTBOUND REQUEST] Backend proxy querying Last.fm API for user '${username}'...`);

  try {
    // 6-second timeout using native AbortSignal
    const response = await fetch(targetUrl, {
      signal: AbortSignal.timeout(6000),
      headers: {
        'User-Agent': 'MusicProjectProxy/1.0.0 (WebTech Course ESILV)',
      },
    });

    if (!response.ok) {
      const errorBody = await response.text();
      console.error(`[LAST.FM ERROR] Status ${response.status}: ${errorBody}`);
      throw new Error(`Last.fm API returned HTTP ${response.status}`);
    }

    const json = await response.json();

    // Check if Last.fm returned a logical error in JSON (e.g., error code 6 = User not found)
    if (json.error) {
      console.warn(`[LAST.FM LOGICAL ERROR] Code ${json.error}: ${json.message}`);
      throw new Error(`Last.fm: ${json.message || 'Unknown API error'}`);
    }

    const rawTracks = json.recenttracks?.track || [];
    const trackList = Array.isArray(rawTracks) ? rawTracks : [rawTracks];

    // Normalize tracks into our clean format
    const normalizedTracks = trackList.map((t, index) => {
      const isNowPlaying = t['@attr'] && t['@attr'].nowplaying === 'true';
      const rawImage = extractBestImage(t.image);
      const uts = t.date ? parseInt(t.date.uts, 10) : null;

      // Provide aesthetic fallback image if Last.fm cover is blank or missing
      const image = rawImage || FALLBACK_TRACKS[index % FALLBACK_TRACKS.length].image;

      return {
        id: `track-${index}-${t.name ? t.name.replace(/\s+/g, '-') : 'unknown'}`,
        title: t.name || 'Unknown Track',
        artist: t.artist?.['#text'] || t.artist?.name || 'Unknown Artist',
        album: t.album?.['#text'] || '',
        image: image,
        nowPlaying: Boolean(isNowPlaying),
        scrobbledAt: isNowPlaying ? 'Now Playing' : formatTimeAgo(uts),
        timestamp: uts ? uts * 1000 : Date.now(),
        url: t.url || `https://www.last.fm/search?q=${encodeURIComponent(t.name || '')}`,
      };
    });

    return {
      success: true,
      user: json.recenttracks?.['@attr']?.user || username,
      isFallback: false,
      totalTracks: parseInt(json.recenttracks?.['@attr']?.total || String(normalizedTracks.length), 10),
      tracks: normalizedTracks,
    };
  } catch (err) {
    console.error(`[EXCEPTION] Error fetching from Last.fm: ${err.message}`);

    // Graceful Fallback: Return fallback tracks with a friendly banner instead of crashing
    return {
      success: true,
      user: username,
      isFallback: true,
      warning: `Unable to reach Last.fm (${err.message}). Displaying fallback demo tracks.`,
      tracks: FALLBACK_TRACKS.slice(0, limit),
      totalTracks: FALLBACK_TRACKS.length,
    };
  }
}

module.exports = {
  fetchRecentTracks,
  FALLBACK_TRACKS,
};
