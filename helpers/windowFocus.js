import Gio from 'gi://Gio';
import GioUnix from 'gi://GioUnix';
import Shell from 'gi://Shell';

import { chromiumAppId, pwaDesktopCandidates, pickWindowIndex } from './pwaUtils.js';

export function identityCandidates(media) {
    const out = [];
    const push = (v) => { if (v) out.push(v); };
    push(media.desktopEntry);
    push(media.identity);
    if (media.identity) {
        push(media.identity.replace(/\s+/g, '-'));
        push(media.identity.replace(/\s+/g, ''));
    }
    if (media.busName) {
        const tail = media.busName.replace('org.mpris.MediaPlayer2.', '');
        push(tail);
        push(tail.split('.')[0]);
    }
    return out;
}

export function findWindowForMedia(media, pid, windowClassCache) {
    if (!pid) return null;

    let candidates;
    try {
        candidates = global.get_window_actors()
            .map(a => a.meta_window)
            .filter(w => w && w.get_pid() === pid);
    } catch (_) {
        return null;
    }

    if (candidates.length === 0) return null;

    if (candidates.length === 1) {
        windowClassCache.set(media.busName, candidates[0].get_wm_class());
        return candidates[0];
    }

    const descriptors = candidates.map(w => ({
        title: w.get_title() || '',
        wmClass: w.get_wm_class() || '',
        userTime: w.get_user_time(),
    }));

    const idx = pickWindowIndex(descriptors, {
        title: media.title || '',
        needles: identityCandidates(media),
        knownClass: windowClassCache.get(media.busName) || '',
    });

    const best = candidates[idx] || candidates[0];
    windowClassCache.set(media.busName, best.get_wm_class());
    return best;
}

export function lookupPwaGiconByWmClass(win) {
    const classes = [win.get_wm_class(), win.get_wm_class_instance()].filter(Boolean);
    if (classes.length === 0) return null;

    const appids = [...new Set(classes.map(chromiumAppId).filter(Boolean))];

    // Fast path: build the PWA's .desktop id straight from the app id.
    for (const appid of appids) {
        for (const id of pwaDesktopCandidates(appid)) {
            const info = GioUnix.DesktopAppInfo.new(id);
            const icon = info && info.get_icon();
            if (icon) return icon;
        }
    }

    for (const info of Gio.AppInfo.get_all()) {
        if (typeof info.get_startup_wm_class === 'function') {
            const swc = info.get_startup_wm_class();
            if (swc && classes.includes(swc)) {
                const icon = info.get_icon();
                if (icon) return icon;
            }
        }
        const id = info.get_id();
        if (id && appids.some(a => id.includes(a))) {
            const icon = info.get_icon();
            if (icon) return icon;
        }
    }

    return null;
}

export function lookupAppGiconByString(media) {
    const candidates = identityCandidates(media);
    const ids = candidates.map(c => c.endsWith('.desktop') ? c : `${c}.desktop`);

    for (const id of ids) {
        const info = GioUnix.DesktopAppInfo.new(id);
        if (info) {
            const icon = info.get_icon();
            if (icon) return icon;
        }
    }

    const lcSet = new Set(ids.map(id => id.toLowerCase()));
    for (const info of Gio.AppInfo.get_all()) {
        const aid = info.get_id();
        if (aid && lcSet.has(aid.toLowerCase())) {
            const icon = info.get_icon();
            if (icon) return icon;
        }
    }

    if (media.identity) {
        const needle = media.identity.toLowerCase();
        for (const info of Gio.AppInfo.get_all()) {
            const name = info.get_display_name()?.toLowerCase();
            if (name && (name.includes(needle) || needle.includes(name))) {
                const icon = info.get_icon();
                if (icon) return icon;
            }
        }
    }

    return null;
}

export function lookupAppGicon(self, media) {
    if (!media) return null;

    if (!self._preferences.enhancedPwaSupport) {
        return lookupAppGiconByString(media);
    }

    const pid = self._pidCache.get(media.busName);
    if (pid === undefined) {
        ensurePidResolved(self, media.busName);
    } else if (pid) {
        try {
            const win = findWindowForMedia(media, pid, self._windowClassCache);
            if (win) {
                const pwaIcon = lookupPwaGiconByWmClass(win);
                if (pwaIcon) return pwaIcon;

                const app = Shell.WindowTracker.get_default().get_window_app(win);
                const appInfo = app ? app.get_app_info() : null;
                const icon = appInfo ? appInfo.get_icon() : null;
                if (icon) return icon;
            }
        } catch (_) { }
    }

    const stringIcon = lookupAppGiconByString(media);
    if (stringIcon) return stringIcon;

    return null;
}

export function ensurePidResolved(self, busName) {
    if (!busName) return;
    if (self._pidCache.has(busName) || self._pendingPidLookups.has(busName)) return;
    self._pendingPidLookups.add(busName);
    self._mprisManager.getPidForBusName(busName, (pid) => {
        self._pendingPidLookups.delete(busName);
        self._pidCache.set(busName, pid);
        if (self._artCache) self._onMediaChanged();
    });
}

export function activateWindowForMedia(media, pid, windowClassCache) {
    const win = findWindowForMedia(media, pid, windowClassCache);
    if (!win) return false;
    try {
        const workspace = win.get_workspace();
        const time = global.get_current_time();
        if (workspace) workspace.activate_with_focus(win, time);
        else win.activate(time);
        return true;
    } catch (_) {
        return false;
    }
}

export function raiseViaMpris(busName) {
    Gio.DBus.session.call(
        busName,
        '/org/mpris/MediaPlayer2',
        'org.mpris.MediaPlayer2',
        'Raise',
        null,
        null,
        Gio.DBusCallFlags.NONE,
        -1,
        null,
        (conn, res) => {
            try {
                conn.call_finish(res);
            } catch (_) {
            }
        }
    );
}

export function focusPlayerWindow(self, media) {
    if (!media || !media.busName) return;
    const busName = media.busName;

    const cachedPid = self._pidCache.get(busName);
    if (cachedPid !== undefined) {
        if (cachedPid && activateWindowForMedia(media, cachedPid, self._windowClassCache)) return;
        raiseViaMpris(busName);
        return;
    }

    self._mprisManager.getPidForBusName(busName, (pid) => {
        self._pidCache.set(busName, pid);
        if (!self._artCache) return;
        if (pid && activateWindowForMedia(media, pid, self._windowClassCache)) return;
        raiseViaMpris(busName);
    });
}
