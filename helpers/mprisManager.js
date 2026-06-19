import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';

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

const MPRIS_PREFIX = 'org.mpris.MediaPlayer2.';

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

        try {
            this._dbusProxy = new DBusProxy(
                Gio.DBus.session,
                'org.freedesktop.DBus',
                '/org/freedesktop/DBus',
                null,
                null,
                Gio.DBusProxyFlags.DO_NOT_LOAD_PROPERTIES
            );

            this._nameOwnerChangedId = this._dbusProxy.connectSignal(
                'NameOwnerChanged',
                (_proxy, _sender, [name, oldOwner, newOwner]) => {
                    if (!name.startsWith(MPRIS_PREFIX)) return;

                    if (newOwner === '') {
                        this._removePlayer(name);
                    } else if (oldOwner === '') {
                        this._addPlayer(name);
                    }
                }
            );

            const [names] = this._dbusProxy.ListNamesSync();
            for (const name of names) {
                if (name.startsWith(MPRIS_PREFIX))
                    this._addPlayer(name);
            }
        } catch (e) {
            logError(e, 'Medialine: Failed to initialize MPRIS manager');
        }
    }

    _addPlayer(busName) {
        if (this._players.has(busName)) return;

        try {
            const proxy = new MprisPlayerProxy(
                Gio.DBus.session,
                busName,
                '/org/mpris/MediaPlayer2',
                null,
                null,
                Gio.DBusProxyFlags.GET_INVALIDATED_PROPERTIES
            );

            proxy.connectObject('g-properties-changed',
                () => this._refreshMedia(), this);

            let rootProxy = null;
            try {
                rootProxy = new MprisRootProxy(
                    Gio.DBus.session,
                    busName,
                    '/org/mpris/MediaPlayer2',
                    null,
                    null,
                    Gio.DBusProxyFlags.GET_INVALIDATED_PROPERTIES
                );
            } catch (_) { }

            this._players.set(busName, { proxy, rootProxy });
            this._refreshMedia();
        } catch (e) {
            logError(e, `Medialine: Failed to create proxy for ${busName}`);
        }
    }

    _removePlayer(busName) {
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

    setPosition(positionMicros) {
        if (!this._currentMedia || !this._currentMedia.canSeek) return;
        const trackId = this._currentMedia.trackId;
        if (!trackId) return;
        const clamped = Math.max(0, Math.floor(positionMicros));
        Gio.DBus.session.call(
            this._currentMedia.busName,
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

    getPositionAsync(callback) {
        if (!this._currentMedia || !this._currentMedia.busName) {
            callback(0);
            return;
        }
        Gio.DBus.session.call(
            this._currentMedia.busName,
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
        for (const [, entry] of this._players) {
            entry.proxy.disconnectObject(this);
        }
        this._players.clear();

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