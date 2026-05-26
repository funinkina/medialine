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
        <property name="PlaybackStatus" type="s" access="read"/>
        <property name="Position" type="x" access="read"/>
        <property name="Metadata" type="a{sv}" access="read"/>
        <property name="CanGoNext" type="b" access="read"/>
        <property name="CanGoPrevious" type="b" access="read"/>
        <signal name="Seeked">
            <arg type="x" name="Position"/>
        </signal>
    </interface>
</node>`;

const DBusProxy = Gio.DBusProxy.makeProxyWrapper(DBusInterface);
const MprisPlayerProxy = Gio.DBusProxy.makeProxyWrapper(MprisPlayerInterface);

const MPRIS_PREFIX = 'org.mpris.MediaPlayer2.';

export const MprisManager = GObject.registerClass({
    Signals: {
        'media-changed': {},
    },
}, class MprisManager extends GObject.Object {
    _init() {
        super._init();
        this._players = new Map();
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

            const handlerId = proxy.connect('g-properties-changed', () => {
                this._pickBestPlayer();
            });

            this._players.set(busName, { proxy, handlerId });
            this._pickBestPlayer();
        } catch (e) {
            logError(e, `Medialine: Failed to create proxy for ${busName}`);
        }
    }

    _removePlayer(busName) {
        const entry = this._players.get(busName);
        if (!entry) return;

        try {
            entry.proxy.disconnect(entry.handlerId);
        } catch (_) { }

        this._players.delete(busName);
        this._pickBestPlayer();
    }

    _pickBestPlayer() {
        let bestEntry = null;
        let bestBus = null;

        // Prefer Playing, then Paused
        for (const [busName, entry] of this._players) {
            const status = entry.proxy.PlaybackStatus;
            if (status === 'Playing') {
                bestEntry = entry;
                bestBus = busName;
                break;
            }
            if (status === 'Paused' && !bestEntry) {
                bestEntry = entry;
                bestBus = busName;
            }
        }

        if (!bestEntry) {
            this._currentMedia = null;
            this._currentEntry = null;
            this.emit('media-changed');
            return;
        }

        const metadata = this._unpackMetadata(bestEntry.proxy.Metadata);
        this._currentMedia = {
            title: metadata['xesam:title'] || '',
            artist: Array.isArray(metadata['xesam:artist'])
                ? metadata['xesam:artist'][0] || ''
                : metadata['xesam:artist'] || '',
            album: metadata['xesam:album'] || '',
            artUrl: metadata['mpris:artUrl'] || '',
            length: Number(metadata['mpris:length']) || 0,
            status: bestEntry.proxy.PlaybackStatus || 'Stopped',
            canGoNext: bestEntry.proxy.CanGoNext !== false,
            canGoPrevious: bestEntry.proxy.CanGoPrevious !== false,
            busName: bestBus,
        };
        this._currentEntry = bestEntry;

        this.emit('media-changed');
    }

    playPause() {
        this._invoke('PlayPauseRemote');
    }

    next() {
        this._invoke('NextRemote');
    }

    previous() {
        this._invoke('PreviousRemote');
    }

    _invoke(method) {
        if (!this._currentEntry) return;
        try {
            this._currentEntry.proxy[method]();
        } catch (e) {
            logError(e, `Medialine: ${method} failed`);
        }
    }

    getPosition() {
        if (!this._currentMedia || !this._currentMedia.busName) return 0;
        try {
            const result = Gio.DBus.session.call_sync(
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
                null
            );
            const [variant] = result.deepUnpack();
            return Number(variant.unpack()) || 0;
        } catch (_) {
            return 0;
        }
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

    destroy() {
        for (const [busName, entry] of this._players) {
            try {
                entry.proxy.disconnect(entry.handlerId);
            } catch (_) { }
        }
        this._players.clear();

        if (this._dbusProxy && this._nameOwnerChangedId) {
            try {
                this._dbusProxy.disconnectSignal(this._nameOwnerChangedId);
            } catch (_) { }
        }

        this._nameOwnerChangedId = null;
        this._dbusProxy = null;
        this._currentMedia = null;
    }
});
