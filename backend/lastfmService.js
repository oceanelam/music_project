/**
 * ============================================================================
 * LAST.FM PROXY SERVICE (backend/lastfmService.js)
 * ============================================================================
 * Rules:
 * 1. Request URL: https://ws.audioscrobbler.com/2.0/ with:
 *    - method=user.getrecenttracks
 *    - user=(trimmed process.env.LASTFM_USERNAME)
 *    - api_key=(trimmed process.env.LASTFM_API_KEY)
 *    - limit=15
 *    - format=json
 * 2. Security: Logs sanitized URL with api_key=***MASKED***
 * 3. Exact Error Logging: Prints HTTP status and response body to console
 * 4. Zero Fake Tracks: If Last.fm is unreachable or fails, returns clean error
 *    state without injecting fake mock songs.
 */

const LASTFM_BASE_URL = 'https://ws.audioscrobbler.com/2.0/';

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
 * Fetch recent tracks from Last.fm API
 * @param {string} [username] - Optional override, defaults to process.env.LASTFM_USERNAME
 * @param {number} [limit=15] - Number of tracks to retrieve (default 15)
 */
async function fetchRecentTracks(username, limit = 15) {
  const apiKey = (process.env.LASTFM_API_KEY || '').trim();
  const targetUser = (username || process.env.LASTFM_USERNAME || '').trim();

  // Validate presence of credentials
  if (!targetUser || targetUser === 'YOUR_LASTFM_USERNAME') {
    const msg = 'LASTFM_USERNAME is missing or unconfigured in .env';
    console.error(`[CONFIG ERROR] ${msg}`);
    return {
      success: false,
      error: true,
      user: null,
      message: msg,
      tracks: [],
    };
  }

  if (!apiKey || apiKey === 'YOUR_LASTFM_API_KEY') {
    const msg = 'LASTFM_API_KEY is missing or unconfigured in .env';
    console.error(`[CONFIG ERROR] ${msg}`);
    return {
      success: false,
      error: true,
      user: targetUser,
      message: msg,
      tracks: [],
    };
  }

  // Construct query parameters
  const params = new URLSearchParams({
    method: 'user.getrecenttracks',
    user: targetUser,
    api_key: apiKey,
    limit: String(limit),
    format: 'json',
  });

  const fullUrl = `${LASTFM_BASE_URL}?${params.toString()}`;

  // Rule 3: Log sanitized request URL with api_key masked
  const sanitizedUrl = `${LASTFM_BASE_URL}?method=user.getrecenttracks&user=${encodeURIComponent(targetUser)}&api_key=***MASKED***&limit=${limit}&format=json`;
  console.log(`[LAST.FM REQUEST] Querying: ${sanitizedUrl}`);

  try {
    const response = await fetch(fullUrl, {
      signal: AbortSignal.timeout(6000),
      headers: {
        'User-Agent': 'EditorialMusicProxy/2.1.0',
      },
    });

    const responseText = await response.text();

    // Rule 3: If HTTP error, log exact error response body
    if (!response.ok) {
      console.error(`[LAST.FM ERROR] HTTP ${response.status} from ${sanitizedUrl}`);
      console.error(`[LAST.FM ERROR BODY] ${responseText}`);
      return {
        success: false,
        error: true,
        statusCode: response.status,
        user: targetUser,
        message: `Last.fm API returned HTTP ${response.status} for user '${targetUser}'. Response: ${responseText}`,
        tracks: [],
      };
    }

    let json;
    try {
      json = JSON.parse(responseText);
    } catch (parseErr) {
      console.error('[LAST.FM PARSE ERROR] Non-JSON response body:', responseText);
      return {
        success: false,
        error: true,
        user: targetUser,
        message: 'Invalid JSON received from Last.fm API.',
        tracks: [],
      };
    }

    // Check for Last.fm application-level logical error
    if (json.error) {
      console.error(`[LAST.FM LOGICAL ERROR] Code ${json.error}: ${json.message}`);
      return {
        success: false,
        error: true,
        errorCode: json.error,
        user: targetUser,
        message: `Last.fm error (${json.error}): ${json.message}`,
        tracks: [],
      };
    }

    const rawTracks = json.recenttracks?.track || [];
    const trackList = Array.isArray(rawTracks) ? rawTracks : (rawTracks ? [rawTracks] : []);

    const normalizedTracks = trackList.map((t, index) => {
      const isNowPlaying = t['@attr'] && t['@attr'].nowplaying === 'true';
      const image = extractBestImage(t.image) || '';

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

    console.log(`[LAST.FM SUCCESS] Retrieved ${normalizedTracks.length} tracks for user '${targetUser}'`);

    return {
      success: true,
      error: false,
      user: json.recenttracks?.['@attr']?.user || targetUser,
      totalTracks: parseInt(json.recenttracks?.['@attr']?.total || String(normalizedTracks.length), 10),
      tracks: normalizedTracks,
    };
  } catch (err) {
    console.error(`[NETWORK/TIMEOUT ERROR] Failed to reach Last.fm: ${err.message}`);
    // Rule 4: Clean error state without fake mock tracks
    return {
      success: false,
      error: true,
      user: targetUser,
      message: `Last.fm is unreachable (${err.message}). Please check your internet connection or server proxy.`,
      tracks: [],
    };
  }
}

module.exports = {
  fetchRecentTracks,
};
