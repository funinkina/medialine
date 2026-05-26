import GObject from 'gi://GObject';
import St from 'gi://St';
import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import Clutter from 'gi://Clutter';
import Pango from 'gi://Pango';

import { Extension, gettext as _ } from 'resource:///org/gnome/shell/extensions/extension.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import { ExtensionSettings } from './helpers/settings.js';
import { MprisManager } from './helpers/mprisManager.js';

const ICON_TYPE_APP = 0;
const ICON_TYPE_ART = 1;
const ICON_TYPE_STATUS = 2;

const ART_SIZE = 64;
const PROGRESS_HEIGHT = 4;
const POPUP_MIN_WIDTH = 320;

function formatTime(microseconds) {
    if (!microseconds || microseconds < 0) return '0:00';
    const totalSeconds = Math.floor(microseconds / 1_000_000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

const Indicator = GObject.registerClass(
    class Indicator extends PanelMenu.Button {
        _init(preferences, extension, mprisManager) {
            super._init(0.5, _('Media Bar'));

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

            this._buildUI();
            this._setupMenu();

            this._mediaChangedId = this._mprisManager.connect('media-changed', () => {
                this._onMediaChanged();
            });

            this._prefsChangedId = this._preferences.connectChanged(() => {
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
                style: `margin-right: ${this._preferences.iconSpacing}px;`,
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

        _setupMenu() {
            const item = new PopupMenu.PopupBaseMenuItem({
                reactive: false,
                can_focus: false,
                activate: false,
                hover: false,
                style_class: 'media-bar-popup-item',
            });
            item.setOrnament(PopupMenu.Ornament.HIDDEN);

            item.style = 'padding: 8px 6px;';

            const container = new St.BoxLayout({
                vertical: true,
                x_expand: true,
                style: `spacing: 12px; min-width: ${POPUP_MIN_WIDTH}px;`,
            });

            const topRow = new St.BoxLayout({
                x_expand: true,
                style: 'spacing: 12px;',
            });

            this._popupArt = new St.Bin({
                style: `width: ${ART_SIZE}px; height: ${ART_SIZE}px; min-width: ${ART_SIZE}px; min-height: ${ART_SIZE}px; border-radius: 6px; background-color: rgba(255,255,255,0.08); background-size: cover; background-position: center;`,
            });
            this._popupArtFallback = new St.Icon({
                icon_name: 'audio-x-generic-symbolic',
                icon_size: ART_SIZE - 24,
                x_align: Clutter.ActorAlign.CENTER,
                y_align: Clutter.ActorAlign.CENTER,
            });
            this._popupArt.set_child(this._popupArtFallback);

            const textBox = new St.BoxLayout({
                vertical: true,
                x_expand: true,
                y_expand: false,
                y_align: Clutter.ActorAlign.CENTER,
                style: 'spacing: 4px;',
            });
            this._popupTitle = new St.Label({
                text: '',
                style: 'font-weight: 700; font-size: 16px; color: white;',
                // y_align: Clutter.ActorAlign.CENTER,
            });
            this._popupTitle.clutter_text.ellipsize = Pango.EllipsizeMode.END;
            this._popupArtist = new St.Label({
                text: '',
                style: 'font-size: 14px; color: rgba(255,255,255,0.7);',
                // y_align: Clutter.ActorAlign.CENTER,
            });
            this._popupArtist.clutter_text.ellipsize = Pango.EllipsizeMode.END;
            this._popupAlbum = new St.Label({
                text: '',
                style: 'font-size: 12px; color: rgba(255,255,255,0.5);',
            });
            this._popupAlbum.clutter_text.ellipsize = Pango.EllipsizeMode.END;
            textBox.add_child(this._popupTitle);
            textBox.add_child(this._popupArtist);
            textBox.add_child(this._popupAlbum);

            topRow.add_child(this._popupArt);
            topRow.add_child(textBox);

            const progressSection = new St.BoxLayout({
                vertical: true,
                x_expand: true,
                style: 'spacing: 4px;',
            });

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
            this._allocationId = this._progressTrack.connect('notify::allocation',
                () => this._updateProgress());

            const timeRow = new St.BoxLayout({ x_expand: true });
            this._timeCurrent = new St.Label({
                text: '0:00',
                style: 'font-size: 11px; opacity: 0.7;',
            });
            this._timeTotal = new St.Label({
                text: '0:00',
                style: 'font-size: 11px; opacity: 0.7;',
                x_align: Clutter.ActorAlign.END,
                x_expand: true,
            });
            timeRow.add_child(this._timeCurrent);
            timeRow.add_child(this._timeTotal);

            progressSection.add_child(timeRow);
            progressSection.add_child(this._progressTrack);

            const controlsRow = new St.BoxLayout({
                x_expand: true,
                x_align: Clutter.ActorAlign.CENTER,
                style: 'spacing: 24px;',
            });

            this._prevBtn = this._makeControlButton(
                'media-skip-backward-symbolic', 18,
                () => this._mprisManager.previous()
            );
            this._playBtn = this._makeControlButton(
                'media-playback-start-symbolic', 24,
                () => this._mprisManager.playPause()
            );
            this._nextBtn = this._makeControlButton(
                'media-skip-forward-symbolic', 18,
                () => this._mprisManager.next()
            );

            controlsRow.add_child(this._prevBtn);
            controlsRow.add_child(this._playBtn);
            controlsRow.add_child(this._nextBtn);

            container.add_child(topRow);
            container.add_child(progressSection);
            container.add_child(controlsRow);

            item.add_child(container);
            this.menu.addMenuItem(item);

            this._menuOpenStateId = this.menu.connect('open-state-changed',
                (_m, open) => {
                    if (open) this._startPositionPolling();
                    else this._stopPositionPolling();
                });
        }

        _makeControlButton(iconName, iconSize, onClick) {
            const BASE_STYLE = 'width: 40px; height: 40px; border-radius: 8px; color: white;';
            const HOVER_STYLE = `${BASE_STYLE} background-color: rgba(255,255,255,0.15);`;
            const btn = new St.Button({
                can_focus: true,
                track_hover: true,
                reactive: true,
                style_class: 'media-bar-control-button',
                style: BASE_STYLE,
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
            btn.connect('notify::hover', () => {
                btn.style = btn.hover ? HOVER_STYLE : BASE_STYLE;
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
            let ratio = 0;
            if (length > 0) ratio = Math.max(0, Math.min(1, position / length));
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

            const separator = prefs.separator;
            this._label.text = parts.join(separator);

            const maxWidth = prefs.maxTextWidth;
            if (maxWidth > 0) {
                this._label.style = `max-width: ${maxWidth}px;`;
            } else {
                this._label.style = '';
            }

            this._iconActor.style = `margin-right: ${prefs.iconSpacing}px;`;
            this._iconActor.icon_size = prefs.iconSize;

            this._updateIcon(media, prefs);
            this._updatePopup(media);
        }

        _updatePopup(media) {
            this._popupTitle.text = media.title || _('Unknown');
            this._popupArtist.text = media.artist || '';
            this._popupAlbum.text = media.album || '';
            this._popupAlbum.visible = !!media.album;

            const playIcon = media.status === 'Playing'
                ? 'media-playback-pause-symbolic'
                : 'media-playback-start-symbolic';
            this._playBtn.get_child().icon_name = playIcon;

            this._prevBtn.reactive = media.canGoPrevious !== false;
            this._nextBtn.reactive = media.canGoNext !== false;
            this._prevBtn.opacity = this._prevBtn.reactive ? 255 : 110;
            this._nextBtn.opacity = this._nextBtn.reactive ? 255 : 110;

            this._updatePopupArt(media);
            this._updateProgress();
        }

        _updatePopupArt(media) {
            const artUrl = media.artUrl || '';
            const cacheKey = `${artUrl}::${media.status}`;
            if (cacheKey === this._currentPopupArtUrl) return;
            this._currentPopupArtUrl = cacheKey;

            const baseStyle = `width: ${ART_SIZE}px; height: ${ART_SIZE}px; min-width: ${ART_SIZE}px; min-height: ${ART_SIZE}px; border-radius: 6px; background-color: rgba(255,255,255,0.08); background-size: cover; background-position: center;`;

            if (artUrl && artUrl.startsWith('file://')) {
                try {
                    const path = GLib.uri_unescape_string(
                        artUrl.substring('file://'.length), null);
                    const safePath = path.replace(/"/g, '\\"');
                    this._popupArt.set_child(null);
                    this._popupArt.style = `${baseStyle} background-image: url("${safePath}");`;
                    return;
                } catch (_) { /* fall through */ }
            }

            this._popupArt.style = baseStyle;
            const useStatusIcon = this._preferences.iconType === ICON_TYPE_STATUS;
            if (useStatusIcon) {
                const iconName = media.status === 'Playing'
                    ? 'media-playback-start-symbolic'
                    : 'media-playback-pause-symbolic';
                if (this._popupArtFallback.icon_name !== iconName)
                    this._popupArtFallback.icon_name = iconName;
            } else {
                this._popupArtFallback.icon_name = 'audio-x-generic-symbolic';
            }
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
                    } catch (e) {
                        this._setAppIcon(media.busName);
                    }
                }
                return;
            }

            this._currentArtUrl = null;
            this._setAppIcon(media.busName);
        }

        _setAppIcon(busName) {
            const appId = busName
                ? busName.replace('org.mpris.MediaPlayer2.', '').toLowerCase()
                : '';

            this._iconActor.gicon = null;
            this._iconActor.icon_name = appId || 'audio-x-generic-symbolic';
        }

        destroy() {
            this._stopPositionPolling();

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
                this._preferences.disconnectChanged(this._prefsChangedId);
                this._prefsChangedId = null;
            }

            super.destroy();
        }
    });

export default class MediaBarExtension extends Extension {
    enable() {
        this._preferences = new ExtensionSettings(this);
        this._mprisManager = new MprisManager();
        this._indicator = null;
        this._enableTimeoutId = null;

        this._positionChangedId = this._preferences._settings.connect(
            'changed',
            (_settings, key) => {
                if (key === 'panel-position' || key === 'panel-index')
                    this._updateIndicatorPosition();
            }
        );

        this._enableTimeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 500, () => {
            if (this._preferences && this._mprisManager) {
                const position = ['left', 'center', 'right'][this._preferences.panelPosition] || 'right';
                const index = this._preferences.panelIndex || 0;
                this._indicator = new Indicator(this._preferences, this, this._mprisManager);
                Main.panel.addToStatusArea(this.uuid, this._indicator, index, position);
            }
            this._enableTimeoutId = null;
            return GLib.SOURCE_REMOVE;
        });
    }

    _updateIndicatorPosition() {
        if (!this._indicator) return;

        const positionName = ['left', 'center', 'right'][this._preferences.panelPosition] || 'right';
        const index = this._preferences.panelIndex || 0;

        const boxes = {
            left: Main.panel._leftBox,
            center: Main.panel._centerBox,
            right: Main.panel._rightBox,
        };
        const targetBox = boxes[positionName];
        if (!targetBox) return;

        const container = this._indicator.container ?? this._indicator;
        const currentParent = container.get_parent();
        if (currentParent === targetBox) {
            currentParent.set_child_at_index(container, index);
            return;
        }
        if (currentParent) currentParent.remove_child(container);
        targetBox.insert_child_at_index(container, index);
    }

    disable() {
        if (this._enableTimeoutId) {
            GLib.Source.remove(this._enableTimeoutId);
            this._enableTimeoutId = null;
        }

        if (this._positionChangedId) {
            this._preferences._settings.disconnect(this._positionChangedId);
            this._positionChangedId = null;
        }

        if (this._indicator) {
            this._indicator.destroy();
            this._indicator = null;
        }

        if (this._mprisManager) {
            this._mprisManager.destroy();
            this._mprisManager = null;
        }

        this._preferences = null;
    }
}
