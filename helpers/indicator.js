import GObject from 'gi://GObject';
import St from 'gi://St';
import Gio from 'gi://Gio';
import Clutter from 'gi://Clutter';
import Pango from 'gi://Pango';

import { gettext as _ } from 'resource:///org/gnome/shell/extensions/extension.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

import {
    ICON_TYPE_ART, ICON_TYPE_STATUS, ICON_TYPE_CUSTOM,
    ART_SIZE, COMPACT_EXPAND_CLICK, COMPACT_EXPAND_OFF,
    PROGRESS_HEIGHT, PROGRESS_THUMB_SIZE, COMPACT_WIDTH,
} from './constants.js';
import { hexToRgba, adjustColorBrightness, escMarkup } from './colorUtils.js';
import { makeButton, buildProgressWidgets } from './widgetFactory.js';
import { setupClickHandling, toggleShuffle, cycleRepeat } from './inputActions.js';
import { applyArtBin, extractArtColor } from './artDisplay.js';
import { ArtCache } from './artCache.js';
import { isRemoteArt } from './artUrl.js';
import { ExpandableMediaRow } from './expandableMediaRow.js';
import { Visualizer } from './visualizer.js';
import {
    startPositionPolling, stopPositionPolling, pollPosition,
    updateProgress, onProgressPress, onProgressMotion, onProgressRelease,
} from './progressTracker.js';
import { lookupAppGicon, focusPlayerWindow } from './windowFocus.js';

function _getSymbolicGicon(gicon) {
    if (!gicon) return null;
    if (!(gicon instanceof Gio.ThemedIcon)) return gicon;
    const names = gicon.get_names();
    if (names.length === 0) return gicon;
    const firstName = names[0].endsWith('-symbolic') ? names[0] : `${names[0]}-symbolic`;
    const icon = new Gio.ThemedIcon({ name: firstName });
    for (let i = 0; i < names.length; i++) {
        if (names[i] !== firstName)
            icon.append_name(names[i]);
    }
    return icon;
}

function buildPopupStyles(primary, secondary, popupBg) {
    return {
        primary,
        secondary,
        popupBg,
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
        visualizerBar: `background-color: ${secondary}; border-radius: 999px;`,
        separator: `height: 1px; background-color: ${hexToRgba(secondary, 0.15)};`,
        compactBtn: `width: 32px; height: 32px; border-radius: 8px; color: ${primary};`,
        compactBtnHover: `width: 32px; height: 32px; border-radius: 8px; color: ${primary}; background-color: ${hexToRgba(secondary, 0.15)};`,
    };
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
            this._artCache = new ArtCache(preferences.artCacheSizeMb * 1024 * 1024);
            this._positionTimerId = null;
            this._position = 0;
            this._dragging = false;
            this._dragRatio = 0;
            this._scrollAccum = 0;
            this._mixer = null;
            this._pendingVolumeDelta = 0;
            this._controlButtons = [];
            this._controlIcons = [];
            this._pidCache = new Map();
            this._pendingPidLookups = new Set();
            this._windowClassCache = new Map();
            this._compactRows = new Map();
            this._compactSeparators = new Map();
            this._expandedBusName = null;
            this._lastCompactExpandMode = this._preferences.popupCompactExpandMode;

            this._initPopupColors();
            this._buildUI();
            this._setupMenu();
            setupClickHandling(this);

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
            this._popupStyles = buildPopupStyles(primary, secondary, bgColor ? `background-color: ${bgColor};` : '');
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
                        focusPlayerWindow(this, this._mprisManager.currentMedia);
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

            this._visualizer = new Visualizer(this._popupStyles);

            const topRow = new St.BoxLayout({ x_expand: true, style: 'spacing: 12px;' });
            topRow.add_child(this._popupArt);
            topRow.add_child(textBox);
            topRow.add_child(this._visualizer.actor);
            return topRow;
        }

        _buildProgressSection() {
            const pw = buildProgressWidgets(this._popupStyles);
            this._timeCurrent = pw.timeCurrent;
            this._timeTotal = pw.timeTotal;
            this._progressTrack = pw.progressTrack;
            this._progressFill = pw.progressFill;
            this._progressThumb = pw.progressThumb;

            this._progressTrack.connectObject(
                'notify::allocation', () => updateProgress(this),
                'button-press-event', (_a, event) => onProgressPress(this, event),
                'motion-event', (_a, event) => onProgressMotion(this, event),
                'button-release-event', (_a, event) => onProgressRelease(this, event),
                'notify::hover', () => updateProgress(this),
                this);

            const section = new St.BoxLayout({ vertical: true, x_expand: true, style: 'spacing: 4px;' });
            section.add_child(pw.timeRow);
            section.add_child(this._progressTrack);
            return section;
        }

        _buildControlsRow() {
            this._shuffleBtn = this._makeControlButton(
                'media-playlist-shuffle-symbolic', 16, () => toggleShuffle(this));
            this._prevBtn = this._makeControlButton(
                'media-skip-backward-symbolic', 18, () => this._mprisManager.previous());
            this._playBtn = this._makeControlButton(
                'media-playback-start-symbolic', 24, () => this._mprisManager.playPause());
            this._nextBtn = this._makeControlButton(
                'media-skip-forward-symbolic', 18, () => this._mprisManager.next());
            this._repeatBtn = this._makeControlButton(
                'media-playlist-repeat-symbolic', 16, () => cycleRepeat(this));

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
                style: `spacing: 12px; min-width: ${COMPACT_WIDTH}px; max-width: ${COMPACT_WIDTH}px;`,
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
                    if (open) {
                        startPositionPolling(this);
                        this._visualizer?.setActive(this._preferences.popupShowVisualizer);
                    } else {
                        stopPositionPolling(this);
                        this._visualizer?.setActive(false);
                        this._setExpandedBusName(null, true);
                        for (const row of this._compactRows.values())
                            row.stop();
                    }
                }, this);
        }

        _makeControlButton(iconName, iconSize, onClick) {
            const btn = makeButton(this._popupStyles, iconName, iconSize);
            this._controlButtons.push(btn);
            this._controlIcons.push(btn.get_child());
            btn.connectObject(
                'notify::hover', () => {
                    btn.style = btn.hover ? this._popupStyles.btnHover
                        : (btn._active ? this._popupStyles.btnActive : this._popupStyles.btn);
                },
                'clicked', onClick,
                this);
            return btn;
        }

        _updatePopupColors() {
            const primary = this._preferences.popupPrimaryColor;
            const secondary = this._preferences.popupSecondaryColor;
            const bgColor = this._preferences.popupBackgroundColor;

            let popupBg;
            const dynamicBg = this._preferences.popupDynamicBg;
            if (dynamicBg) {
                const media = this._mprisManager.currentMedia;
                const extracted = extractArtColor(media);
                if (extracted) {
                    const intensity = this._preferences.popupDynamicBgIntensity;
                    popupBg = `background-color: ${adjustColorBrightness(extracted, intensity)};`;
                } else {
                    popupBg = bgColor && bgColor !== 'transparent' ? `background-color: ${bgColor};` : '';
                }
            } else {
                popupBg = bgColor && bgColor !== 'transparent' ? `background-color: ${bgColor};` : '';
            }

            Object.assign(this._popupStyles, buildPopupStyles(primary, secondary, popupBg));

            this._visualizer?.setStyle(this._popupStyles);
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

        _onMediaChanged() {
            const allMedia = this._mprisManager.allMedia;

            if (allMedia.length === 0) {
                this.hide();
                stopPositionPolling(this);
                this._visualizer?.setActive(false);
                this._clearCompactRows();
                return;
            }

            this.show();
            this._syncCompactExpandMode();

            this._artCache.setMaxBytes(this._preferences.artCacheSizeMb * 1024 * 1024);
            for (const m of allMedia) this._resolveArt(m);

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
                this._clearCompactRows();
                this._listContainer.hide();
                this._richContainer.show();
                this._updatePopup(media);
            } else {
                this._richContainer.hide();
                this._visualizer?.setActive(false);
                this._listContainer.show();
                this._updateMediaList(allMedia);
            }

            if (this._positionTimerId)
                pollPosition(this);
        }

        _resolveArt(media) {
            const url = media._remoteArtUrl ?? media.artUrl;
            if (!url || url.startsWith('file://')) return;
            if (!isRemoteArt(url)) { media.artUrl = ''; return; }

            media._remoteArtUrl = url;
            const local = this._artCache.resolve(url, () => {
                if (this._artCache) this._onMediaChanged();
            });
            media.artUrl = local || '';
        }

        _updatePopup(media) {
            this._popupTitle.text = media.title || (media.identity ? `${media.identity} is playing media` : _('Unknown'));
            const artist = media.artist ? escMarkup(media.artist) : '';
            const album = media.album ? escMarkup(media.album) : '';
            const separator = (artist && album) ? ` — ` : '';
            this._popupSubtitle.clutter_text.set_markup(artist + separator + album);
            this._popupSubtitle.visible = !!(artist || album);

            this._playBtn.get_child().icon_name = media.status === 'Playing'
                ? 'media-playback-pause-symbolic'
                : 'media-playback-start-symbolic';

            const showVis = this._preferences.popupShowVisualizer;
            this._visualizer.actor.visible = showVis;
            this._visualizer.setPlaying(showVis && media.status === 'Playing');
            this._visualizer.setActive(showVis && this.menu.isOpen);

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
            updateProgress(this);
        }

        _updatePopupArt(media) {
            const cacheKey = `${media.artUrl || ''}::${media.status}::${this._preferences.iconType}`;
            if (cacheKey === this._currentPopupArtUrl) return;
            this._currentPopupArtUrl = cacheKey;

            const appGicon = lookupAppGicon(this, media);
            applyArtBin(this._popupArt, this._popupArtAppIcon, media, {
                boxSize: ART_SIZE,
                fallbackIconSize: 40,
            }, this._popupStyles, this._preferences, appGicon);
        }

        _updateMediaList(allMedia) {
            const live = new Set(allMedia.map(m => m.busName));

            for (const [busName, row] of this._compactRows) {
                if (!live.has(busName)) {
                    row.animateOutAndDestroy();
                    this._compactRows.delete(busName);
                }
            }
            for (const [busName, separator] of this._compactSeparators) {
                if (!live.has(busName)) {
                    separator.destroy();
                    this._compactSeparators.delete(busName);
                }
            }

            if (this._expandedBusName && !live.has(this._expandedBusName))
                this._expandedBusName = null;

            let childIndex = 0;
            allMedia.forEach((media, index) => {
                let separator = this._compactSeparators.get(media.busName);
                if (index === 0) {
                    if (separator) {
                        separator.destroy();
                        this._compactSeparators.delete(media.busName);
                    }
                } else {
                    if (!separator) {
                        separator = this._makeCompactSeparator();
                        this._compactSeparators.set(media.busName, separator);
                        this._listContainer.add_child(separator);
                    }
                    separator._line.style = this._popupStyles.separator;
                    this._listContainer.set_child_at_index(separator, childIndex++);
                }

                let row = this._compactRows.get(media.busName);
                if (!row) {
                    row = new ExpandableMediaRow(this, media);
                    this._compactRows.set(media.busName, row);
                    this._listContainer.add_child(row.actor);
                }
                row.updateMedia(media);
                this._listContainer.set_child_at_index(row.actor, childIndex++);
            });

            this._applyExpandedBusState(!this.menu.isOpen);
        }

        _setExpandedBusName(busName, immediate = false) {
            this._expandedBusName = busName;
            this._applyExpandedBusState(immediate);
        }

        _syncCompactExpandMode() {
            const mode = this._preferences.popupCompactExpandMode;
            if (mode === this._lastCompactExpandMode)
                return;

            this._lastCompactExpandMode = mode;
            if (mode !== COMPACT_EXPAND_CLICK)
                this._expandedBusName = null;
        }

        _applyExpandedBusState(immediate = false) {
            const mode = this._preferences.popupCompactExpandMode;
            if (mode === COMPACT_EXPAND_OFF) {
                this._expandedBusName = null;
                for (const row of this._compactRows.values())
                    row.setExpanded(false, false, immediate);
                this._syncCompactSeparators(false, immediate);
                return;
            }

            const expandedBusName = this._expandedBusName;
            for (const [busName, row] of this._compactRows) {
                const isExpanded = !!expandedBusName && busName === expandedBusName;
                const hidden = !!expandedBusName && busName !== expandedBusName;
                row.setExpanded(isExpanded, hidden, immediate);
            }
            this._syncCompactSeparators(!!expandedBusName, immediate);
        }

        _makeCompactSeparator() {
            const sep = new St.Widget({
                x_expand: true,
                height: 17,
                layout_manager: new Clutter.BinLayout(),
            });
            sep._line = new St.Widget({
                x_expand: true,
                y_align: Clutter.ActorAlign.CENTER,
                height: 1,
                style: this._popupStyles.separator,
            });
            sep.add_child(sep._line);
            return sep;
        }

        _syncCompactSeparators(hidden, immediate = false) {
            const duration = immediate ? 0 : 220;
            for (const separator of this._compactSeparators.values()) {
                separator.visible = true;
                separator.ease({
                    height: hidden ? 0 : 17,
                    opacity: hidden ? 0 : 255,
                    duration,
                    mode: Clutter.AnimationMode.EASE_OUT_CUBIC,
                    onComplete: () => {
                        separator.visible = !hidden;
                    },
                });
            }
        }

        _clearCompactRows() {
            this._expandedBusName = null;
            for (const row of this._compactRows.values())
                row.destroy();
            this._compactRows.clear();
            for (const separator of this._compactSeparators.values())
                separator.destroy();
            this._compactSeparators.clear();
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

            const gicon = lookupAppGicon(this, media);
            if (gicon) {
                this._iconActor.gicon = _getSymbolicGicon(gicon);
                return;
            }
            this._iconActor.icon_name = 'audio-x-generic-symbolic';
        }

        destroy() {
            stopPositionPolling(this);
            this._visualizer?.destroy();
            this._visualizer = null;

            if (this._mixer) {
                this._mixer.disconnectObject(this);
                this._mixer.close();
                this._mixer = null;
            }

            this._pidCache.clear();
            this._pendingPidLookups.clear();
            this._windowClassCache.clear();

            this._artCache?.destroy();
            this._artCache = null;

            this._popupArt?.disconnectObject(this);
            this._progressTrack?.disconnectObject(this);
            this.menu.disconnectObject(this);
            this._mprisManager.disconnectObject(this);
            this._preferences.disconnectObject(this);
            this.disconnectObject(this);

            super.destroy();
        }
    });
