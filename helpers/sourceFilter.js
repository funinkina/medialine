// Pure helpers for blocking unwanted MPRIS sources (e.g. a browser that
// publishes autoplay noise). No gi imports so the logic stays unit-testable
// under plain node — see sourceFilter.test.js.

import { MPRIS_PREFIX } from './constants.js';

// Canonical, stable id for a player derived from its MPRIS bus name. The
// per-process `.instance<pid>` suffix is stripped so every tab/window/session
// of the same app collapses to one id, which is what the user blocks against:
//   org.mpris.MediaPlayer2.chromium.instance6114 -> "chromium"
//   org.mpris.MediaPlayer2.firefox.instance_1_23 -> "firefox"
//   org.mpris.MediaPlayer2.spotify               -> "spotify"
// Dotted reverse-DNS names are kept intact (io.bassi.Amberol stays whole)
// since only the reserved `.instance` suffix is removed.
export function playerIdFromBusName(busName) {
    if (!busName) return '';
    const tail = busName.startsWith(MPRIS_PREFIX)
        ? busName.slice(MPRIS_PREFIX.length)
        : busName;
    return tail.replace(/\.instance.*$/i, '');
}

// True when the given bus name's player id is in the blocklist. `blocked`
// may be an array or a Set of player ids.
export function isSourceBlocked(busName, blocked) {
    if (!blocked) return false;
    const set = blocked instanceof Set ? blocked : new Set(blocked);
    if (set.size === 0) return false;
    return set.has(playerIdFromBusName(busName));
}
