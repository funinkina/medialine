import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Soup from 'gi://Soup';

import { normalizeArtUrl, isRemoteArt, selectEvictions } from './artUrl.js';

const TIMEOUT_SECS = 20;
const MAX_ATTEMPTS = 4;
const BACKOFF_SECS = [1, 3, 8];
const USER_AGENT = 'Medialine-GNOME-Shell-Extension';

export class ArtCache {
    constructor(maxBytes = 0) {
        this._session = new Soup.Session({ timeout: TIMEOUT_SECS });
        this._session.set_user_agent(USER_AGENT);
        this._cancellable = new Gio.Cancellable();
        this._pending = new Map();
        this._attempts = new Map();
        this._retryTimers = new Set();
        this._maxBytes = maxBytes;
        this._dir = GLib.build_filenamev(
            [GLib.get_user_cache_dir(), 'medialine', 'art']);
        GLib.mkdir_with_parents(this._dir, 0o755);
    }

    setMaxBytes(maxBytes) {
        if (maxBytes === this._maxBytes) return;
        this._maxBytes = maxBytes;
        this._prune();
    }

    resolve(remoteUrl, onReady) {
        const url = normalizeArtUrl(remoteUrl);
        if (!isRemoteArt(url)) return null;

        const path = this._pathFor(url);
        const file = Gio.File.new_for_path(path);
        if (file.query_exists(null)) {
            this._touch(path);
            return file.get_uri();
        }

        this._download(url, path, onReady);
        return null;
    }

    _pathFor(url) {
        const hash = GLib.compute_checksum_for_string(
            GLib.ChecksumType.SHA256, url, -1);
        return GLib.build_filenamev([this._dir, hash]);
    }

    _download(url, path, onReady) {
        const waiting = this._pending.get(url);
        if (waiting) {
            if (onReady) waiting.add(onReady);
            return;
        }
        const callbacks = new Set();
        if (onReady) callbacks.add(onReady);
        this._pending.set(url, callbacks);
        this._attempts.set(url, (this._attempts.get(url) || 0) + 1);

        const msg = Soup.Message.new('GET', url);
        if (!msg) {
            this._pending.delete(url);
            return;
        }

        this._session.send_and_read_async(
            msg, GLib.PRIORITY_DEFAULT, this._cancellable, (session, res) => {
                if (!this._session) return;
                this._pending.delete(url);

                let data = null;
                try {
                    const bytes = session.send_and_read_finish(res);
                    if (msg.get_status() === Soup.Status.OK && bytes) {
                        const d = bytes.get_data();
                        if (d && d.length > 0) data = d;
                    }
                    if (!data) {
                        this._retryOrGiveUp(
                            url, path, callbacks, `status ${msg.get_status()}`);
                        return;
                    }
                } catch (e) {
                    this._retryOrGiveUp(url, path, callbacks, e.message);
                    return;
                }

                try {
                    const file = Gio.File.new_for_path(path);
                    file.replace_contents(
                        data, null, false,
                        Gio.FileCreateFlags.REPLACE_DESTINATION, null);
                } catch (e) {
                    logError(e, 'Medialine: failed to write cached art');
                    return;
                }

                this._attempts.delete(url);
                this._prune();
                const uri = Gio.File.new_for_path(path).get_uri();
                for (const cb of callbacks) cb(uri);
            });
    }

    // Bump a cached file's mtime so recency reflects last use, not last write.
    _touch(path) {
        try {
            const secs = Math.floor(GLib.get_real_time() / 1e6);
            Gio.File.new_for_path(path).set_attribute_uint64(
                'time::modified', secs, Gio.FileQueryInfoFlags.NONE, null);
        } catch (_) { }
    }

    // Drop least-recently-used art when the cache exceeds its byte budget.
    _prune() {
        if (!this._maxBytes || this._maxBytes <= 0) return;
        let files;
        try {
            files = this._listCached();
        } catch (e) {
            logError(e, 'Medialine: failed to scan art cache');
            return;
        }
        for (const name of selectEvictions(files, this._maxBytes)) {
            try {
                Gio.File.new_for_path(
                    GLib.build_filenamev([this._dir, name])).delete(null);
            } catch (_) { }
        }
    }

    _listCached() {
        const dir = Gio.File.new_for_path(this._dir);
        const en = dir.enumerate_children(
            'standard::name,standard::size,time::modified',
            Gio.FileQueryInfoFlags.NONE, null);
        const files = [];
        let info;
        while ((info = en.next_file(null)) !== null) {
            files.push({
                name: info.get_name(),
                size: info.get_size(),
                mtime: info.get_attribute_uint64('time::modified'),
            });
        }
        en.close(null);
        return files;
    }

    _retryOrGiveUp(url, path, callbacks, reason) {
        const attempts = this._attempts.get(url) || MAX_ATTEMPTS;
        if (attempts >= MAX_ATTEMPTS) {
            this._attempts.delete(url);
            log(`Medialine: giving up on art ${url} after ${attempts} tries (${reason})`);
            return;
        }
        const delay = BACKOFF_SECS[attempts - 1] || BACKOFF_SECS.at(-1);
        const id = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, delay, () => {
            this._retryTimers.delete(id);
            if (!this._session) return GLib.SOURCE_REMOVE;
            this._download(url, path, callbacks.size ? [...callbacks][0] : null);
            return GLib.SOURCE_REMOVE;
        });
        this._retryTimers.add(id);
    }

    destroy() {
        for (const id of this._retryTimers) GLib.Source.remove(id);
        this._retryTimers.clear();
        this._pending.clear();
        this._attempts.clear();
        if (this._cancellable) {
            this._cancellable.cancel();
            this._cancellable = null;
        }
        if (this._session) {
            this._session.abort();
            this._session = null;
        }
    }
}
