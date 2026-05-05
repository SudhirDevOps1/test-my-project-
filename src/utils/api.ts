// import type { Song, SearchProvider } from '@/types';

// // ─── Cache ──────────────────────────────────────────────────────────────────
// const CACHE_DURATION = 24 * 60 * 60 * 1000; // 24 hours

// interface CachedResult {
//     data: Song[];
//     timestamp: number;
//     provider: string;
// }

// function getCacheKey(query: string): string {
//     return `music_search_${query.toLowerCase().trim().replace(/\s+/g, '_')}`;
// }

// function getCachedResult(query: string): Song[] | null {
//     try {
//         const key = getCacheKey(query);
//         const cached = localStorage.getItem(key);
//         if (!cached) return null;
//         const parsed: CachedResult = JSON.parse(cached);
//         if (Date.now() - parsed.timestamp > CACHE_DURATION) {
//             localStorage.removeItem(key);
//             return null;
//         }
//         return parsed.data;
//     } catch {
//         return null;
//     }
// }

// function cacheResult(query: string, songs: Song[], provider: string): void {
//     try {
//         localStorage.setItem(
//             getCacheKey(query),
//             JSON.stringify({ data: songs, timestamp: Date.now(), provider }),
//         );
//     } catch {
//         // storage full
//     }
// }

// // ─── Network ────────────────────────────────────────────────────────────────
// async function fetchWithTimeout(url: string, timeout = 10000): Promise<Response> {
//     const controller = new AbortController();
//     const timeoutId = setTimeout(() => controller.abort(), timeout);
//     try {
//         const response = await fetch(url, {
//             signal: controller.signal,
//             headers: { 'Accept': 'application/json' },
//         });
//         clearTimeout(timeoutId);
//         return response;
//     } catch (error) {
//         clearTimeout(timeoutId);
//         throw error;
//     }
// }

// // ─── Helpers ────────────────────────────────────────────────────────────────
// function cleanTitle(raw: string): string {
//     return (raw || 'Unknown')
//         .replace(/&amp;/g, '&')
//         .replace(/&lt;/g, '<')
//         .replace(/&gt;/g, '>')
//         .replace(/&quot;/g, '"')
//         .replace(/&#39;/g, "'")
//         .trim();
// }

// function extractVideoId(item: { id?: string; url?: string; videoId?: string }): string {
//     let vid = item.videoId || item.id || '';
//     if (!vid && item.url) {
//         const match = item.url.match(/[?&]v=([^&]+)/) || item.url.match(/\/([a-zA-Z0-9_-]{11})$/);
//         vid = match ? match[1] : '';
//     }
//     return vid.replace(/^\/watch\?v=/, '').trim();
// }

// // ─── Piped ──────────────────────────────────────────────────────────────────
// const PIPED_INSTANCES = [
//     'https://pipedapi.kavin.rocks',        // Official - US/IN/NL/CA/GB/FR CDN
//     'https://pipedapi.syncpundit.io',      // US/IN/GB/JP CDN
//     'https://pipedapi.tokhmi.xyz',         // US CDN
//     'https://pipedapi.moomoo.me',          // GB CDN
//     'https://piped-api.garudalinux.org',   // FI CDN
//     'https://api-piped.mha.fi',            // FI
//     'https://pipedapi.rivo.lol',           // CL
//     'https://pipedapi.leptons.xyz',        // AT
//     'https://piped-api.lunar.icu',         // DE
//     'https://pipedapi.colinslegacy.com',   // US
//     'https://pipedapi.r4fo.com',           // DE
//     'https://pipedapi.adminforge.de',      // DE
//     'https://yapi.vyper.me',               // CL
//     'https://api.looleh.xyz',              // NL
//     'https://piped-api.cfe.re',            // PL
//     'https://pipedapi.projectsegfau.lt',   // US
//     'https://api.piped.yt',               // fallback
// ];

// function parsePipedItem(item: any): Song | null {
//     const videoId = extractVideoId(item);
//     if (!videoId || videoId.length < 4) return null;
//     return {
//         videoId,
//         title: cleanTitle(item.title || 'Unknown'),
//         artist: cleanTitle(item.uploaderName || item.uploader || 'Unknown Artist'),
//         thumbnail: item.thumbnail || `https://i.ytimg.com/vi/${videoId}/mqdefault.jpg`,
//         duration: typeof item.duration === 'number' ? item.duration : 0,
//     };
// }

// async function tryPipedInstance(instance: string, query: string): Promise<Song[]> {
//     const url = `${instance}/search?q=${encodeURIComponent(query)}&filter=videos`;
//     const response = await fetchWithTimeout(url, 8000);
//     if (!response.ok) return [];
//     const data = await response.json();
//     if (!data.items || !Array.isArray(data.items) || data.items.length === 0) return [];

//     const songs: Song[] = data.items
//         .filter((item: any) => item.url || item.id)
//         .slice(0, 20)
//         .map((item: any) => parsePipedItem(item))
//         .filter((s: Song | null): s is Song => s !== null);

//     return songs;
// }

// async function searchPiped(query: string): Promise<Song[]> {
//     // Race first 3 instances in parallel
//     const top3 = PIPED_INSTANCES.slice(0, 3);
//     const raceResult = await Promise.race([
//         ...top3.map(inst =>
//             tryPipedInstance(inst, query).then(songs => (songs.length > 0 ? songs : null)).catch(() => null)
//         ),
//         new Promise<null>(resolve => setTimeout(() => resolve(null), 4000)),
//     ]);
//     if (raceResult) return raceResult;

//     // Sequential fallback for remaining instances (excluding the first 3)
//     for (const instance of PIPED_INSTANCES.slice(3)) {
//         try {
//             const songs = await tryPipedInstance(instance, query);
//             if (songs.length > 0) return songs;
//         } catch {
//             // ignore
//         }
//     }
//     return [];
// }

// // ─── Invidious ──────────────────────────────────────────────────────────────
// const INVIDIOUS_INSTANCES = [
//     'https://iv.melmac.space',              // DE - fast
//     'https://inv.nadeko.net',               // CL - multiple backends (inv1-inv9)
//     'https://inv.tux.pizza',               // US
//     'https://yt.artemislena.eu',            // DE - official list
//     'https://invidious.flokinet.to',        // RO - official list
//     'https://invidious.privacydev.net',     // FR - official list
//     'https://iv.datura.network',            // FI - official list
//     'https://invidious.fdn.fr',             // FR - official list
//     'https://invidious.protokolla.fi',      // FI - official list
//     'https://invidious.private.coffee',     // AT - official list
//     'https://yt.drgnz.club',               // CZ - official list
//     'https://invidious.perennialte.ch',     // AU - official list
//     'https://invidious.drgns.space',        // US - official list
//     'https://inv.us.projectsegfau.lt',      // US - official list
//     'https://invidious.jing.rocks',         // JP - official list
//     'https://yewtu.be',                     // DE - oldest instance
//     'https://invidious.nerdvpn.de',
//     'https://invidious.protokoll-11.de',
//     'https://invidious.slipfox.xyz',
// ];

// async function tryInvidiousInstance(instance: string, query: string): Promise<Song[]> {
//     const url = `${instance}/api/v1/search?q=${encodeURIComponent(query)}&type=video`;
//     const response = await fetchWithTimeout(url, 8000);
//     if (!response.ok) return [];
//     const data = await response.json();
//     if (!Array.isArray(data) || data.length === 0) return [];

//     const songs: Song[] = data
//         .filter((item: any) => item.videoId && item.title)
//         .slice(0, 20)
//         .map((item: any): Song => {
//             const thumb =
//                 item.videoThumbnails?.find((t: any) => t.quality === 'medium')?.url ||
//                 item.videoThumbnails?.[0]?.url ||
//                 `https://i.ytimg.com/vi/${item.videoId}/mqdefault.jpg`;
//             return {
//                 videoId: item.videoId,
//                 title: cleanTitle(item.title),
//                 artist: cleanTitle(item.author || 'Unknown Artist'),
//                 thumbnail: thumb.startsWith('//') ? `https:${thumb}` : thumb,
//                 duration: typeof item.lengthSeconds === 'number' ? item.lengthSeconds : 0,
//             };
//         });

//     return songs;
// }

// async function searchInvidious(query: string): Promise<Song[]> {
//     // Race first 3 instances in parallel
//     const top3 = INVIDIOUS_INSTANCES.slice(0, 3);
//     const raceResult = await Promise.race([
//         ...top3.map(inst =>
//             tryInvidiousInstance(inst, query).then(songs => (songs.length > 0 ? songs : null)).catch(() => null)
//         ),
//         new Promise<null>(resolve => setTimeout(() => resolve(null), 4000)),
//     ]);
//     if (raceResult) return raceResult;

//     // Sequential fallback for remaining instances (excluding the first 3)
//     for (const instance of INVIDIOUS_INSTANCES.slice(3)) {
//         try {
//             const songs = await tryInvidiousInstance(instance, query);
//             if (songs.length > 0) return songs;
//         } catch {
//             // ignore
//         }
//     }
//     return [];
// }

// // ─── YouTube Data API v3 ────────────────────────────────────────────────────
// async function searchYouTube(query: string, apiKey: string): Promise<Song[]> {
//     if (!apiKey) return [];
//     try {
//         const url = new URL('https://www.googleapis.com/youtube/v3/search');
//         url.searchParams.set('part', 'snippet');
//         url.searchParams.set('q', query);
//         url.searchParams.set('type', 'video');
//         url.searchParams.set('maxResults', '20');
//         url.searchParams.set('key', apiKey);

//         const res = await fetchWithTimeout(url.toString(), 8000);
//         if (!res.ok) {
//             const err = await res.json().catch(() => ({}));
//             throw new Error(err?.error?.message || `HTTP ${res.status}`);
//         }
//         const data = await res.json();
//         if (!Array.isArray(data?.items)) return [];

//         return data.items
//             .filter((i: any) => i.id?.videoId)
//             .map((i: any): Song => ({
//                 videoId: i.id.videoId,
//                 title: cleanTitle(i.snippet?.title),
//                 artist: cleanTitle(i.snippet?.channelTitle || 'Unknown Artist'),
//                 thumbnail:
//                     i.snippet?.thumbnails?.high?.url ||
//                     i.snippet?.thumbnails?.medium?.url ||
//                     `https://i.ytimg.com/vi/${i.id.videoId}/mqdefault.jpg`,
//                 duration: 0,
//             }));
//     } catch (e) {
//         console.error('[YouTube] search error:', e);
//         return [];
//     }
// }

// // ─── Streams ────────────────────────────────────────────────────────────────
// export async function getStreamUrl(videoId: string): Promise<{ audioUrl: string; videoUrl?: string }> {
//     for (const instance of PIPED_INSTANCES) {
//         try {
//             const res = await fetchWithTimeout(`${instance}/streams/${videoId}`, 8000);
//             if (!res.ok) continue;
//             const data = await res.json();

//             const audioStream = data.audioStreams?.sort((a: any, b: any) => (b.bitrate || 0) - (a.bitrate || 0))[0];
//             const videoStream = data.videoStreams?.sort((a: any, b: any) => (b.bitrate || 0) - (a.bitrate || 0))[0];

//             const audioUrl = audioStream?.url || data.hls || '';
//             if (audioUrl || videoStream?.url) {
//                 return { audioUrl, videoUrl: videoStream?.url || data.hls };
//             }
//         } catch {
//             // try next instance
//         }
//     }
//     throw new Error('All stream instances failed');
// }

// // ─── Main search export ────────────────────────────────────────────────────
// export async function searchSongs(
//     query: string,
//     preferredProvider: SearchProvider = 'invidious',
//     apiKey = '',
// ): Promise<{ songs: Song[]; provider: string }> {
//     if (!query?.trim()) return { songs: [], provider: 'none' };

//     const q = query.trim();

//     // Cache hit
//     const cached = getCachedResult(q);
//     if (cached?.length) {
//         return { songs: cached, provider: 'cache' };
//     }

//     let songs: Song[] = [];
//     let usedProvider: string = preferredProvider;

//     // Try preferred provider first, then fallbacks
//     const providers: Array<{ name: string; fn: () => Promise<Song[]> }> = [];

//     if (preferredProvider === 'piped') {
//         providers.push({ name: 'piped', fn: () => searchPiped(q) });
//         providers.push({ name: 'invidious', fn: () => searchInvidious(q) });
//     } else if (preferredProvider === 'invidious') {
//         providers.push({ name: 'invidious', fn: () => searchInvidious(q) });
//         providers.push({ name: 'piped', fn: () => searchPiped(q) });
//     } else if (preferredProvider === 'youtube' && apiKey) {
//         providers.push({ name: 'youtube', fn: () => searchYouTube(q, apiKey) });
//         providers.push({ name: 'invidious', fn: () => searchInvidious(q) });
//         providers.push({ name: 'piped', fn: () => searchPiped(q) });
//     } else {
//         // Default: Invidious first (works on PC & mobile)
//         providers.push({ name: 'invidious', fn: () => searchInvidious(q) });
//         providers.push({ name: 'piped', fn: () => searchPiped(q) });
//     }

//     // Always append YouTube if key available and not already first
//     if (apiKey && preferredProvider !== 'youtube') {
//         providers.push({ name: 'youtube', fn: () => searchYouTube(q, apiKey) });
//     }

//     for (const provider of providers) {
//         try {
//             songs = await provider.fn();
//             if (songs.length > 0) {
//                 usedProvider = provider.name;
//                 cacheResult(q, songs, usedProvider);
//                 return { songs, provider: usedProvider };
//             }
//         } catch (error) {
//             console.error(`${provider.name} failed:`, error);
//             continue;
//         }
//     }

//     console.warn('No results found for:', q);
//     return { songs: [], provider: 'failed' };
// }

// export function clearSearchCache(): void {
//     Object.keys(localStorage)
//         .filter(k => k.startsWith('music_search_'))
//         .forEach(k => localStorage.removeItem(k));
// }

// // ─── YouTube API Key Validator ──────────────────────────────────────────────
// export type YouTubeKeyStatus = 'unknown' | 'checking' | 'connected' | 'invalid' | 'quota' | 'error';

// export async function validateYouTubeKey(apiKey: string): Promise<{ status: YouTubeKeyStatus; message: string }> {
//     if (!apiKey?.trim()) {
//         return { status: 'unknown', message: 'No API key set' };
//     }
//     try {
//         const url = new URL('https://www.googleapis.com/youtube/v3/search');
//         url.searchParams.set('part', 'snippet');
//         url.searchParams.set('q', 'test');
//         url.searchParams.set('type', 'video');
//         url.searchParams.set('maxResults', '1');
//         url.searchParams.set('key', apiKey.trim());

//         const ac = new AbortController();
//         const timer = setTimeout(() => ac.abort(), 8000);
//         const res = await fetch(url.toString(), { signal: ac.signal });
//         clearTimeout(timer);

//         if (res.ok) {
//             const data = await res.json();
//             if (Array.isArray(data?.items)) {
//                 return { status: 'connected', message: 'Connected · API key is valid' };
//             }
//             return { status: 'error', message: 'Unexpected response from YouTube' };
//         }

//         const errorBody = await res.json().catch(() => ({}));
//         const reason = errorBody?.error?.errors?.[0]?.reason || '';
//         const errMsg = errorBody?.error?.message || '';

//         if (res.status === 400 || reason === 'badRequest' || reason === 'keyInvalid') {
//             return { status: 'invalid', message: 'Invalid API key' };
//         }
//         if (res.status === 403) {
//             if (reason === 'quotaExceeded' || /quota/i.test(errMsg)) {
//                 return { status: 'quota', message: 'Quota exceeded for today' };
//             }
//             if (reason === 'forbidden' || reason === 'ipRefererBlocked' || reason === 'accessNotConfigured') {
//                 return { status: 'invalid', message: errMsg || 'API key forbidden / not configured' };
//             }
//             return { status: 'invalid', message: errMsg || 'Forbidden' };
//         }
//         return { status: 'error', message: errMsg || `HTTP ${res.status}` };
//     } catch (e: any) {
//         if (e?.name === 'AbortError') {
//             return { status: 'error', message: 'Network timeout while checking key' };
//         }
//         return { status: 'error', message: 'Could not reach YouTube' };
//     }
// }
import type { Song, SearchProvider } from '@/types';

// ─── Cache ──────────────────────────────────────────────────────────────────
const CACHE_DURATION = 24 * 60 * 60 * 1000; // 24 hours

interface CachedResult {
    data: Song[];
    timestamp: number;
    provider: string;
}

function getCacheKey(query: string): string {
    return `music_search_${query.toLowerCase().trim().replace(/\s+/g, '_')}`;
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
async function fetchWithTimeout(url: string, timeout = 10000): Promise<Response> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);
    try {
        const response = await fetch(url, { 
            signal: controller.signal,
            headers: { 'Accept': 'application/json' },
        });
        clearTimeout(timeoutId);
        return response;
    } catch (error) {
        clearTimeout(timeoutId);
        throw error;
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
        const match = item.url.match(/[?&]v=([^&]+)/) || item.url.match(/\/([a-zA-Z0-9_-]{11})$/);
        vid = match ? match[1] : '';
    }
    return vid.replace(/^\/watch\?v=/, '').trim();
}

// ─── Piped ──────────────────────────────────────────────────────────────────
// Updated 2026 - CDN-backed instances first for speed
const PIPED_INSTANCES = [
    'https://pipedapi.kavin.rocks',        // Official - US/IN/NL/CA/GB/FR CDN
    'https://pipedapi.syncpundit.io',      // US/IN/GB/JP CDN
    'https://pipedapi.tokhmi.xyz',         // US CDN
    'https://pipedapi.moomoo.me',          // GB CDN
    'https://piped-api.garudalinux.org',   // FI CDN
    'https://api-piped.mha.fi',            // FI
    'https://pipedapi.rivo.lol',           // CL
    'https://pipedapi.leptons.xyz',        // AT
    'https://piped-api.lunar.icu',         // DE
    'https://pipedapi.colinslegacy.com',   // US
    'https://pipedapi.r4fo.com',           // DE
    'https://pipedapi.adminforge.de',      // DE
    'https://yapi.vyper.me',               // CL
    'https://api.looleh.xyz',              // NL
    'https://piped-api.cfe.re',            // PL
    'https://pipedapi.projectsegfau.lt',   // US
    'https://api.piped.yt',               // fallback
];

function parsePipedItem(item: any): Song | null {
    const videoId = extractVideoId(item);
    if (!videoId || videoId.length < 4) return null;
    return {
        videoId,
        title: cleanTitle(item.title || 'Unknown'),
        artist: cleanTitle(item.uploaderName || item.uploader || 'Unknown Artist'),
        thumbnail: item.thumbnail || `https://i.ytimg.com/vi/${videoId}/mqdefault.jpg`,
        duration: typeof item.duration === 'number' ? item.duration : 0,
    };
}

async function tryPipedInstance(instance: string, query: string): Promise<Song[]> {
    const url = `${instance}/search?q=${encodeURIComponent(query)}&filter=videos`;
    const response = await fetchWithTimeout(url, 8000);
    if (!response.ok) {
        recordFail('piped', instance);
        return [];
    }
    const data = await response.json();
    if (!data.items || !Array.isArray(data.items) || data.items.length === 0) return [];

    const songs: Song[] = data.items
        .filter((item: any) => item.url || item.id)
        .slice(0, 20)
        .map((item: any) => parsePipedItem(item))
        .filter((s: Song | null): s is Song => s !== null);

    if (songs.length > 0) recordSuccess('piped', instance);
    return songs;
}

async function searchPiped(query: string): Promise<Song[]> {
    const sorted = sortInstancesByHealth(PIPED_INSTANCES, 'piped');

    // Race top 3 in parallel for speed
    const top3 = sorted.slice(0, 3);
    const raceResult = await Promise.race([
        ...top3.map(inst =>
            tryPipedInstance(inst, query).then(songs => songs.length > 0 ? songs : null).catch(() => null)
        ),
        new Promise<null>(resolve => setTimeout(() => resolve(null), 4000)),
    ]);
    if (raceResult) return raceResult;

    // Sequential fallback for remaining instances
    for (const instance of sorted.slice(3)) {
        try {
            const songs = await tryPipedInstance(instance, query);
            if (songs.length > 0) return songs;
        } catch {
            recordFail('piped', instance);
        }
    }
    return [];
}

// ─── Invidious ──────────────────────────────────────────────────────────────
// Updated 2026 - Official Invidious project trusted list first
const INVIDIOUS_INSTANCES = [
    'https://iv.melmac.space',              // DE - fast
    'https://inv.nadeko.net',               // CL - multiple backends (inv1-inv9)
    'https://inv.tux.pizza',               // US
    'https://yt.artemislena.eu',            // DE - official list
    'https://invidious.flokinet.to',        // RO - official list
    'https://invidious.privacydev.net',     // FR - official list
    'https://iv.datura.network',            // FI - official list
    'https://invidious.fdn.fr',             // FR - official list
    'https://invidious.protokolla.fi',      // FI - official list
    'https://invidious.private.coffee',     // AT - official list
    'https://yt.drgnz.club',               // CZ - official list
    'https://invidious.perennialte.ch',     // AU - official list
    'https://invidious.drgns.space',        // US - official list
    'https://inv.us.projectsegfau.lt',      // US - official list
    'https://invidious.jing.rocks',         // JP - official list
    'https://yewtu.be',                     // DE - oldest instance
    'https://invidious.nerdvpn.de',
    'https://invidious.protokoll-11.de',
    'https://invidious.slipfox.xyz',
];

async function tryInvidiousInstance(instance: string, query: string): Promise<Song[]> {
    const url = `${instance}/api/v1/search?q=${encodeURIComponent(query)}&type=video`;
    const response = await fetchWithTimeout(url, 8000);
    if (!response.ok) {
        recordFail('invidious', instance);
        return [];
    }
    const data = await response.json();
    if (!Array.isArray(data) || data.length === 0) return [];

    const songs: Song[] = data
        .filter((item: any) => item.videoId && item.title)
        .slice(0, 20)
        .map((item: any): Song => {
            const thumb =
                item.videoThumbnails?.find((t: any) => t.quality === 'medium')?.url ||
                item.videoThumbnails?.[0]?.url ||
                `https://i.ytimg.com/vi/${item.videoId}/mqdefault.jpg`;
            return {
                videoId: item.videoId,
                title: cleanTitle(item.title),
                artist: cleanTitle(item.author || 'Unknown Artist'),
                thumbnail: thumb.startsWith('//') ? `https:${thumb}` : thumb,
                duration: typeof item.lengthSeconds === 'number' ? item.lengthSeconds : 0,
            };
        });

    if (songs.length > 0) recordSuccess('invidious', instance);
    return songs;
}

async function searchInvidious(query: string): Promise<Song[]> {
    const sorted = sortInstancesByHealth(INVIDIOUS_INSTANCES, 'invidious');

    // Race top 3 in parallel for speed (same approach as reference app)
    const top3 = sorted.slice(0, 3);
    const raceResult = await Promise.race([
        ...top3.map(inst =>
            tryInvidiousInstance(inst, query).then(songs => songs.length > 0 ? songs : null).catch(() => null)
        ),
        new Promise<null>(resolve => setTimeout(() => resolve(null), 4000)),
    ]);
    if (raceResult) return raceResult;

    // Sequential fallback for remaining instances
    for (const instance of sorted.slice(3)) {
        try {
            const songs = await tryInvidiousInstance(instance, query);
            if (songs.length > 0) return songs;
        } catch {
            recordFail('invidious', instance);
        }
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
    for (const instance of sorted) {
        try {
            const res = await fetchWithTimeout(`${instance}/streams/${videoId}`, 8000);
            if (!res.ok) continue;
            const data = await res.json();

            const audioStream = data.audioStreams?.sort((a: any, b: any) => (b.bitrate || 0) - (a.bitrate || 0))[0];
            const videoStream = data.videoStreams?.sort((a: any, b: any) => (b.bitrate || 0) - (a.bitrate || 0))[0];

            const audioUrl = audioStream?.url || data.hls || '';
            if (audioUrl || videoStream?.url) {
                recordSuccess('piped', instance);
                return { audioUrl, videoUrl: videoStream?.url || data.hls };
            }
        } catch {
            recordFail('piped', instance);
        }
    }
    throw new Error('All stream instances failed');
}

// ─── Main search export ────────────────────────────────────────────────────
export async function searchSongs(
    query: string,
    preferredProvider: SearchProvider = 'invidious',
    apiKey = '',
): Promise<{ songs: Song[]; provider: string }> {
    if (!query?.trim()) return { songs: [], provider: 'none' };

    const q = query.trim();

    // Cache hit
    const cached = getCachedResult(q);
    if (cached?.length) {
        return { songs: cached, provider: 'cache' };
    }

    let songs: Song[] = [];
    let usedProvider: string = preferredProvider;

    // Try preferred provider first, then fallbacks
    const providers: Array<{ name: string; fn: () => Promise<Song[]> }> = [];

    if (preferredProvider === 'piped') {
        providers.push({ name: 'piped', fn: () => searchPiped(q) });
        providers.push({ name: 'invidious', fn: () => searchInvidious(q) });
    } else if (preferredProvider === 'invidious') {
        providers.push({ name: 'invidious', fn: () => searchInvidious(q) });
        providers.push({ name: 'piped', fn: () => searchPiped(q) });
    } else if (preferredProvider === 'youtube' && apiKey) {
        providers.push({ name: 'youtube', fn: () => searchYouTube(q, apiKey) });
        providers.push({ name: 'invidious', fn: () => searchInvidious(q) });
        providers.push({ name: 'piped', fn: () => searchPiped(q) });
    } else {
        // Default: Invidious first (works on PC & mobile)
        providers.push({ name: 'invidious', fn: () => searchInvidious(q) });
        providers.push({ name: 'piped', fn: () => searchPiped(q) });
    }

    // Always append YouTube if key available and not already first
    if (apiKey && preferredProvider !== 'youtube') {
        providers.push({ name: 'youtube', fn: () => searchYouTube(q, apiKey) });
    }

    for (const provider of providers) {
        try {
            songs = await provider.fn();
            if (songs.length > 0) {
                usedProvider = provider.name;
                cacheResult(q, songs, usedProvider);
                return { songs, provider: usedProvider };
            }
        } catch (error) {
            console.error(`${provider.name} failed:`, error);
            continue;
        }
    }

    console.warn('No results found for:', q);
    return { songs: [], provider: 'failed' };
}

export function clearSearchCache(): void {
    Object.keys(localStorage)
        .filter(k => k.startsWith('music_search_'))
        .forEach(k => localStorage.removeItem(k));
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
