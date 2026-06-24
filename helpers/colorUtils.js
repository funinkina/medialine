export function hexToRgba(hex, alpha) {
    const h = hex.replace('#', '');
    const r = parseInt(h.substring(0, 2), 16);
    const g = parseInt(h.substring(2, 4), 16);
    const b = parseInt(h.substring(4, 6), 16);
    return `rgba(${r},${g},${b},${alpha})`;
}

export function formatTime(microseconds) {
    if (!microseconds || microseconds < 0) return '0:00';
    const totalSeconds = Math.floor(microseconds / 1_000_000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

export function escMarkup(s) {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function adjustColorBrightness(hex, intensity) {
    const h = hex.replace('#', '');
    const r = parseInt(h.substring(0, 2), 16);
    const g = parseInt(h.substring(2, 4), 16);
    const b = parseInt(h.substring(4, 6), 16);

    let fr, fg, fb;
    if (intensity <= 0.5) {
        const t = intensity * 2;
        fr = Math.round(r * t);
        fg = Math.round(g * t);
        fb = Math.round(b * t);
    } else {
        const t = (intensity - 0.5) * 2;
        fr = Math.round(r + (255 - r) * t);
        fg = Math.round(g + (255 - g) * t);
        fb = Math.round(b + (255 - b) * t);
    }

    return `#${[fr, fg, fb].map(c => c.toString(16).padStart(2, '0')).join('').toUpperCase()}`;
}
