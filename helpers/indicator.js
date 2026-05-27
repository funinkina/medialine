import GObject from 'gi://GObject';
import St from 'gi://St';
import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import Clutter from 'gi://Clutter';
import Pango from 'gi://Pango';

import { gettext as _ } from 'resource:///org/gnome/shell/extensions/extension.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

import {
    ICON_TYPE_ART, ICON_TYPE_STATUS,
    CLICK_NOTHING, CLICK_OPEN_POPUP, CLICK_PLAY_PAUSE, CLICK_OPEN_SETTINGS,
    CLICK_NEXT_TRACK, CLICK_PREV_TRACK, CLICK_VOLUME_UP, CLICK_VOLUME_DOWN,
    ART_SIZE, PROGRESS_HEIGHT, POPUP_MIN_WIDTH, POPUP_MAX_WIDTH,
} from './constants.js';

const POPUP_ART_BASE_STYLE = `width: ${ART_SIZE}px; height: ${ART_SIZE}px; min-width: ${ART_SIZE}px; min-height: ${ART_SIZE}px; border-radius: 6px; background-color: rgba(255,255,255,0.08); background-size: cover; background-position: center;`;
const CONTROL_BTN_STYLE = 'width: 40px; height: 40px; border-radius: 8px; color: white;';
const CONTROL_BTN_HOVER_STYLE = `${CONTROL_BTN_STYLE} background-color: rgba(255,255,255,0.15);`;
const CONTROL_BTN_ACTIVE_STYLE = `${CONTROL_BTN_STYLE} background-color: rgba(255,255,255,0.22);`;
const TIME_LABEL_STYLE = 'font-size: 11px; color: rgba(255,255,255,0.8);';

function formatTime(microseconds) {
    if (!microseconds || microseconds < 0) return '0:00';
    const totalSeconds = Math.floor(microseconds / 1_000_000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

export const Indicator = GObject.registerClass(
    class Indicator extends PanelMenu.Button {
        _init(preferences, extension, mprisManager) {
            super._init(0.5, _('Medialine'));

            this._preferences = preferences;
            this._extension = extension;
            this._mprisManager = mprisManager;
            this._mediaChangedId = null;
            this._prefsChangedId = null;
            this._currentArtUrl = null;
            this._currentPopupArtUrl = null;
            this._positionTimerId = null;
            this._menuOpenStateId = null;
            this._allocationId = null;
            this._buttonPressId = null;

            this._buildUI();
            this._setupMenu();
            this._setupClickHandling();

            this._mediaChangedId = this._mprisManager.connect('media-changed', () => {
                this._onMediaChanged();
            });

            this._prefsChangedId = this._preferences.connect('changed', () => {
                this._onMediaChanged();
            });

            this._onMediaChanged();
        }

        _buildUI() {
            this._box = new St.BoxLayout({
                x_expand: false,
                y_expand: true,
                y_align: Clutter.ActorAlign.CENTER,
            });

            this._iconActor = new St.Icon({
                icon_name: 'audio-x-generic-symbolic',
                icon_size: this._preferences.iconSize,
                y_align: Clutter.ActorAlign.CENTER,
                style: `margin-right: ${this._preferences.iconSpacing}px; border-radius: 4px;`,
            });

            this._label = new St.Label({
                text: '',
                y_align: Clutter.ActorAlign.CENTER,
            });
            this._label.clutter_text.ellipsize = Pango.EllipsizeMode.END;

            this._box.add_child(this._iconActor);
            this._box.add_child(this._label);
            this.add_child(this._box);
        }

        _buildTopRow() {
            this._popupArt = new St.Bin({ style: POPUP_ART_BASE_STYLE });
            this._popupArtFallback = new St.Icon({
                icon_name: 'audio-x-generic-symbolic',
                icon_size: ART_SIZE - 24,
                x_align: Clutter.ActorAlign.CENTER,
                y_align: Clutter.ActorAlign.CENTER,
            });
            this._popupArt.set_child(this._popupArtFallback);

            this._popupTitle = new St.Label({
                text: '',
                x_expand: true,
                style: 'font-weight: 700; font-size: 16px; color: white;',
            });
            this._popupTitle.clutter_text.ellipsize = Pango.EllipsizeMode.END;

            this._popupArtist = new St.Label({
                text: '',
                x_expand: true,
                style: 'font-size: 14px; color: white;',
            });
            this._popupArtist.clutter_text.ellipsize = Pango.EllipsizeMode.END;

            this._popupAlbum = new St.Label({
                text: '',
                x_expand: true,
                style: 'font-size: 12px; color: rgba(255,255,255,0.7);',
            });
            this._popupAlbum.clutter_text.ellipsize = Pango.EllipsizeMode.END;

            const textBox = new St.BoxLayout({
                vertical: true,
                x_expand: true,
                y_expand: false,
                y_align: Clutter.ActorAlign.CENTER,
                style: 'spacing: 4px;',
            });
            textBox.add_child(this._popupTitle);
            textBox.add_child(this._popupArtist);
            textBox.add_child(this._popupAlbum);

            const topRow = new St.BoxLayout({ x_expand: true, style: 'spacing: 12px;' });
            topRow.add_child(this._popupArt);
            topRow.add_child(textBox);
            return topRow;
        }

        _buildProgressSection() {
            this._timeCurrent = new St.Label({ text: '0:00', style: TIME_LABEL_STYLE });
            this._timeTotal = new St.Label({
                text: '0:00',
                style: TIME_LABEL_STYLE,
                x_align: Clutter.ActorAlign.END,
                x_expand: true,
            });
            const timeRow = new St.BoxLayout({ x_expand: true });
            timeRow.add_child(this._timeCurrent);
            timeRow.add_child(this._timeTotal);

            this._progressTrack = new St.Widget({
                x_expand: true,
                y_align: Clutter.ActorAlign.CENTER,
                style: `background-color: rgba(255,255,255,0.18); border-radius: ${PROGRESS_HEIGHT / 2}px; height: ${PROGRESS_HEIGHT}px;`,
                height: PROGRESS_HEIGHT,
            });
            this._progressFill = new St.Widget({
                style: `background-color: rgba(255,255,255,0.9); border-radius: ${PROGRESS_HEIGHT / 2}px;`,
                width: 0,
                height: PROGRESS_HEIGHT,
            });
            this._progressFill.set_position(0, 0);
            this._progressTrack.add_child(this._progressFill);
            this._allocationId = this._progressTrack.connect(
                'notify::allocation', () => this._updateProgress());

            const section = new St.BoxLayout({
                vertical: true,
                x_expand: true,
                style: 'spacing: 4px;',
            });
            section.add_child(timeRow);
            section.add_child(this._progressTrack);
            return section;
        }

        _buildControlsRow() {
            this._shuffleBtn = this._makeControlButton(
                'media-playlist-shuffle-symbolic', 16, () => this._toggleShuffle());
            this._prevBtn = this._makeControlButton(
                'media-skip-backward-symbolic', 18, () => this._mprisManager.previous());
            this._playBtn = this._makeControlButton(
                'media-playback-start-symbolic', 24, () => this._mprisManager.playPause());
            this._nextBtn = this._makeControlButton(
                'media-skip-forward-symbolic', 18, () => this._mprisManager.next());
            this._repeatBtn = this._makeControlButton(
                'media-playlist-repeat-symbolic', 16, () => this._cycleRepeat());

            const row = new St.BoxLayout({
                x_expand: true,
                x_align: Clutter.ActorAlign.CENTER,
                style: 'spacing: 16px;',
            });
            row.add_child(this._shuffleBtn);
            row.add_child(this._prevBtn);
            row.add_child(this._playBtn);
            row.add_child(this._nextBtn);
            row.add_child(this._repeatBtn);
            return row;
        }

        _toggleShuffle() {
            const media = this._mprisManager.currentMedia;
            if (!media || media.shuffle === null || !media.canControl) return;
            this._mprisManager.setShuffle(!media.shuffle);
        }

        _cycleRepeat() {
            const media = this._mprisManager.currentMedia;
            if (!media || media.loopStatus === null || !media.canControl) return;
            const order = ['None', 'Track', 'Playlist'];
            const idx = order.indexOf(media.loopStatus);
            const next = order[(idx >= 0 ? idx + 1 : 1) % order.length];
            this._mprisManager.setLoopStatus(next);
        }

        _setupMenu() {
            const item = new PopupMenu.PopupBaseMenuItem({
                reactive: false,
                can_focus: false,
                activate: false,
                hover: false,
                style_class: 'medialine-popup-item',
            });
            item.setOrnament(PopupMenu.Ornament.HIDDEN);
            item.style = 'padding: 8px 6px;';

            const container = new St.BoxLayout({
                vertical: true,
                x_expand: true,
                style: `spacing: 12px; min-width: ${POPUP_MIN_WIDTH}px; max-width: ${POPUP_MAX_WIDTH}px;`,
            });
            container.add_child(this._buildTopRow());
            container.add_child(this._buildProgressSection());
            container.add_child(this._buildControlsRow());

            item.add_child(container);
            this.menu.addMenuItem(item);

            this._menuOpenStateId = this.menu.connect('open-state-changed',
                (_m, open) => {
                    if (open) this._startPositionPolling();
                    else this._stopPositionPolling();
                });
        }

        _setupClickHandling() {
            if (this._clickGesture)
                this._clickGesture.set_enabled(false);

            this._buttonPressId = this.connect('button-press-event',
                (_actor, event) => this._handleButtonPress(event));
        }

        _handleButtonPress(event) {
            const button = event.get_button();
            let action;
            if (button === Clutter.BUTTON_PRIMARY)
                action = this._preferences.leftClickAction;
            else if (button === Clutter.BUTTON_MIDDLE)
                action = this._preferences.middleClickAction;
            else if (button === Clutter.BUTTON_SECONDARY)
                action = this._preferences.rightClickAction;
            else
                return Clutter.EVENT_PROPAGATE;

            if (action === CLICK_OPEN_POPUP) {
                this.menu.toggle();
                return Clutter.EVENT_STOP;
            }

            if (action !== CLICK_NOTHING)
                this._executeClickAction(action);

            return Clutter.EVENT_STOP;
        }

        _executeClickAction(action) {
            switch (action) {
                case CLICK_PLAY_PAUSE: this._mprisManager.playPause(); break;
                case CLICK_OPEN_SETTINGS: this._extension.openPreferences(); break;
                case CLICK_NEXT_TRACK: this._mprisManager.next(); break;
                case CLICK_PREV_TRACK: this._mprisManager.previous(); break;
                case CLICK_VOLUME_UP: this._adjustVolume(5); break;
                case CLICK_VOLUME_DOWN: this._adjustVolume(-5); break;
            }
        }

        _adjustVolume(deltaPct) {
            try {
                const arg = deltaPct > 0 ? `+${deltaPct}%` : `${deltaPct}%`;
                Gio.Subprocess.new(
                    ['pactl', 'set-sink-volume', '@DEFAULT_SINK@', arg],
                    Gio.SubprocessFlags.NONE
                );
            } catch (_) { }
        }

        _makeControlButton(iconName, iconSize, onClick) {
            const btn = new St.Button({
                can_focus: true,
                track_hover: true,
                reactive: true,
                style_class: 'medialine-control-button',
                style: CONTROL_BTN_STYLE,
                x_align: Clutter.ActorAlign.CENTER,
                y_align: Clutter.ActorAlign.CENTER,
            });
            btn.set_child(new St.Icon({
                icon_name: iconName,
                icon_size: iconSize,
                style: 'color: white;',
                x_align: Clutter.ActorAlign.CENTER,
                y_align: Clutter.ActorAlign.CENTER,
            }));
            btn._active = false;
            btn.connect('notify::hover', () => {
                btn.style = btn.hover
                    ? CONTROL_BTN_HOVER_STYLE
                    : (btn._active ? CONTROL_BTN_ACTIVE_STYLE : CONTROL_BTN_STYLE);
            });
            btn.connect('clicked', onClick);
            return btn;
        }

        _startPositionPolling() {
            this._updateProgress();
            if (this._positionTimerId) return;
            this._positionTimerId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 1000, () => {
                this._updateProgress();
                return GLib.SOURCE_CONTINUE;
            });
        }

        _stopPositionPolling() {
            if (this._positionTimerId) {
                GLib.Source.remove(this._positionTimerId);
                this._positionTimerId = null;
            }
        }

        _updateProgress() {
            const media = this._mprisManager.currentMedia;
            if (!media) {
                this._timeCurrent.text = '0:00';
                this._timeTotal.text = '0:00';
                this._progressFill.width = 0;
                return;
            }
            const position = this._mprisManager.getPosition();
            const length = media.length || 0;
            this._timeCurrent.text = formatTime(position);
            this._timeTotal.text = formatTime(length);

            const alloc = this._progressTrack.get_allocation_box();
            const trackWidth = alloc ? Math.max(0, alloc.x2 - alloc.x1) : 0;
            const ratio = length > 0 ? Math.max(0, Math.min(1, position / length)) : 0;
            this._progressFill.set_position(0, 0);
            this._progressFill.width = Math.floor(ratio * trackWidth);
        }

        _onMediaChanged() {
            const media = this._mprisManager.currentMedia;

            if (!media || media.status === 'Stopped') {
                this.hide();
                this._stopPositionPolling();
                return;
            }

            this.show();

            const prefs = this._preferences;
            const parts = [];
            if (prefs.showTitle && media.title) parts.push(media.title);
            if (prefs.showArtist && media.artist) parts.push(media.artist);
            if (prefs.showAlbum && media.album) parts.push(media.album);

            this._label.text = parts.join(prefs.separator);
            this._label.style = prefs.maxTextWidth > 0
                ? `max-width: ${prefs.maxTextWidth}px;`
                : '';

            this._iconActor.style = `margin-right: ${prefs.iconSpacing}px; border-radius: 4px;`;
            this._iconActor.icon_size = prefs.iconSize;

            this._updateIcon(media, prefs);
            this._updatePopup(media);
        }

        _updatePopup(media) {
            this._popupTitle.text = media.title || _('Unknown');
            this._popupArtist.text = media.artist || '';
            this._popupAlbum.text = media.album || '';
            this._popupAlbum.visible = !!media.album;

            this._playBtn.get_child().icon_name = media.status === 'Playing'
                ? 'media-playback-pause-symbolic'
                : 'media-playback-start-symbolic';

            this._prevBtn.reactive = media.canGoPrevious !== false;
            this._nextBtn.reactive = media.canGoNext !== false;
            this._prevBtn.opacity = this._prevBtn.reactive ? 255 : 110;
            this._nextBtn.opacity = this._nextBtn.reactive ? 255 : 110;

            const shuffleAvail = media.shuffle !== null && media.canControl;
            this._shuffleBtn.reactive = shuffleAvail;
            this._shuffleBtn.opacity = shuffleAvail ? 255 : 110;
            this._shuffleBtn._active = shuffleAvail && media.shuffle;
            this._shuffleBtn.style = this._shuffleBtn._active ? CONTROL_BTN_ACTIVE_STYLE : CONTROL_BTN_STYLE;

            const repeatAvail = media.loopStatus !== null && media.canControl;
            this._repeatBtn.reactive = repeatAvail;
            this._repeatBtn.opacity = repeatAvail ? 255 : 110;
            this._repeatBtn.get_child().icon_name = media.loopStatus === 'Track'
                ? 'media-playlist-repeat-song-symbolic'
                : 'media-playlist-repeat-symbolic';
            this._repeatBtn._active = repeatAvail && media.loopStatus !== 'None';
            this._repeatBtn.style = this._repeatBtn._active ? CONTROL_BTN_ACTIVE_STYLE : CONTROL_BTN_STYLE;

            this._updatePopupArt(media);
            this._updateProgress();
        }

        _updatePopupArt(media) {
            const artUrl = media.artUrl || '';
            const cacheKey = `${artUrl}::${media.status}`;
            if (cacheKey === this._currentPopupArtUrl) return;
            this._currentPopupArtUrl = cacheKey;

            if (artUrl && artUrl.startsWith('file://')) {
                try {
                    const path = GLib.uri_unescape_string(artUrl.substring('file://'.length), null);
                    const safePath = path.replace(/"/g, '\\"');
                    this._popupArt.set_child(null);
                    this._popupArt.style = `${POPUP_ART_BASE_STYLE} background-image: url("${safePath}");`;
                    return;
                } catch (_) { /* fall through to fallback icon */ }
            }

            this._popupArt.style = POPUP_ART_BASE_STYLE;
            this._popupArtFallback.icon_name = this._preferences.iconType === ICON_TYPE_STATUS
                ? (media.status === 'Playing'
                    ? 'media-playback-start-symbolic'
                    : 'media-playback-pause-symbolic')
                : 'audio-x-generic-symbolic';
            if (this._popupArt.get_child() !== this._popupArtFallback)
                this._popupArt.set_child(this._popupArtFallback);
        }

        _updateIcon(media, prefs) {
            if (prefs.iconType === ICON_TYPE_STATUS) {
                this._currentArtUrl = null;
                this._iconActor.gicon = null;
                this._iconActor.icon_name = media.status === 'Playing'
                    ? 'media-playback-start-symbolic'
                    : 'media-playback-pause-symbolic';
                return;
            }

            if (prefs.iconType === ICON_TYPE_ART &&
                media.artUrl && media.artUrl.startsWith('file://')) {
                if (media.artUrl !== this._currentArtUrl) {
                    this._currentArtUrl = media.artUrl;
                    try {
                        const file = Gio.File.new_for_uri(media.artUrl);
                        this._iconActor.gicon = new Gio.FileIcon({ file });
                    } catch (_) {
                        this._setAppIcon(media);
                    }
                }
                return;
            }

            this._currentArtUrl = null;
            this._setAppIcon(media);
        }

        _setAppIcon(media) {
            this._iconActor.icon_name = null;
            this._iconActor.gicon = null;

            const gicon = this._lookupAppGicon(media);
            if (gicon) {
                this._iconActor.gicon = gicon;
                return;
            }
            this._iconActor.icon_name = 'audio-x-generic-symbolic';
        }

        _lookupAppGicon(media) {
            if (!media) return null;

            const candidates = [];
            const push = (v) => { if (v) candidates.push(v); };

            push(media.desktopEntry);
            if (media.identity) {
                push(media.identity);
                push(media.identity.toLowerCase().replace(/\s+/g, '-'));
                push(media.identity.toLowerCase().replace(/\s+/g, ''));
            }
            if (media.busName) {
                const tail = media.busName.replace('org.mpris.MediaPlayer2.', '');
                push(tail);
                push(tail.split('.')[0]);
            }

            const ids = candidates.map(c =>
                c.endsWith('.desktop') ? c : `${c}.desktop`);

            for (const id of ids) {
                const info = Gio.DesktopAppInfo.new(id);
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

            return null;
        }

        destroy() {
            this._stopPositionPolling();

            if (this._buttonPressId) {
                this.disconnect(this._buttonPressId);
                this._buttonPressId = null;
            }

            if (this._allocationId && this._progressTrack) {
                this._progressTrack.disconnect(this._allocationId);
                this._allocationId = null;
            }

            if (this._menuOpenStateId) {
                this.menu.disconnect(this._menuOpenStateId);
                this._menuOpenStateId = null;
            }

            if (this._mediaChangedId) {
                this._mprisManager.disconnect(this._mediaChangedId);
                this._mediaChangedId = null;
            }

            if (this._prefsChangedId) {
                this._preferences.disconnect(this._prefsChangedId);
                this._prefsChangedId = null;
            }

            super.destroy();
        }
    });
