// Pure helpers for resolving Chromium/Brave PWA windows to their .desktop ids.
// No gi imports here so the logic stays unit-testable under plain node.

// Chromium app/extension ids are 32 chars in a-p. PWA windows encode the id in
// their WM_CLASS as `crx_<id>` (native) or `<browser>-<id>-Default` (Flatpak).
export const CHROMIUM_APPID = /(?:^|[-_])([a-p]{32})(?:[-_]|$)/;

export function chromiumAppId(wmClass) {
    const m = wmClass && wmClass.match(CHROMIUM_APPID);
    return m ? m[1] : null;
}

const BROWSER_PREFIXES = ['chrome', 'chromium', 'brave', 'brave-browser', 'msedge', 'vivaldi'];

// Likely .desktop basenames for a PWA, given its app id.
export function pwaDesktopCandidates(appid) {
    return BROWSER_PREFIXES.map(p => `${p}-${appid}-Default.desktop`);
}

const KNOWN_APP_TITLES = [
    'youtube music', 'spotify', 'tidal', 'deezer', 'music',
    'soundcloud', 'pandora', 'amazon music', 'apple music',
];

// Pick the index of the window best matching the active media.
// windows: [{ title, wmClass, userTime }].
// knownClass is a weak stability tiebreak only — it must never override a title
// or app-name match. One Chromium process publishes a single MPRIS bus shared by
// its browser tab and PWA windows, so a class cached while only the browser
// window existed must not pin the bus to that window once the PWA window opens.
export function pickWindowIndex(windows, { title = '', needles = [], knownClass = '' } = {}) {
    const mt = title.toLowerCase();
    const kc = (knownClass || '').toLowerCase();
    const nds = needles.map(n => n.toLowerCase()).filter(Boolean);

    let best = -1;
    let bestScore = -Infinity;
    windows.forEach((w, idx) => {
        const t = (w.title || '').toLowerCase();
        const c = (w.wmClass || '').toLowerCase();
        let s = 0;
        if (mt && t.includes(mt)) s += 1000;
        if (KNOWN_APP_TITLES.some(k => t.includes(k))) s += 500;
        if (nds.some(n => c.includes(n) || n.includes(c))) s += 100;
        if (kc && c === kc) s += 50;
        s += (w.userTime || 0) / 1e7;
        if (s > bestScore) {
            bestScore = s;
            best = idx;
        }
    });
    return best;
}
