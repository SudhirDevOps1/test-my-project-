import type { Song, SearchProvider } from '@/types';

// ─── Cache ──────────────────────────────────────────────────────────────────
const CACHE_DURATION = 24 * 60 * 60 * 1000;

interface CachedResult {
    data: Song[];
    timestamp: number;
    provider: string;
}

function getCacheKey(query: string): string {
    return `music_search_v7_${query.toLowerCase().trim().replace(/\s+/g, '_')}`;
}

function getCachedResult(query: string): Song[] | null {
    try {
        const key = getCacheKey(query);
        const cached = localStorage.getItem(key);
        if (!cached) return null;
        const parsed: CachedResult = JSON.parse(cached);
        if (Date.now() - parsed.timestamp > CACHE_DURATION) {
            localStorage.removeItem(key);
            return null;
        }
        return parsed.data;
    } catch {
        return null;
    }
}

function cacheResult(query: string, songs: Song[], provider: string): void {
    try {
        localStorage.setItem(
            getCacheKey(query),
            JSON.stringify({ data: songs, timestamp: Date.now(), provider }),
        );
    } catch {
        // storage full
    }
}

// ─── Instance Health Tracker ────────────────────────────────────────────────
const HEALTH_KEY = 'music_instance_health';

interface HealthScore {
    piped: Record<string, number>;
    invidious: Record<string, number>;
}

function getHealth(): HealthScore {
    try {
        const raw = localStorage.getItem(HEALTH_KEY);
        if (raw) return JSON.parse(raw);
    } catch { }
    return { piped: {}, invidious: {} };
}

function saveHealth(h: HealthScore): void {
    try {
        localStorage.setItem(HEALTH_KEY, JSON.stringify(h));
    } catch { }
}

function recordSuccess(type: 'piped' | 'invidious', base: string): void {
    const h = getHealth();
    if (!h[type]) h[type] = {};
    h[type][base] = (h[type][base] || 0) + 1;
    saveHealth(h);
}

function recordFail(type: 'piped' | 'invidious', base: string): void {
    const h = getHealth();
    if (!h[type]) h[type] = {};
    h[type][base] = Math.max((h[type][base] || 0) - 1, -5);
    saveHealth(h);
}

function sortInstancesByHealth(instances: string[], type: 'piped' | 'invidious'): string[] {
    const h = getHealth();
    const scores = h[type] || {};
    return [...instances].sort((a, b) => (scores[b] || 0) - (scores[a] || 0));
}

// ─── Network ────────────────────────────────────────────────────────────────
async function fetchWithTimeout(url: string, timeout = 8000): Promise<Response> {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), timeout);
    try {
        const res = await fetch(url, {
            signal: ac.signal,
            headers: { Accept: 'application/json' },
        });
        clearTimeout(timer);
        return res;
    } catch (e) {
        clearTimeout(timer);
        throw e;
    }
}

// ─── Helpers ────────────────────────────────────────────────────────────────
function cleanTitle(raw: string): string {
    return (raw || 'Unknown')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .trim();
}

function extractVideoId(item: { id?: string; url?: string; videoId?: string }): string {
    let vid = item.videoId || item.id || '';
    if (!vid && item.url) {
        const m = item.url.match(/[?&]v=([^&]+)/) || item.url.match(/\/([a-zA-Z0-9_-]{11})$/);
        vid = m ? m[1] : '';
    }
    return vid.replace(/^\/watch\?v=/, '').replace(/^\//, '').trim();
}

// ─── Parallel Race Helper ───────────────────────────────────────────────────
function raceFirst<T>(
    tasks: Promise<T>[],
    isValid: (r: T) => boolean,
): Promise<T | null> {
    return new Promise((resolve) => {
        if (tasks.length === 0) { resolve(null); return; }
        let done = false;
        let pending = tasks.length;

        for (const task of tasks) {
            task
                .then((result) => {
                    if (!done) {
                        if (isValid(result)) {
                            done = true;
                            resolve(result);
                        } else {
                            pending--;
                            if (pending === 0) resolve(null);
                        }
                    }
                })
                .catch(() => {
                    if (!done) {
                        pending--;
                        if (pending === 0) resolve(null);
                    }
                });
        }
    });
}

// ─── Piped ──────────────────────────────────────────────────────────────────
const PIPED_INSTANCES = [
    'https://pipedapi.adminforge.de',
    'https://pipedapi.kavin.rocks',
    'https://pipedapi.r4fo.com',
    'https://api.piped.yt',
    'https://pipedapi.astre.me',
    'https://pipedapi.projectsegfau.lt',
    'https://piped-api.garudalinux.org',
    'https://pipedapi.mosesm.org',
    'https://pipedapi.rivo.world',
];

async function tryPiped(base: string, encoded: string): Promise<Song[]> {
    try {
        const res = await fetchWithTimeout(`${base}/search?q=${encoded}&filter=videos`);
        if (!res.ok) return [];
        const data = await res.json();
        if (!Array.isArray(data?.items) || data.items.length === 0) return [];

        const songs: Song[] = data.items
            .filter((i: any) => i.url || i.id || i.videoId)
            .slice(0, 20)
            .map((i: any): Song => {
                const videoId = extractVideoId(i);
                return {
                    videoId,
                    title: cleanTitle(i.title),
                    artist: cleanTitle(i.uploaderName || i.uploader || 'Unknown Artist'),
                    thumbnail: i.thumbnail || `https://i.ytimg.com/vi/${videoId}/mqdefault.jpg`,
                    duration: typeof i.duration === 'number' ? i.duration : (typeof i.duration === 'string' ? parseInt(i.duration) : 0),
                };
            })
            .filter((s: Song) => s.videoId && s.videoId.length >= 5);

        if (songs.length > 0) {
            recordSuccess('piped', base);
        }
        return songs;
    } catch {
        recordFail('piped', base);
        return [];
    }
}

async function searchPiped(query: string): Promise<Song[]> {
    const encoded = encodeURIComponent(query);
    const sorted = sortInstancesByHealth(PIPED_INSTANCES, 'piped');

    // Batch 1: race top 3
    const batch1 = await raceFirst(
        sorted.slice(0, 3).map((b) => tryPiped(b, encoded)),
        (r): r is Song[] => Array.isArray(r) && r.length > 0,
    );
    if (batch1) return batch1;

    // Batch 2: race next 3
    const batch2 = await raceFirst(
        sorted.slice(3, 6).map((b) => tryPiped(b, encoded)),
        (r): r is Song[] => Array.isArray(r) && r.length > 0,
    );
    if (batch2) return batch2;

    // Batch 3: sequential remaining
    for (const base of sorted.slice(6)) {
        const songs = await tryPiped(base, encoded);
        if (songs.length > 0) return songs;
    }

    return [];
}

// ─── Invidious ──────────────────────────────────────────────────────────────
const INVIDIOUS_INSTANCES = [
    'https://inv.nadeko.net',
    'https://invidious.nerdvpn.de',
    'https://iv.melmac.space',
    'https://iv.ggtyler.dev',
    'https://invidious.privacyredirect.com',
    'https://inv.tux.pizza',
    'https://yt.artemislena.eu',
    'https://invidious.perennialte.ch',
    'https://invidious.protokoll-11.de',
];

async function tryInvidious(base: string, encoded: string): Promise<Song[]> {
    try {
        const res = await fetchWithTimeout(
            `${base}/api/v1/search?q=${encoded}&type=video`,
        );
        if (!res.ok) return [];
        const data = await res.json();
        if (!Array.isArray(data) || data.length === 0) return [];

        const songs: Song[] = data
            .filter((i: any) => i.videoId && i.title)
            .slice(0, 20)
            .map((i: any): Song => {
                const thumb =
                    i.videoThumbnails?.find((t: any) => t.quality === 'medium')?.url ||
                    i.videoThumbnails?.[0]?.url ||
                    `https://i.ytimg.com/vi/${i.videoId}/mqdefault.jpg`;
                return {
                    videoId: i.videoId,
                    title: cleanTitle(i.title),
                    artist: cleanTitle(i.author || 'Unknown Artist'),
                    thumbnail: thumb.startsWith('//') ? `https:${thumb}` : thumb,
                    duration: typeof i.lengthSeconds === 'number' ? i.lengthSeconds : 0,
                };
            });

        if (songs.length > 0) {
            recordSuccess('invidious', base);
        }
        return songs;
    } catch {
        recordFail('invidious', base);
        return [];
    }
}

async function searchInvidious(query: string): Promise<Song[]> {
    const encoded = encodeURIComponent(query);
    const sorted = sortInstancesByHealth(INVIDIOUS_INSTANCES, 'invidious');

    // Batch 1: race top 3
    const batch1 = await raceFirst(
        sorted.slice(0, 3).map((b) => tryInvidious(b, encoded)),
        (r): r is Song[] => Array.isArray(r) && r.length > 0,
    );
    if (batch1) return batch1;

    // Batch 2: race next 3
    const batch2 = await raceFirst(
        sorted.slice(3, 6).map((b) => tryInvidious(b, encoded)),
        (r): r is Song[] => Array.isArray(r) && r.length > 0,
    );
    if (batch2) return batch2;

    // Batch 3: sequential remaining
    for (const base of sorted.slice(6)) {
        const songs = await tryInvidious(base, encoded);
        if (songs.length > 0) return songs;
    }

    return [];
}

// ─── YouTube Data API v3 ────────────────────────────────────────────────────
async function searchYouTube(query: string, apiKey: string): Promise<Song[]> {
    if (!apiKey) return [];
    try {
        const url = new URL('https://www.googleapis.com/youtube/v3/search');
        url.searchParams.set('part', 'snippet');
        url.searchParams.set('q', query);
        url.searchParams.set('type', 'video');
        url.searchParams.set('videoCategoryId', '10');
        url.searchParams.set('maxResults', '20');
        url.searchParams.set('key', apiKey);

        const res = await fetchWithTimeout(url.toString(), 8000);
        if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            throw new Error(err?.error?.message || `HTTP ${res.status}`);
        }
        const data = await res.json();
        if (!Array.isArray(data?.items)) return [];

        return data.items
            .filter((i: any) => i.id?.videoId)
            .map((i: any): Song => ({
                videoId: i.id.videoId,
                title: cleanTitle(i.snippet?.title),
                artist: cleanTitle(i.snippet?.channelTitle || 'Unknown Artist'),
                thumbnail:
                    i.snippet?.thumbnails?.high?.url ||
                    i.snippet?.thumbnails?.medium?.url ||
                    `https://i.ytimg.com/vi/${i.id.videoId}/mqdefault.jpg`,
                duration: 0,
            }));
    } catch (e) {
        console.error('[YouTube] search error:', e);
        return [];
    }
}

// ─── Streams ────────────────────────────────────────────────────────────────
export async function getStreamUrl(videoId: string): Promise<{ audioUrl: string; videoUrl?: string }> {
    const sorted = sortInstancesByHealth(PIPED_INSTANCES, 'piped');
    for (const base of sorted) {
        try {
            const res = await fetchWithTimeout(`${base}/streams/${videoId}`, 8000);
            if (!res.ok) continue;
            const data = await res.json();

            const audioStream = data.audioStreams?.sort((a: any, b: any) => (b.bitrate || 0) - (a.bitrate || 0))[0];
            const videoStream = data.videoStreams?.sort((a: any, b: any) => (b.bitrate || 0) - (a.bitrate || 0))[0];

            const audioUrl = audioStream?.url || data.hls || '';
            if (audioUrl || videoStream?.url) {
                recordSuccess('piped', base);
                return { audioUrl, videoUrl: videoStream?.url || data.hls };
            }
        } catch {
            recordFail('piped', base);
        }
    }
    throw new Error('All stream instances failed');
}

// ─── Main search export ────────────────────────────────────────────────────
export async function searchSongs(
    query: string,
    provider: SearchProvider = 'piped',
    apiKey = '',
): Promise<{ songs: Song[]; provider: SearchProvider | 'cache' | 'failed' | 'none' }> {
    if (!query?.trim()) return { songs: [], provider: 'none' };

    const q = query.trim();

    // Cache hit
    const cached = getCachedResult(q);
    if (cached?.length) {
        return { songs: cached, provider: 'cache' };
    }

    // Build provider order
    const order: { name: SearchProvider; fn: () => Promise<Song[]> }[] = [];

    if (provider === 'youtube' && apiKey) {
        order.push({ name: 'youtube', fn: () => searchYouTube(q, apiKey) });
        order.push({ name: 'piped', fn: () => searchPiped(q) });
        order.push({ name: 'invidious', fn: () => searchInvidious(q) });
    } else if (provider === 'invidious') {
        order.push({ name: 'invidious', fn: () => searchInvidious(q) });
        order.push({ name: 'piped', fn: () => searchPiped(q) });
    } else {
        order.push({ name: 'piped', fn: () => searchPiped(q) });
        order.push({ name: 'invidious', fn: () => searchInvidious(q) });
    }

    if (apiKey && provider !== 'youtube') {
        order.push({ name: 'youtube', fn: () => searchYouTube(q, apiKey) });
    }

    for (const p of order) {
        try {
            const songs = await p.fn();
            if (songs.length > 0) {
                cacheResult(q, songs, p.name);
                return { songs, provider: p.name };
            }
        } catch (e) {
            console.error(`[${p.name}] error:`, e);
        }
    }

    // No fallback - return empty if all APIs fail
    return { songs: [], provider: 'failed' };
}

export function clearSearchCache(): void {
    const keys = Object.keys(localStorage);
    for (let i = 0; i < keys.length; i++) {
        if (keys[i].startsWith('music_search_') || keys[i] === 'music_instance_health') {
            localStorage.removeItem(keys[i]);
        }
    }
}

// ─── YouTube API Key Validator ──────────────────────────────────────────────
export type YouTubeKeyStatus = 'unknown' | 'checking' | 'connected' | 'invalid' | 'quota' | 'error';

export async function validateYouTubeKey(apiKey: string): Promise<{ status: YouTubeKeyStatus; message: string }> {
    if (!apiKey?.trim()) {
        return { status: 'unknown', message: 'No API key set' };
    }
    try {
        const url = new URL('https://www.googleapis.com/youtube/v3/search');
        url.searchParams.set('part', 'snippet');
        url.searchParams.set('q', 'test');
        url.searchParams.set('type', 'video');
        url.searchParams.set('maxResults', '1');
        url.searchParams.set('key', apiKey.trim());

        const ac = new AbortController();
        const timer = setTimeout(() => ac.abort(), 8000);
        const res = await fetch(url.toString(), { signal: ac.signal });
        clearTimeout(timer);

        if (res.ok) {
            const data = await res.json();
            if (Array.isArray(data?.items)) {
                return { status: 'connected', message: 'Connected · API key is valid' };
            }
            return { status: 'error', message: 'Unexpected response from YouTube' };
        }

        const errorBody = await res.json().catch(() => ({}));
        const reason = errorBody?.error?.errors?.[0]?.reason || '';
        const errMsg = errorBody?.error?.message || '';

        if (res.status === 400 || reason === 'badRequest' || reason === 'keyInvalid') {
            return { status: 'invalid', message: 'Invalid API key' };
        }
        if (res.status === 403) {
            if (reason === 'quotaExceeded' || /quota/i.test(errMsg)) {
                return { status: 'quota', message: 'Quota exceeded for today' };
            }
            if (reason === 'forbidden' || reason === 'ipRefererBlocked' || reason === 'accessNotConfigured') {
                return { status: 'invalid', message: errMsg || 'API key forbidden / not configured' };
            }
            return { status: 'invalid', message: errMsg || 'Forbidden' };
        }
        return { status: 'error', message: errMsg || `HTTP ${res.status}` };
    } catch (e: any) {
        if (e?.name === 'AbortError') {
            return { status: 'error', message: 'Network timeout while checking key' };
        }
        return { status: 'error', message: 'Could not reach YouTube' };
    }
}
