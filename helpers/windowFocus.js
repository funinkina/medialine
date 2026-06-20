import Gio from 'gi://Gio';
import GioUnix from 'gi://GioUnix';
import Shell from 'gi://Shell';

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

    const knownClass = windowClassCache.get(media.busName);
    if (knownClass) {
        const match = candidates.find(w => w.get_wm_class() === knownClass);
        if (match) return match;
    }

    let best = null;
    let bestScore = -1;

    const knownAppTitles = [
        'youtube music', 'spotify', 'tidal', 'deezer', 'music',
        'soundcloud', 'pandora', 'amazon music', 'apple music',
    ];
    const needles = identityCandidates(media)
        .map(s => s.toLowerCase())
        .filter(Boolean);

    for (const w of candidates) {
        let score = 0;
        const title = (w.get_title() || '').toLowerCase();
        const wmclass = (w.get_wm_class() || '').toLowerCase();

        if (media.title && title.includes(media.title.toLowerCase()))
            score += 1000;

        if (knownAppTitles.some(kw => title.includes(kw)))
            score += 500;

        if (needles.some(n => wmclass.includes(n) || n.includes(wmclass)))
            score += 100;

        score += w.get_user_time() / 10000000;

        if (score > bestScore) {
            bestScore = score;
            best = w;
        }
    }

    if (best) return best;

    let fallback = candidates[0];
    for (const w of candidates) {
        if (w.get_user_time() > fallback.get_user_time())
            fallback = w;
    }
    return fallback;
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

    const pid = self._pidCache.get(media.busName);
    if (pid === undefined) {
        ensurePidResolved(self, media.busName);
    } else if (pid) {
        try {
            const win = findWindowForMedia(media, pid, self._windowClassCache);
            const app = win
                ? Shell.WindowTracker.get_default().get_window_app(win)
                : null;
            const appInfo = app ? app.get_app_info() : null;
            const icon = appInfo ? appInfo.get_icon() : null;
            if (icon) return icon;
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
        if (!self._destroyed) self._onMediaChanged();
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
        if (self._destroyed) return;
        if (pid && activateWindowForMedia(media, pid, self._windowClassCache)) return;
        raiseViaMpris(busName);
    });
}
