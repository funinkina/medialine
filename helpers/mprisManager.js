import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';

import { MPRIS_PREFIX } from './constants.js';

const DBusInterface = `<node>
    <interface name="org.freedesktop.DBus">
        <method name="ListNames">
            <arg type="as" direction="out"/>
        </method>
        <signal name="NameOwnerChanged">
            <arg type="s" name="name"/>
            <arg type="s" name="old_owner"/>
            <arg type="s" name="new_owner"/>
        </signal>
    </interface>
</node>`;

const MprisPlayerInterface = `<node>
    <interface name="org.mpris.MediaPlayer2.Player">
        <method name="PlayPause"/>
        <method name="Play"/>
        <method name="Pause"/>
        <method name="Next"/>
        <method name="Previous"/>
        <method name="SetPosition">
            <arg type="o" name="TrackId" direction="in"/>
            <arg type="x" name="Position" direction="in"/>
        </method>
        <property name="PlaybackStatus" type="s" access="read"/>
        <property name="Position" type="x" access="read"/>
        <property name="Metadata" type="a{sv}" access="read"/>
        <property name="CanGoNext" type="b" access="read"/>
        <property name="CanGoPrevious" type="b" access="read"/>
        <property name="CanControl" type="b" access="read"/>
        <property name="CanSeek" type="b" access="read"/>
        <property name="Shuffle" type="b" access="readwrite"/>
        <property name="LoopStatus" type="s" access="readwrite"/>
        <signal name="Seeked">
            <arg type="x" name="Position"/>
        </signal>
    </interface>
</node>`;

const MprisRootInterface = `<node>
    <interface name="org.mpris.MediaPlayer2">
        <property name="DesktopEntry" type="s" access="read"/>
        <property name="Identity" type="s" access="read"/>
    </interface>
</node>`;

const DBusProxy = Gio.DBusProxy.makeProxyWrapper(DBusInterface);
const MprisPlayerProxy = Gio.DBusProxy.makeProxyWrapper(MprisPlayerInterface);
const MprisRootProxy = Gio.DBusProxy.makeProxyWrapper(MprisRootInterface);

export const MprisManager = GObject.registerClass({
    Signals: {
        'media-changed': {},
    },
}, class MprisManager extends GObject.Object {
    _init() {
        super._init();
        this._players = new Map();
        this._allMedia = [];
        this._currentMedia = null;
        this._currentEntry = null;
        this._nameOwnerChangedId = null;
        this._dbusProxy = null;
        this._pendingAdds = new Set();

        new DBusProxy(
            Gio.DBus.session,
            'org.freedesktop.DBus',
            '/org/freedesktop/DBus',
            (proxy, error) => {
                if (!this._players) return;
                if (error) {
                    logError(error, 'Medialine: Failed to initialize MPRIS manager');
                    return;
                }
                this._dbusProxy = proxy;

                this._nameOwnerChangedId = proxy.connectSignal(
                    'NameOwnerChanged',
                    (_p, _s, [name, oldOwner, newOwner]) => {
                        if (!name.startsWith(MPRIS_PREFIX)) return;
                        if (newOwner === '') this._removePlayer(name);
                        else if (oldOwner === '') this._addPlayer(name);
                    }
                );

                proxy.ListNamesRemote((result, err) => {
                    if (!this._dbusProxy || err || !result) return;
                    for (const name of result[0]) {
                        if (name.startsWith(MPRIS_PREFIX))
                            this._addPlayer(name);
                    }
                });
            },
            null,
            Gio.DBusProxyFlags.DO_NOT_LOAD_PROPERTIES
        );
    }

    _addPlayer(busName) {
        if (this._players.has(busName) || this._pendingAdds.has(busName)) return;
        this._pendingAdds.add(busName);

        new MprisPlayerProxy(
            Gio.DBus.session,
            busName,
            '/org/mpris/MediaPlayer2',
            (proxy, error) => {
                if (!this._pendingAdds || !this._pendingAdds.has(busName)) {
                    this._pendingAdds?.delete(busName);
                    return;
                }
                if (error) {
                    this._pendingAdds.delete(busName);
                    logError(error, `Medialine: Failed to create proxy for ${busName}`);
                    return;
                }

                proxy.connectObject('g-properties-changed',
                    () => this._refreshMedia(), this);

                new MprisRootProxy(
                    Gio.DBus.session,
                    busName,
                    '/org/mpris/MediaPlayer2',
                    (rootProxy, rootError) => {
                        if (!this._pendingAdds || !this._pendingAdds.has(busName)) {
                            proxy.disconnectObject(this);
                            this._pendingAdds?.delete(busName);
                            return;
                        }
                        this._pendingAdds.delete(busName);
                        if (this._players.has(busName)) {
                            proxy.disconnectObject(this);
                            return;
                        }
                        this._players.set(busName, {
                            proxy,
                            rootProxy: rootError ? null : rootProxy,
                        });
                        this._refreshMedia();
                    },
                    null,
                    Gio.DBusProxyFlags.GET_INVALIDATED_PROPERTIES
                );
            },
            null,
            Gio.DBusProxyFlags.GET_INVALIDATED_PROPERTIES
        );
    }

    _removePlayer(busName) {
        this._pendingAdds.delete(busName);

        const entry = this._players.get(busName);
        if (!entry) return;

        entry.proxy.disconnectObject(this);

        this._players.delete(busName);
        this._refreshMedia();
    }

    _buildMediaObject(busName, entry) {
        const metadata = this._unpackMetadata(entry.proxy.Metadata);
        let desktopEntry = '';
        let identity = '';
        if (entry.rootProxy) {
            try {
                desktopEntry = String(entry.rootProxy.DesktopEntry || '');
                identity = String(entry.rootProxy.Identity || '');
            } catch (_) { }
        }
        return {
            title: metadata['xesam:title'] || '',
            artist: Array.isArray(metadata['xesam:artist'])
                ? metadata['xesam:artist'][0] || ''
                : metadata['xesam:artist'] || '',
            album: metadata['xesam:album'] || '',
            artUrl: metadata['mpris:artUrl'] || '',
            length: Number(metadata['mpris:length']) || 0,
            trackId: metadata['mpris:trackid'] || '',
            status: entry.proxy.PlaybackStatus || 'Stopped',
            canGoNext: entry.proxy.CanGoNext !== false,
            canGoPrevious: entry.proxy.CanGoPrevious !== false,
            canControl: entry.proxy.CanControl !== false,
            canSeek: entry.proxy.CanSeek !== false,
            shuffle: entry.proxy.Shuffle != null ? Boolean(entry.proxy.Shuffle) : null,
            loopStatus: entry.proxy.LoopStatus != null ? String(entry.proxy.LoopStatus) : null,
            busName,
            desktopEntry,
            identity,
        };
    }

    // Rebuilds the full list of active (non-stopped) players, ordered
    // Playing-first then Paused, and picks the first as the "best" one
    // used for the panel label/icon and the single-player rich popup.
    _refreshMedia() {
        const candidates = [];
        for (const [busName, entry] of this._players) {
            const status = entry.proxy.PlaybackStatus;
            if (status === 'Stopped') continue;
            candidates.push({ busName, entry, status });
        }

        candidates.sort((a, b) => {
            const rank = s => (s === 'Playing' ? 0 : 1);
            return rank(a.status) - rank(b.status);
        });

        this._allMedia = candidates.map(c => this._buildMediaObject(c.busName, c.entry));

        if (candidates.length === 0) {
            this._currentMedia = null;
            this._currentEntry = null;
        } else {
            this._currentMedia = this._allMedia[0];
            this._currentEntry = candidates[0].entry;
        }

        this.emit('media-changed');
    }

    playPause(busName) {
        this._invoke('PlayPauseRemote', busName);
    }

    next(busName) {
        this._invoke('NextRemote', busName);
    }

    previous(busName) {
        this._invoke('PreviousRemote', busName);
    }

    setShuffle(value, busName = this._currentMedia?.busName) {
        if (!busName) return;
        this._setPlayerProperty(busName, 'Shuffle', new GLib.Variant('b', value),
            'Medialine: setShuffle failed');
    }

    setLoopStatus(value, busName = this._currentMedia?.busName) {
        if (!busName) return;
        this._setPlayerProperty(busName, 'LoopStatus', new GLib.Variant('s', value),
            'Medialine: setLoopStatus failed');
    }

    _setPlayerProperty(busName, propName, valueVariant, errorLabel) {
        Gio.DBus.session.call(
            busName,
            '/org/mpris/MediaPlayer2',
            'org.freedesktop.DBus.Properties',
            'Set',
            new GLib.Variant('(ssv)', [
                'org.mpris.MediaPlayer2.Player', propName, valueVariant,
            ]),
            null,
            Gio.DBusCallFlags.NONE,
            500,
            null,
            (conn, res) => {
                try {
                    conn.call_finish(res);
                } catch (e) {
                    logError(e, errorLabel);
                }
            }
        );
    }

    _invoke(method, busName) {
        const entry = busName ? this._players.get(busName) : this._currentEntry;
        if (!entry) return;
        try {
            entry.proxy[method]();
        } catch (e) {
            logError(e, `Medialine: ${method} failed`);
        }
    }

    setPosition(positionMicros, busName = this._currentMedia?.busName) {
        const media = busName
            ? this._allMedia.find(m => m.busName === busName)
            : this._currentMedia;
        if (!media || !media.canSeek) return;
        const trackId = media.trackId;
        if (!trackId) return;
        const clamped = Math.max(0, Math.floor(positionMicros));
        Gio.DBus.session.call(
            media.busName,
            '/org/mpris/MediaPlayer2',
            'org.mpris.MediaPlayer2.Player',
            'SetPosition',
            new GLib.Variant('(ox)', [String(trackId), clamped]),
            null,
            Gio.DBusCallFlags.NONE,
            500,
            null,
            (conn, res) => {
                try {
                    conn.call_finish(res);
                } catch (e) {
                    logError(e, 'Medialine: setPosition failed');
                }
            }
        );
    }

    getPositionAsync(callback, busName = this._currentMedia?.busName) {
        if (!busName) {
            callback(0);
            return;
        }
        Gio.DBus.session.call(
            busName,
            '/org/mpris/MediaPlayer2',
            'org.freedesktop.DBus.Properties',
            'Get',
            new GLib.Variant('(ss)', [
                'org.mpris.MediaPlayer2.Player',
                'Position',
            ]),
            null,
            Gio.DBusCallFlags.NONE,
            500,
            null,
            (conn, res) => {
                try {
                    const result = conn.call_finish(res);
                    const [variant] = result.deepUnpack();
                    callback(Number(variant.unpack()) || 0);
                } catch (_) {
                    callback(0);
                }
            }
        );
    }

    // Resolves the unix PID that owns a given MPRIS bus name. Used by the
    // indicator both to find a better app icon and to focus the correct
    // existing window instead of relying on the player's own (sometimes
    // buggy) handling of the MPRIS Raise method.
    getPidForBusName(busName, callback) {
        Gio.DBus.session.call(
            'org.freedesktop.DBus',
            '/org/freedesktop/DBus',
            'org.freedesktop.DBus',
            'GetConnectionUnixProcessID',
            new GLib.Variant('(s)', [busName]),
            null,
            Gio.DBusCallFlags.NONE,
            -1,
            null,
            (conn, res) => {
                let pid = 0;
                try {
                    const result = conn.call_finish(res);
                    [pid] = result.deepUnpack();
                } catch (_) { /* unknown */ }
                callback(pid);
            }
        );
    }

    _unpackMetadata(metadata) {
        if (!metadata) return {};
        try {
            if (typeof metadata.recursiveUnpack === 'function')
                return metadata.recursiveUnpack();

            const unwrap = (v) => {
                if (!v || typeof v !== 'object') return v;
                if (typeof v.recursiveUnpack === 'function') return v.recursiveUnpack();
                if (typeof v.deep_unpack === 'function') return v.deep_unpack();
                return v;
            };

            const dict = typeof metadata.deep_unpack === 'function'
                ? metadata.deep_unpack()
                : metadata;

            const out = {};
            for (const k in dict) out[k] = unwrap(dict[k]);
            return out;
        } catch (_) {
            return {};
        }
    }

    get currentMedia() {
        return this._currentMedia;
    }

    // All currently active (non-stopped) players, Playing first.
    get allMedia() {
        return this._allMedia;
    }

    destroy() {
        this._pendingAdds.clear();

        if (this._players) {
            for (const [, entry] of this._players)
                entry.proxy.disconnectObject(this);
            this._players = null;
        }

        if (this._dbusProxy && this._nameOwnerChangedId) {
            this._dbusProxy.disconnectSignal(this._nameOwnerChangedId);
        }

        this._nameOwnerChangedId = null;
        this._dbusProxy = null;
        this._allMedia = [];
        this._currentMedia = null;
        this._currentEntry = null;
    }
});
