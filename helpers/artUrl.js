export function normalizeArtUrl(url) {
    if (!url) return url;
    return url.replace(
        'https://open.spotify.com/image/',
        'https://i.scdn.co/image/');
}

export function isRemoteArt(url) {
    return typeof url === 'string' && /^https?:\/\//.test(url);
}

// LRU eviction planner. Given cached entries [{name, size, mtime}] and a byte
// budget, return the names of the least-recently-used files to delete so the
// total drops to maxBytes. Returns [] when already under budget or maxBytes<=0.
export function selectEvictions(files, maxBytes) {
    if (!maxBytes || maxBytes <= 0) return [];
    let total = files.reduce((s, f) => s + f.size, 0);
    if (total <= maxBytes) return [];
    const out = [];
    for (const f of [...files].sort((a, b) => a.mtime - b.mtime)) {
        if (total <= maxBytes) break;
        out.push(f.name);
        total -= f.size;
    }
    return out;
}
