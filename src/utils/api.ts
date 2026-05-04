import type { Song, SearchProvider } from '@/types';

// ─── Cache (v1 जैसा ही) ────────────────────────────────────────────────────
const CACHE_DURATION = 24 * 60 * 60 * 1000;

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
    } catch { /* storage full */ }
}

// ─── Network (v2 का stable timeout) ────────────────────────────────────────
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

// ─── Helpers (v2 की robust ID निकालने वाली) ────────────────────────────────
function cleanTitle(raw: string): string {
    return (raw || 'Unknown')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .trim();
}

function extractVideoId(item: any): string {
    // पहले item.videoId या item.id
    let vid = item.videoId || item.id || '';
    if (!vid && item.url) {
        // youtu.be/xxxx या /watch?v=xxxx
        const match = item.url.match(/(?:youtu\.be\/|watch\?v=)([a-zA-Z0-9_-]{11})/);
        vid = match ? match[1] : '';
    }
    return vid.trim();
}

// ─── Piped (v1 की सारी इंस्टेंसेज़ + v2 का sequential loop) ─────────────────
const PIPED_INSTANCES = [
    'https://pipedapi.kavin.rocks',
    'https://pipedapi.syncpundit.io',
    'https://pipedapi.tokhmi.xyz',
    'https://pipedapi.moomoo.me',
    'https://piped-api.garudalinux.org',
    'https://api-piped.mha.fi',
    'https://pipedapi.rivo.lol',
    'https://pipedapi.leptons.xyz',
    'https://piped-api.lunar.icu',
    'https://pipedapi.colinslegacy.com',
    'https://pipedapi.r4fo.com',
    'https://pipedapi.adminforge.de',
    'https://yapi.vyper.me',
    'https://api.looleh.xyz',
    'https://piped-api.cfe.re',
    'https://pipedapi.projectsegfau.lt',
    'https://api.piped.yt',
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
    try {
        const url = `${instance}/search?q=${encodeURIComponent(query)}&filter=videos`;
        const response = await fetchWithTimeout(url, 10000);
        if (!response.ok) return [];
        const data = await response.json();
        if (!data.items || !Array.isArray(data.items)) return [];

        const songs = data.items
            .slice(0, 20)
            .map(parsePipedItem)
            .filter((s: Song | null): s is Song => s !== null);
        return songs;
    } catch {
        return [];
    }
}

async function searchPiped(query: string): Promise<Song[]> {
    // बिना race के, एक-एक करके – v2 का तरीका
    for (const instance of PIPED_INSTANCES) {
        const songs = await tryPipedInstance(instance, query);
        if (songs.length > 0) {
            console.log(`Piped success: ${instance}`);
            return songs;
        }
    }
    return [];
}

// ─── Invidious (v1 की सारी इंस्टेंसेज़ + sequential) ───────────────────────
const INVIDIOUS_INSTANCES = [
    'https://iv.melmac.space',
    'https://inv.nadeko.net',
    'https://inv.tux.pizza',
    'https://yt.artemislena.eu',
    'https://invidious.flokinet.to',
    'https://invidious.privacydev.net',
    'https://iv.datura.network',
    'https://invidious.fdn.fr',
    'https://invidious.protokolla.fi',
    'https://invidious.private.coffee',
    'https://yt.drgnz.club',
    'https://invidious.perennialte.ch',
    'https://invidious.drgns.space',
    'https://inv.us.projectsegfau.lt',
    'https://invidious.jing.rocks',
    'https://yewtu.be',
    'https://invidious.nerdvpn.de',
    'https://invidious.protokoll-11.de',
    'https://invidious.slipfox.xyz',
];

async function tryInvidiousInstance(instance: string, query: string): Promise<Song[]> {
    try {
        const url = `${instance}/api/v1/search?q=${encodeURIComponent(query)}&type=video`;
        const response = await fetchWithTimeout(url, 10000);
        if (!response.ok) return [];
        const data = await response.json();
        if (!Array.isArray(data) || data.length === 0) return [];

        const songs = data.slice(0, 20).map((item: any): Song => {
            const thumb = item.videoThumbnails?.find((t: any) => t.quality === 'medium')?.url ||
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
        return songs;
    } catch {
        return [];
    }
}

async function searchInvidious(query: string): Promise<Song[]> {
    for (const instance of INVIDIOUS_INSTANCES) {
        const songs = await tryInvidiousInstance(instance, query);
        if (songs.length > 0) {
            console.log(`Invidious success: ${instance}`);
            return songs;
        }
    }
    return [];
}

// ─── YouTube Data API (v1 जैसा ही) ─────────────────────────────────────────
async function searchYouTube(query: string, apiKey: string): Promise<Song[]> {
    if (!apiKey) return [];
    try {
        const url = new URL('https://www.googleapis.com/youtube/v3/search');
        url.searchParams.set('part', 'snippet');
        url.searchParams.set('q', query);
        url.searchParams.set('type', 'video');
        url.searchParams.set('maxResults', '20');
        url.searchParams.set('key', apiKey);

        const res = await fetchWithTimeout(url.toString(), 10000);
        if (!res.ok) return [];
        const data = await res.json();
        if (!Array.isArray(data?.items)) return [];

        return data.items
            .filter((i: any) => i.id?.videoId)
            .map((i: any): Song => ({
                videoId: i.id.videoId,
                title: cleanTitle(i.snippet?.title),
                artist: cleanTitle(i.snippet?.channelTitle || 'Unknown Artist'),
                thumbnail: i.snippet?.thumbnails?.high?.url ||
                           i.snippet?.thumbnails?.medium?.url ||
                           `https://i.ytimg.com/vi/${i.id.videoId}/mqdefault.jpg`,
                duration: 0,
            }));
    } catch {
        return [];
    }
}

// ─── Stream URL (v1 जैसा, पर sequential) ───────────────────────────────────
export async function getStreamUrl(videoId: string): Promise<{ audioUrl: string; videoUrl?: string }> {
    for (const instance of PIPED_INSTANCES) {
        try {
            const res = await fetchWithTimeout(`${instance}/streams/${videoId}`, 10000);
            if (!res.ok) continue;
            const data = await res.json();
            const audioStream = data.audioStreams?.sort((a: any, b: any) => (b.bitrate || 0) - (a.bitrate || 0))[0];
            const videoStream = data.videoStreams?.sort((a: any, b: any) => (b.bitrate || 0) - (a.bitrate || 0))[0];
            const audioUrl = audioStream?.url || data.hls || '';
            if (audioUrl || videoStream?.url) {
                return { audioUrl, videoUrl: videoStream?.url || data.hls };
            }
        } catch { /* continue */ }
    }
    throw new Error('All stream instances failed');
}

// ─── Main Search (v2 का फॉलबैक ऑर्डर + v1 की प्रोवाइडर प्राथमिकता) ─────────
export async function searchSongs(
    query: string,
    preferredProvider: SearchProvider = 'invidious',
    apiKey = '',
): Promise<{ songs: Song[]; provider: string }> {
    if (!query?.trim()) return { songs: [], provider: 'none' };
    const q = query.trim();

    const cached = getCachedResult(q);
    if (cached?.length) return { songs: cached, provider: 'cache' };

    let songs: Song[] = [];
    let usedProvider = preferredProvider;

    // प्रोवाइडर की लिस्ट v1 की तरह ही, लेकिन हर एक को sequential ट्राई करेंगे
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
        providers.push({ name: 'invidious', fn: () => searchInvidious(q) });
        providers.push({ name: 'piped', fn: () => searchPiped(q) });
    }

    // यूट्यूब को बोनस के रूप में रखें (अगर की है)
    if (apiKey && preferredProvider !== 'youtube') {
        providers.push({ name: 'youtube', fn: () => searchYouTube(q, apiKey) });
    }

    for (const provider of providers) {
        songs = await provider.fn();
        if (songs.length > 0) {
            usedProvider = provider.name;
            cacheResult(q, songs, usedProvider);
            return { songs, provider: usedProvider };
        }
    }

    return { songs: [], provider: 'failed' };
}

export function clearSearchCache(): void {
    Object.keys(localStorage)
        .filter(k => k.startsWith('music_search_'))
        .forEach(k => localStorage.removeItem(k));
}

export type YouTubeKeyStatus = 'unknown' | 'checking' | 'connected' | 'invalid' | 'quota' | 'error';
export async function validateYouTubeKey(apiKey: string): Promise<{ status: YouTubeKeyStatus; message: string }> {
    // v1 का वैलिडेटर जैसा है – वैसा ही रखें
    if (!apiKey?.trim()) return { status: 'unknown', message: 'No API key set' };
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
            if (Array.isArray(data?.items)) return { status: 'connected', message: 'Connected · API key is valid' };
            return { status: 'error', message: 'Unexpected response' };
        }
        const errorBody = await res.json().catch(() => ({}));
        const reason = errorBody?.error?.errors?.[0]?.reason || '';
        if (res.status === 400 || reason === 'keyInvalid') return { status: 'invalid', message: 'Invalid API key' };
        if (res.status === 403 && (reason === 'quotaExceeded' || /quota/i.test(errorBody?.error?.message || '')))
            return { status: 'quota', message: 'Quota exceeded' };
        return { status: 'error', message: errorBody?.error?.message || `HTTP ${res.status}` };
    } catch (e: any) {
        if (e?.name === 'AbortError') return { status: 'error', message: 'Network timeout' };
        return { status: 'error', message: 'Could not reach YouTube' };
    }
}
