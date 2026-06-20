import GObject from 'gi://GObject';
import St from 'gi://St';
import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import GioUnix from 'gi://GioUnix';
import GdkPixbuf from 'gi://GdkPixbuf';
import Clutter from 'gi://Clutter';
import Pango from 'gi://Pango';
import Gvc from 'gi://Gvc';
import Shell from 'gi://Shell';

import { gettext as _ } from 'resource:///org/gnome/shell/extensions/extension.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {
    ICON_TYPE_ART, ICON_TYPE_STATUS, ICON_TYPE_CUSTOM,
    CLICK_NOTHING, CLICK_OPEN_POPUP, CLICK_PLAY_PAUSE, CLICK_OPEN_SETTINGS,
    CLICK_NEXT_TRACK, CLICK_PREV_TRACK, CLICK_VOLUME_UP, CLICK_VOLUME_DOWN, CLICK_RAISE_PLAYER,
    ART_SIZE, PROGRESS_HEIGHT, PROGRESS_THUMB_SIZE, POPUP_MIN_WIDTH, POPUP_MAX_WIDTH,
} from './constants.js';

const POPUP_ART_MAX_W = 120;
const POPUP_ART_MAX_H = ART_SIZE;
const SCROLL_NOTCH = 1.0;

function hexToRgba(hex, alpha) {
    const h = hex.replace('#', '');
    const r = parseInt(h.substring(0, 2), 16);
    const g = parseInt(h.substring(2, 4), 16);
    const b = parseInt(h.substring(4, 6), 16);
    return `rgba(${r},${g},${b},${alpha})`;
}

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
            this._currentArtUrl = null;
            this._currentPopupArtUrl = null;
            this._positionTimerId = null;
            this._position = 0;
            this._dragging = false;
            this._dragRatio = 0;
            this._scrollAccum = 0;
            this._destroyed = false;
            this._mixer = null;
            this._pendingVolumeDelta = 0;
            this._controlButtons = [];
            this._controlIcons = [];
            this._pidCache = new Map();
            this._pendingPidLookups = new Set();
            this._windowClassCache = new Map();

            this._initPopupColors();
            this._buildUI();
            this._setupMenu();
            this._setupClickHandling();

            this._mprisManager.connectObject('media-changed',
                () => this._onMediaChanged(), this);

            this._preferences.connectObject('changed',
                () => this._onMediaChanged(), this);

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

        _initPopupColors() {
            const primary = this._preferences.popupPrimaryColor;
            const secondary = this._preferences.popupSecondaryColor;
            const bgColor = this._preferences.popupBackgroundColor;
            this._popupBgActive = false;
            this._extractedArtColorUrl = null;
            this._extractedArtColor = null;
            this._popupStyles = {
                primary,
                secondary,
                popupBg: bgColor ? `background-color: ${bgColor};` : '',
                artCommon: `border-radius: 6px; background-color: ${hexToRgba(secondary, 0.08)}; background-size: contain; background-repeat: no-repeat; background-position: center;`,
                artFallback: `width: ${ART_SIZE}px; height: ${ART_SIZE}px; min-width: ${ART_SIZE}px; min-height: ${ART_SIZE}px; border-radius: 6px; background-color: ${hexToRgba(secondary, 0.08)}; background-size: contain; background-repeat: no-repeat; background-position: center;`,
                title: `font-weight: 700; font-size: 16px; color: ${primary};`,
                subtitle: `font-size: 14px; color: ${primary};`,
                btn: `width: 40px; height: 40px; border-radius: 8px; color: ${primary};`,
                btnHover: `width: 40px; height: 40px; border-radius: 8px; color: ${primary}; background-color: ${hexToRgba(secondary, 0.15)};`,
                btnActive: `width: 40px; height: 40px; border-radius: 8px; color: ${primary}; background-color: ${hexToRgba(secondary, 0.22)};`,
                time: `font-size: 11px; color: ${hexToRgba(primary, 0.8)};`,
                progressTrack: `background-color: ${hexToRgba(secondary, 0.18)}; border-radius: ${PROGRESS_HEIGHT / 2}px; height: ${PROGRESS_HEIGHT}px;`,
                progressFill: `background-color: ${hexToRgba(primary, 0.9)}; border-radius: ${PROGRESS_HEIGHT / 2}px;`,
                progressThumb: `background-color: ${primary}; border-radius: ${PROGRESS_THUMB_SIZE / 2}px;`,
                iconColor: `color: ${primary};`,
                separator: `height: 1px; background-color: ${hexToRgba(secondary, 0.15)};`,
                compactBtn: `width: 32px; height: 32px; border-radius: 8px; color: ${primary};`,
                compactBtnHover: `width: 32px; height: 32px; border-radius: 8px; color: ${primary}; background-color: ${hexToRgba(secondary, 0.15)};`,
            };
        }

        _buildTopRow() {
            this._popupArt = new St.Widget({
                layout_manager: new Clutter.FixedLayout(),
                style: this._popupStyles.artFallback,
                reactive: true,
            });
            this._popupArt.connectObject(
                'button-release-event', (_a, event) => {
                    if (event.type() === Clutter.EventType.BUTTON_RELEASE) {
                        this._focusPlayerWindow(this._mprisManager.currentMedia);
                        return Clutter.EVENT_STOP;
                    }
                    return Clutter.EVENT_PROPAGATE;
                },
                this
            );

            this._popupArtAppIcon = new St.Icon({
                icon_name: 'audio-x-generic-symbolic',
                icon_size: 40,
            });
            this._popupArt.add_child(this._popupArtAppIcon);

            this._popupTitle = new St.Label({
                text: '',
                x_expand: true,
                style: this._popupStyles.title,
            });
            this._popupTitle.clutter_text.ellipsize = Pango.EllipsizeMode.END;

            this._popupSubtitle = new St.Label({
                text: '',
                x_expand: true,
                style: this._popupStyles.subtitle,
            });
            this._popupSubtitle.clutter_text.use_markup = true;
            this._popupSubtitle.clutter_text.ellipsize = Pango.EllipsizeMode.END;

            const textBox = new St.BoxLayout({
                vertical: true,
                x_expand: true,
                y_expand: false,
                y_align: Clutter.ActorAlign.CENTER,
                style: 'spacing: 4px;',
            });
            textBox.add_child(this._popupTitle);
            textBox.add_child(this._popupSubtitle);

            const topRow = new St.BoxLayout({ x_expand: true, style: 'spacing: 12px;' });
            topRow.add_child(this._popupArt);
            topRow.add_child(textBox);
            return topRow;
        }

        _buildProgressSection() {
            this._timeCurrent = new St.Label({ text: '0:00', style: this._popupStyles.time });
            this._timeTotal = new St.Label({
                text: '0:00',
                style: this._popupStyles.time,
                x_align: Clutter.ActorAlign.END,
                x_expand: true,
            });
            const timeRow = new St.BoxLayout({ x_expand: true });
            timeRow.add_child(this._timeCurrent);
            timeRow.add_child(this._timeTotal);

            this._progressTrack = new St.Widget({
                x_expand: true,
                y_align: Clutter.ActorAlign.CENTER,
                reactive: true,
                track_hover: true,
                style: this._popupStyles.progressTrack,
                height: PROGRESS_HEIGHT,
            });
            this._progressFill = new St.Widget({
                style: this._popupStyles.progressFill,
                width: 0,
                height: PROGRESS_HEIGHT,
            });
            this._progressFill.set_position(0, 0);
            this._progressThumb = new St.Widget({
                style: this._popupStyles.progressThumb,
                width: PROGRESS_THUMB_SIZE,
                height: PROGRESS_THUMB_SIZE,
                visible: false,
            });
            this._progressThumb.set_position(
                -PROGRESS_THUMB_SIZE / 2,
                (PROGRESS_HEIGHT - PROGRESS_THUMB_SIZE) / 2);
            this._progressTrack.add_child(this._progressFill);
            this._progressTrack.add_child(this._progressThumb);
            this._progressTrack.connectObject(
                'notify::allocation', () => this._updateProgress(),
                'button-press-event', (_a, event) => this._onProgressPress(event),
                'motion-event', (_a, event) => this._onProgressMotion(event),
                'button-release-event', (_a, event) => this._onProgressRelease(event),
                'notify::hover', () => this._updateProgress(),
                this);

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
            item.style = 'padding: 8px 6px 4px 6px;';

            const container = new St.BoxLayout({
                vertical: true,
                x_expand: true,
                style: `spacing: 12px; min-width: ${POPUP_MIN_WIDTH}px; max-width: ${POPUP_MAX_WIDTH}px;`,
            });

            this._richContainer = new St.BoxLayout({
                vertical: true,
                x_expand: true,
                style: 'spacing: 12px;',
            });
            this._richContainer.add_child(this._buildTopRow());
            this._richContainer.add_child(this._buildProgressSection());
            this._richContainer.add_child(this._buildControlsRow());

            this._listContainer = new St.BoxLayout({
                vertical: true,
                x_expand: true,
                style: 'spacing: 8px;',
            });
            this._listContainer.hide();

            container.add_child(this._richContainer);
            container.add_child(this._listContainer);

            item.add_child(container);
            this.menu.addMenuItem(item);

            if (this._popupStyles.popupBg) {
                this.menu.box.style = this._popupStyles.popupBg;
                this._popupBgActive = true;
            }

            this.menu.connectObject('open-state-changed',
                (_m, open) => {
                    if (open) this._startPositionPolling();
                    else this._stopPositionPolling();
                }, this);
        }

        _setupClickHandling() {
            this.connectObject('captured-event',
                (_actor, event) => {
                    const type = event.type();
                    if (type === Clutter.EventType.BUTTON_PRESS)
                        return this._handleButtonPress(event);
                    if (type === Clutter.EventType.SCROLL)
                        return this._handleScroll(event);
                    return Clutter.EVENT_PROPAGATE;
                }, this);
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

            return this._dispatchAction(action);
        }

        _handleScroll(event) {
            let action;
            switch (event.get_scroll_direction()) {
                case Clutter.ScrollDirection.UP:
                    action = this._preferences.scrollUpAction;
                    break;
                case Clutter.ScrollDirection.DOWN:
                    action = this._preferences.scrollDownAction;
                    break;
                case Clutter.ScrollDirection.SMOOTH: {
                    // Touchpads emit a stream of small deltas; accumulate until
                    // one notch's worth before firing so actions don't spam.
                    const [, dy] = event.get_scroll_delta();
                    this._scrollAccum += dy;
                    if (Math.abs(this._scrollAccum) < SCROLL_NOTCH)
                        return Clutter.EVENT_STOP;
                    action = this._scrollAccum < 0
                        ? this._preferences.scrollUpAction
                        : this._preferences.scrollDownAction;
                    this._scrollAccum = 0;
                    break;
                }
                default:
                    return Clutter.EVENT_PROPAGATE;
            }

            return this._dispatchAction(action);
        }

        _dispatchAction(action) {
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
                case CLICK_RAISE_PLAYER: this._focusPlayerWindow(this._mprisManager.currentMedia); break;
            }
        }

        _adjustVolume(deltaPct) {
            this._ensureMixer();
            if (this._mixer.get_state() === Gvc.MixerControlState.READY)
                this._applyVolumeDelta(deltaPct);
            else
                this._pendingVolumeDelta += deltaPct;
        }

        _ensureMixer() {
            if (this._mixer) return;
            this._mixer = new Gvc.MixerControl({ name: 'Medialine' });
            this._mixer.connectObject('state-changed', () => {
                if (this._mixer.get_state() !== Gvc.MixerControlState.READY)
                    return;
                if (this._pendingVolumeDelta) {
                    const delta = this._pendingVolumeDelta;
                    this._pendingVolumeDelta = 0;
                    this._applyVolumeDelta(delta);
                }
            }, this);
            this._mixer.open();
        }

        _applyVolumeDelta(deltaPct) {
            const sink = this._mixer.get_default_sink();
            if (!sink) return;
            const maxNorm = this._mixer.get_vol_max_norm();
            const step = maxNorm * (deltaPct / 100);
            sink.volume = Math.max(0, Math.min(maxNorm, sink.volume + step));
            sink.push_volume();

            const level = sink.volume / maxNorm;
            const name = level === 0 ? 'audio-volume-muted-symbolic'
                : level < 0.34 ? 'audio-volume-low-symbolic'
                    : level < 0.67 ? 'audio-volume-medium-symbolic'
                        : 'audio-volume-high-symbolic';
            Main.osdWindowManager.showAll(new Gio.ThemedIcon({ name }), null, level, 1.0);
        }

        _makeControlButton(iconName, iconSize, onClick) {
            const btn = new St.Button({
                can_focus: true,
                track_hover: true,
                reactive: true,
                style_class: 'medialine-control-button',
                style: this._popupStyles.btn,
                x_align: Clutter.ActorAlign.CENTER,
                y_align: Clutter.ActorAlign.CENTER,
            });
            const icon = new St.Icon({
                icon_name: iconName,
                icon_size: iconSize,
                style: this._popupStyles.iconColor,
                x_align: Clutter.ActorAlign.CENTER,
                y_align: Clutter.ActorAlign.CENTER,
            });
            btn.set_child(icon);
            btn._active = false;
            this._controlButtons.push(btn);
            this._controlIcons.push(icon);
            btn.connectObject(
                'notify::hover', () => {
                    btn.style = btn.hover
                        ? this._popupStyles.btnHover
                        : (btn._active ? this._popupStyles.btnActive : this._popupStyles.btn);
                },
                'clicked', onClick,
                this);
            return btn;
        }

        // Lightweight control button used in the compact (multi-player) rows.
        // Not tracked in _controlButtons/_controlIcons since compact rows are
        // rebuilt from scratch on every update.
        _makeCompactButton(iconName, iconSize, onClick) {
            const btn = new St.Button({
                can_focus: true,
                track_hover: true,
                reactive: true,
                style_class: 'medialine-control-button',
                style: this._popupStyles.compactBtn,
                x_align: Clutter.ActorAlign.CENTER,
                y_align: Clutter.ActorAlign.CENTER,
            });
            const icon = new St.Icon({
                icon_name: iconName,
                icon_size: iconSize,
                style: this._popupStyles.iconColor,
                x_align: Clutter.ActorAlign.CENTER,
                y_align: Clutter.ActorAlign.CENTER,
            });
            btn.set_child(icon);
            btn.connectObject(
                'notify::hover', () => {
                    btn.style = btn.hover
                        ? this._popupStyles.compactBtnHover
                        : this._popupStyles.compactBtn;
                },
                'clicked', onClick,
                this);
            return btn;
        }

        _updatePopupColors() {
            const primary = this._preferences.popupPrimaryColor;
            const secondary = this._preferences.popupSecondaryColor;
            const bgColor = this._preferences.popupBackgroundColor;

            this._popupStyles.primary = primary;
            this._popupStyles.secondary = secondary;
            const dynamicBg = this._preferences.popupDynamicBg;
            if (dynamicBg) {
                const media = this._mprisManager.currentMedia;
                const extracted = this._extractArtColor(media);
                if (extracted) {
                    const intensity = this._preferences.popupDynamicBgIntensity;
                    this._popupStyles.popupBg = `background-color: ${this._adjustColorBrightness(extracted, intensity)};`;
                } else {
                    this._popupStyles.popupBg = bgColor && bgColor !== 'transparent' ? `background-color: ${bgColor};` : '';
                }
            } else {
                this._popupStyles.popupBg = bgColor && bgColor !== 'transparent' ? `background-color: ${bgColor};` : '';
            }
            this._popupStyles.artCommon = `border-radius: 6px; background-color: ${hexToRgba(secondary, 0.08)}; background-size: contain; background-repeat: no-repeat; background-position: center;`;
            this._popupStyles.artFallback = `width: ${ART_SIZE}px; height: ${ART_SIZE}px; min-width: ${ART_SIZE}px; min-height: ${ART_SIZE}px; border-radius: 6px; background-color: ${hexToRgba(secondary, 0.08)}; background-size: contain; background-repeat: no-repeat; background-position: center;`;
            this._popupStyles.title = `font-weight: 700; font-size: 16px; color: ${primary};`;
            this._popupStyles.subtitle = `font-size: 14px; color: ${primary};`;
            this._popupStyles.btn = `width: 40px; height: 40px; border-radius: 8px; color: ${primary};`;
            this._popupStyles.btnHover = `width: 40px; height: 40px; border-radius: 8px; color: ${primary}; background-color: ${hexToRgba(secondary, 0.15)};`;
            this._popupStyles.btnActive = `width: 40px; height: 40px; border-radius: 8px; color: ${primary}; background-color: ${hexToRgba(secondary, 0.22)};`;
            this._popupStyles.time = `font-size: 11px; color: ${hexToRgba(primary, 0.8)};`;
            this._popupStyles.progressTrack = `background-color: ${hexToRgba(secondary, 0.18)}; border-radius: ${PROGRESS_HEIGHT / 2}px; height: ${PROGRESS_HEIGHT}px;`;
            this._popupStyles.progressFill = `background-color: ${hexToRgba(primary, 0.9)}; border-radius: ${PROGRESS_HEIGHT / 2}px;`;
            this._popupStyles.progressThumb = `background-color: ${primary}; border-radius: ${PROGRESS_THUMB_SIZE / 2}px;`;
            this._popupStyles.iconColor = `color: ${primary};`;
            this._popupStyles.separator = `height: 1px; background-color: ${hexToRgba(secondary, 0.15)};`;
            this._popupStyles.compactBtn = `width: 32px; height: 32px; border-radius: 8px; color: ${primary};`;
            this._popupStyles.compactBtnHover = `width: 32px; height: 32px; border-radius: 8px; color: ${primary}; background-color: ${hexToRgba(secondary, 0.15)};`;

            this._popupTitle.style = this._popupStyles.title;
            this._popupSubtitle.style = this._popupStyles.subtitle;
            this._timeCurrent.style = this._popupStyles.time;
            this._timeTotal.style = this._popupStyles.time;
            this._progressTrack.style = this._popupStyles.progressTrack;
            this._progressFill.style = this._popupStyles.progressFill;
            this._progressThumb.style = this._popupStyles.progressThumb;

            for (const icon of this._controlIcons)
                icon.style = this._popupStyles.iconColor;
            for (const btn of this._controlButtons) {
                if (btn._active)
                    btn.style = this._popupStyles.btnActive;
                else if (btn.hover)
                    btn.style = this._popupStyles.btnHover;
                else
                    btn.style = this._popupStyles.btn;
            }

            if (this._popupStyles.popupBg) {
                this.menu.box.style = this._popupStyles.popupBg;
                this._popupBgActive = true;
            } else if (this._popupBgActive) {
                this.menu.box.set_style(null);
                this._popupBgActive = false;
            }

            this._currentPopupArtUrl = '';
        }

        _startPositionPolling() {
            this._pollPosition();
            if (this._positionTimerId) return;
            this._positionTimerId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 1000, () => {
                this._pollPosition();
                return GLib.SOURCE_CONTINUE;
            });
        }

        _pollPosition() {
            // The scrubber only exists in the single-player rich view.
            if (this._mprisManager.allMedia.length !== 1) return;

            if (this._dragging) {
                this._updateProgress();
                return;
            }
            this._mprisManager.getPositionAsync((position) => {
                if (this._destroyed) return;
                this._position = position;
                this._updateProgress();
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
                this._progressThumb.visible = false;
                return;
            }
            const length = media.length || 0;
            const alloc = this._progressTrack.get_allocation_box();
            const trackWidth = alloc ? Math.max(0, alloc.x2 - alloc.x1) : 0;

            let ratio;
            if (this._dragging) {
                ratio = this._dragRatio;
                this._timeCurrent.text = formatTime(Math.floor(ratio * length));
            } else {
                const position = this._position;
                ratio = length > 0 ? Math.max(0, Math.min(1, position / length)) : 0;
                this._timeCurrent.text = formatTime(position);
            }
            this._timeTotal.text = formatTime(length);

            const fillWidth = Math.floor(ratio * trackWidth);
            this._progressFill.set_position(0, 0);
            this._progressFill.width = fillWidth;

            const canSeek = !!media.canSeek && length > 0 && !!media.trackId;
            const showThumb = canSeek && (this._dragging || this._progressTrack.hover);
            this._progressThumb.visible = showThumb;
            if (showThumb) {
                this._progressThumb.set_position(
                    Math.floor(fillWidth - PROGRESS_THUMB_SIZE / 2),
                    (PROGRESS_HEIGHT - PROGRESS_THUMB_SIZE) / 2);
            }
        }

        _ratioFromEvent(event) {
            const media = this._mprisManager.currentMedia;
            if (!media || !media.length) return null;
            const alloc = this._progressTrack.get_allocation_box();
            const trackWidth = alloc ? Math.max(1, alloc.x2 - alloc.x1) : 1;
            const [stageX] = event.get_coords();
            const [trackStageX] = this._progressTrack.get_transformed_position();
            const localX = stageX - trackStageX;
            return Math.max(0, Math.min(1, localX / trackWidth));
        }

        _onProgressPress(event) {
            if (event.get_button() !== Clutter.BUTTON_PRIMARY)
                return Clutter.EVENT_PROPAGATE;
            const media = this._mprisManager.currentMedia;
            if (!media || !media.canSeek || !media.length || !media.trackId)
                return Clutter.EVENT_PROPAGATE;
            const ratio = this._ratioFromEvent(event);
            if (ratio === null) return Clutter.EVENT_PROPAGATE;
            this._dragging = true;
            this._dragRatio = ratio;
            this._updateProgress();
            return Clutter.EVENT_STOP;
        }

        _onProgressMotion(event) {
            if (!this._dragging) return Clutter.EVENT_PROPAGATE;
            const ratio = this._ratioFromEvent(event);
            if (ratio === null) return Clutter.EVENT_PROPAGATE;
            this._dragRatio = ratio;
            this._updateProgress();
            return Clutter.EVENT_STOP;
        }

        _onProgressRelease(event) {
            if (!this._dragging) return Clutter.EVENT_PROPAGATE;
            if (event.get_button() !== Clutter.BUTTON_PRIMARY)
                return Clutter.EVENT_PROPAGATE;
            const ratio = this._ratioFromEvent(event) ?? this._dragRatio;
            const media = this._mprisManager.currentMedia;
            this._dragging = false;
            if (media && media.length)
                this._mprisManager.setPosition(Math.floor(ratio * media.length));
            this._updateProgress();
            return Clutter.EVENT_STOP;
        }

        _onMediaChanged() {
            const allMedia = this._mprisManager.allMedia;

            if (allMedia.length === 0) {
                this.hide();
                this._stopPositionPolling();
                return;
            }

            this.show();

            const media = allMedia[0];
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
            this._updatePopupColors();

            if (allMedia.length === 1) {
                this._listContainer.hide();
                this._richContainer.show();
                this._updatePopup(media);
            } else {
                this._richContainer.hide();
                this._listContainer.show();
                this._updateMediaList(allMedia);
            }

            if (this._positionTimerId)
                this._pollPosition();
        }

        _updatePopup(media) {
            this._popupTitle.text = media.title || (media.identity ? `${media.identity} is playing media` : _('Unknown'));
            const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
            const artist = media.artist ? esc(media.artist) : '';
            const album = media.album ? esc(media.album) : '';
            const on = (artist && album) ? `<span foreground="${this._popupStyles.secondary}"> on </span>` : '';
            this._popupSubtitle.clutter_text.set_markup(artist + on + album);
            this._popupSubtitle.visible = !!(artist || album);

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
            this._shuffleBtn.style = this._shuffleBtn._active ? this._popupStyles.btnActive : this._popupStyles.btn;

            const repeatAvail = media.loopStatus !== null && media.canControl;
            this._repeatBtn.reactive = repeatAvail;
            this._repeatBtn.opacity = repeatAvail ? 255 : 110;
            this._repeatBtn.get_child().icon_name = media.loopStatus === 'Track'
                ? 'media-playlist-repeat-song-symbolic'
                : 'media-playlist-repeat-symbolic';
            this._repeatBtn._active = repeatAvail && media.loopStatus !== 'None';
            this._repeatBtn.style = this._repeatBtn._active ? this._popupStyles.btnActive : this._popupStyles.btn;

            this._updatePopupArt(media);
            this._updateProgress();
        }

        _updateMediaList(allMedia) {
            this._listContainer.destroy_all_children();

            allMedia.forEach((media, idx) => {
                if (idx > 0) {
                    this._listContainer.add_child(new St.Widget({
                        style: this._popupStyles.separator,
                        x_expand: true,
                    }));
                }
                const row = this._buildCompactRow(media);
                this._listContainer.add_child(row);
                this._applyCompactArt(row, media);
                this._applyCompactInfo(row, media);
            });
        }

        _buildCompactRow(media) {
            const art = new St.Widget({
                layout_manager: new Clutter.FixedLayout(),
                style: this._popupStyles.artFallback,
                reactive: true,
            });
            const appIcon = new St.Icon({
                icon_name: 'audio-x-generic-symbolic',
                icon_size: 32,
            });
            art.add_child(appIcon);
            art.connectObject(
                'button-release-event', (_a, event) => {
                    if (event.type() === Clutter.EventType.BUTTON_RELEASE) {
                        this._focusPlayerWindow(media);
                        return Clutter.EVENT_STOP;
                    }
                    return Clutter.EVENT_PROPAGATE;
                },
                this
            );

            const title = new St.Label({
                text: '',
                x_expand: true,
                style: this._popupStyles.title,
            });
            title.clutter_text.ellipsize = Pango.EllipsizeMode.END;

            const subtitle = new St.Label({
                text: '',
                x_expand: true,
                style: this._popupStyles.subtitle,
            });
            subtitle.clutter_text.use_markup = true;
            subtitle.clutter_text.ellipsize = Pango.EllipsizeMode.END;

            const textBox = new St.BoxLayout({
                vertical: true,
                x_expand: true,
                y_align: Clutter.ActorAlign.CENTER,
                style: 'spacing: 2px;',
            });
            textBox.add_child(title);
            textBox.add_child(subtitle);

            const playBtn = this._makeCompactButton('media-playback-start-symbolic', 18,
                () => this._mprisManager.playPause(media.busName));
            const nextBtn = this._makeCompactButton('media-skip-forward-symbolic', 16,
                () => this._mprisManager.next(media.busName));

            const row = new St.BoxLayout({
                x_expand: true,
                y_align: Clutter.ActorAlign.CENTER,
                style: 'spacing: 10px;',
            });
            row.add_child(art);
            row.add_child(textBox);
            row.add_child(playBtn);
            row.add_child(nextBtn);

            row._art = art;
            row._appIcon = appIcon;
            row._title = title;
            row._subtitle = subtitle;
            row._playBtn = playBtn;
            row._nextBtn = nextBtn;
            return row;
        }

        _applyCompactInfo(row, media) {
            row._title.text = media.title || (media.identity ? `${media.identity} is playing media` : _('Unknown'));
            const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
            const artist = media.artist ? esc(media.artist) : '';
            const album = media.album ? esc(media.album) : '';
            const on = (artist && album) ? `<span foreground="${this._popupStyles.secondary}"> on </span>` : '';
            row._subtitle.clutter_text.set_markup(artist + on + album);
            row._subtitle.visible = !!(artist || album);

            row._playBtn.get_child().icon_name = media.status === 'Playing'
                ? 'media-playback-pause-symbolic'
                : 'media-playback-start-symbolic';

            const nextAvail = media.canGoNext !== false;
            row._nextBtn.reactive = nextAvail;
            row._nextBtn.opacity = nextAvail ? 255 : 110;
        }

        _applyCompactArt(row, media) {
            this._applyArtBin(row._art, row._appIcon, media, {
                boxSize: ART_SIZE,
                fallbackIconSize: 32,
            });
        }

        _updatePopupArt(media) {
            const cacheKey = `${media.artUrl || ''}::${media.status}::${this._preferences.iconType}`;
            if (cacheKey === this._currentPopupArtUrl) return;
            this._currentPopupArtUrl = cacheKey;

            this._applyArtBin(this._popupArt, this._popupArtAppIcon, media, {
                boxSize: null,
                fallbackIconSize: 40,
            });
        }

        _applyArtBin(bin, badgeIcon, media, opts) {
            const appGicon = this._lookupAppGicon(media);
            const art = this._tryGetArtBackgroundCss(media);

            const showAppIcon = this._preferences.popupShowAppIcon;

            if (art) {
                const [w, h] = opts.boxSize
                    ? [opts.boxSize, opts.boxSize]
                    : this._fitBox(art.dims.width, art.dims.height);
                bin.style =
                    `width: ${w}px; height: ${h}px; min-width: ${w}px; min-height: ${h}px; ` +
                    `${this._popupStyles.artCommon} background-image: url("${art.safePath}");`;

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
                ? `width: ${size}px; height: ${size}px; min-width: ${size}px; min-height: ${size}px; ${this._popupStyles.artCommon}`
                : this._popupStyles.artFallback;

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

        _tryGetArtBackgroundCss(media) {
            const artUrl = media.artUrl || '';
            if (!artUrl || !artUrl.startsWith('file://')) return null;
            try {
                const path = GLib.uri_unescape_string(artUrl.substring('file://'.length), null);
                const dims = this._readImageDims(path);
                if (!dims) return null;
                return { dims, safePath: path.replace(/"/g, '\\"') };
            } catch (_) {
                return null;
            }
        }

        _readImageDims(path) {
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

        _fitBox(w, h) {
            if (!w || !h) return [ART_SIZE, ART_SIZE];
            const r = w / h;
            const maxR = POPUP_ART_MAX_W / POPUP_ART_MAX_H;
            let outW, outH;
            if (r > maxR) { outW = POPUP_ART_MAX_W; outH = outW / r; }
            else { outH = POPUP_ART_MAX_H; outW = outH * r; }
            return [Math.round(outW), Math.round(outH)];
        }

        _extractArtColor(media) {
            if (!media?.artUrl || !media.artUrl.startsWith('file://')) return null;

            const artUrl = media.artUrl;
            if (artUrl === this._extractedArtColorUrl) return this._extractedArtColor;
            this._extractedArtColorUrl = artUrl;

            try {
                const path = GLib.uri_unescape_string(artUrl.substring('file://'.length), null);
                const pb = GdkPixbuf.Pixbuf.new_from_file(path);
                const small = pb.scale_simple(1, 1, GdkPixbuf.InterpType.BILINEAR);
                const pixels = small.get_pixels();
                const nChannels = small.get_n_channels();
                const r = pixels[0];
                const g = nChannels > 1 ? pixels[1] : r;
                const b = nChannels > 2 ? pixels[2] : r;
                this._extractedArtColor = `#${[r, g, b].map(c => c.toString(16).padStart(2, '0')).join('').toUpperCase()}`;
                return this._extractedArtColor;
            } catch (_) {
                this._extractedArtColorUrl = null;
                this._extractedArtColor = null;
                return null;
            }
        }

        _adjustColorBrightness(hex, intensity) {
            const h = hex.replace('#', '');
            const r = parseInt(h.substring(0, 2), 16);
            const g = parseInt(h.substring(2, 4), 16);
            const b = parseInt(h.substring(4, 6), 16);

            let fr, fg, fb;
            if (intensity <= 0.5) {
                const t = intensity * 2;
                fr = Math.round(r * t);
                fg = Math.round(g * t);
                fb = Math.round(b * t);
            } else {
                const t = (intensity - 0.5) * 2;
                fr = Math.round(r + (255 - r) * t);
                fg = Math.round(g + (255 - g) * t);
                fb = Math.round(b + (255 - b) * t);
            }

            return `#${[fr, fg, fb].map(c => c.toString(16).padStart(2, '0')).join('').toUpperCase()}`;
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

            if (prefs.iconType === ICON_TYPE_CUSTOM) {
                this._currentArtUrl = null;
                this._iconActor.icon_name = null;
                if (prefs.customIconPath) {
                    try {
                        const file = Gio.File.new_for_path(prefs.customIconPath);
                        if (file.query_exists(null)) {
                            this._iconActor.gicon = new Gio.FileIcon({ file });
                            return;
                        }
                    } catch (_) { }
                }
                this._setAppIcon(media);
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

        _identityCandidates(media) {
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

        _findWindowForMedia(media, pid) {
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

            // Single candidate- cache its WM_CLASS and return
            if (candidates.length === 1) {
                this._windowClassCache.set(media.busName, candidates[0].get_wm_class());
                return candidates[0];
            }

            const knownClass = this._windowClassCache.get(media.busName);
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
            const needles = this._identityCandidates(media)
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

        _lookupAppGicon(media) {
            if (!media) return null;

            const pid = this._pidCache.get(media.busName);
            if (pid === undefined) {
                this._ensurePidResolved(media.busName);
            } else if (pid) {
                try {
                    const win = this._findWindowForMedia(media, pid);
                    const app = win
                        ? Shell.WindowTracker.get_default().get_window_app(win)
                        : null;
                    const appInfo = app ? app.get_app_info() : null;
                    const icon = appInfo ? appInfo.get_icon() : null;
                    if (icon) return icon;
                } catch (_) { /* give up */ }
            }

            const stringIcon = this._lookupAppGiconByString(media);
            if (stringIcon) return stringIcon;

            return null;
        }

        _lookupAppGiconByString(media) {
            const candidates = this._identityCandidates(media);
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

        _ensurePidResolved(busName) {
            if (!busName) return;
            if (this._pidCache.has(busName) || this._pendingPidLookups.has(busName)) return;
            this._pendingPidLookups.add(busName);
            this._mprisManager.getPidForBusName(busName, (pid) => {
                this._pendingPidLookups.delete(busName);
                this._pidCache.set(busName, pid);
                if (!this._destroyed) this._onMediaChanged();
            });
        }

        _focusPlayerWindow(media) {
            if (!media || !media.busName) return;
            const busName = media.busName;

            const cachedPid = this._pidCache.get(busName);
            if (cachedPid !== undefined) {
                if (cachedPid && this._activateWindowForMedia(media, cachedPid)) return;
                this._raiseViaMpris(busName);
                return;
            }

            this._mprisManager.getPidForBusName(busName, (pid) => {
                this._pidCache.set(busName, pid);
                if (this._destroyed) return;
                if (pid && this._activateWindowForMedia(media, pid)) return;
                this._raiseViaMpris(busName);
            });
        }

        _activateWindowForMedia(media, pid) {
            const win = this._findWindowForMedia(media, pid);
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

        _raiseViaMpris(busName) {
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
                        // Player may not support the Raise method either.
                    }
                }
            );
        }

        destroy() {
            this._destroyed = true;
            this._stopPositionPolling();

            if (this._mixer) {
                this._mixer.disconnectObject(this);
                this._mixer.close();
                this._mixer = null;
            }

            this._pidCache.clear();
            this._pendingPidLookups.clear();
            this._windowClassCache.clear();

            this._popupArt?.disconnectObject(this);
            this._progressTrack?.disconnectObject(this);
            this.menu.disconnectObject(this);
            this._mprisManager.disconnectObject(this);
            this._preferences.disconnectObject(this);
            this.disconnectObject(this);

            super.destroy();
        }
    });