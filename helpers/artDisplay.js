import GLib from 'gi://GLib';
import GdkPixbuf from 'gi://GdkPixbuf';

import { ART_SIZE, POPUP_ART_MAX_W, POPUP_ART_MAX_H } from './constants.js';

export function tryGetArtBackgroundCss(media) {
    const artUrl = media.artUrl || '';
    if (!artUrl || !artUrl.startsWith('file://')) return null;
    try {
        const path = GLib.uri_unescape_string(artUrl.substring('file://'.length), null);
        const dims = readImageDims(path);
        if (!dims) return null;
        return { dims, safePath: path.replace(/"/g, '\\"') };
    } catch (_) {
        return null;
    }
}

export function readImageDims(path) {
    try {
        const fmt = GdkPixbuf.Pixbuf.get_file_info(path);
        if (fmt && fmt.length >= 3 && fmt[1] > 0 && fmt[2] > 0)
            return { width: fmt[1], height: fmt[2] };
        const pb = GdkPixbuf.Pixbuf.new_from_file(path);
        return { width: pb.get_width(), height: pb.get_height() };
    } catch (_) {
        return null;
    }
}

export function fitBox(w, h) {
    if (!w || !h) return [ART_SIZE, ART_SIZE];
    const r = w / h;
    const maxR = POPUP_ART_MAX_W / POPUP_ART_MAX_H;
    let outW, outH;
    if (r > maxR) { outW = POPUP_ART_MAX_W; outH = outW / r; }
    else { outH = POPUP_ART_MAX_H; outW = outH * r; }
    return [Math.round(outW), Math.round(outH)];
}

let _extractedArtColorUrl = null;
let _extractedArtColor = null;

export function extractArtColor(media) {
    if (!media?.artUrl || !media.artUrl.startsWith('file://')) return null;
    if (media.artUrl === _extractedArtColorUrl) return _extractedArtColor;
    _extractedArtColorUrl = media.artUrl;
    try {
        const path = GLib.uri_unescape_string(media.artUrl.substring('file://'.length), null);
        const pb = GdkPixbuf.Pixbuf.new_from_file(path);
        const small = pb.scale_simple(1, 1, GdkPixbuf.InterpType.BILINEAR);
        const pixels = small.get_pixels();
        const nChannels = small.get_n_channels();
        const r = pixels[0];
        const g = nChannels > 1 ? pixels[1] : r;
        const b = nChannels > 2 ? pixels[2] : r;
        _extractedArtColor = `#${[r, g, b].map(c => c.toString(16).padStart(2, '0')).join('').toUpperCase()}`;
        return _extractedArtColor;
    } catch (_) {
        _extractedArtColorUrl = null;
        _extractedArtColor = null;
        return null;
    }
}

export function applyArtBin(bin, badgeIcon, media, opts, popupStyles, preferences, appGicon) {
    const art = tryGetArtBackgroundCss(media);
    const showAppIcon = preferences.popupShowAppIcon;

    if (art) {
        const [w, h] = opts.boxSize
            ? [opts.boxSize, opts.boxSize]
            : fitBox(art.dims.width, art.dims.height);
        bin.style =
            `width: ${w}px; height: ${h}px; min-width: ${w}px; min-height: ${h}px; ` +
            `${popupStyles.artCommon} background-image: url("${art.safePath}");`;

        const badgeSize = 28;
        const overlap = 5;
        badgeIcon.icon_size = badgeSize;
        badgeIcon.icon_name = null;
        badgeIcon.gicon = appGicon || null;
        badgeIcon.visible = showAppIcon && !!appGicon;
        badgeIcon.set_size(badgeSize, badgeSize);
        badgeIcon.set_position(w - badgeSize + overlap, h - badgeSize + overlap);
        return;
    }

    const size = opts.boxSize || ART_SIZE;
    bin.style = opts.boxSize
        ? `width: ${size}px; height: ${size}px; min-width: ${size}px; min-height: ${size}px; ${popupStyles.artCommon}`
        : popupStyles.artFallback;

    const fallbackSize = opts.fallbackIconSize;
    badgeIcon.icon_size = fallbackSize;
    badgeIcon.icon_name = 'audio-x-generic-symbolic';
    badgeIcon.gicon = (showAppIcon && appGicon) ? appGicon : null;
    badgeIcon.visible = true;
    badgeIcon.set_size(fallbackSize, fallbackSize);
    badgeIcon.set_position(
        Math.round((size - fallbackSize) / 2),
        Math.round((size - fallbackSize) / 2));
}
