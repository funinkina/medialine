import GLib from 'gi://GLib';
import Clutter from 'gi://Clutter';
import Pango from 'gi://Pango';
import St from 'gi://St';

import { gettext as _ } from 'resource:///org/gnome/shell/extensions/extension.js';

import {
    ANIM_MS, ART_SIZE, BUTTON_SIZE, COMPACT_BUTTON_SIZE,
    COMPACT_EXPAND_CLICK, COMPACT_EXPAND_HOVER, COMPACT_HEIGHT,
    COMPACT_WIDTH, EXPANDED_HEIGHT, EXPANDED_WIDTH,
    POLL_MS, PROGRESS_HEIGHT, PROGRESS_THUMB_SIZE,
    VIS_WIDTH, VIS_HEIGHT,
} from './constants.js';
import { escMarkup, formatTime } from './colorUtils.js';
import { applyArtBin } from './artDisplay.js';
import { makeButton, buildProgressWidgets } from './widgetFactory.js';
import { lookupAppGicon, focusPlayerWindow } from './windowFocus.js';
import { Visualizer } from './visualizer.js';

function loopNext(current) {
    const order = ['None', 'Track', 'Playlist'];
    const idx = order.indexOf(current);
    return order[(idx >= 0 ? idx + 1 : 1) % order.length];
}

export class ExpandableMediaRow {
    constructor(indicator, media) {
        this._indicator = indicator;
        this.media = media;
        this._expanded = false;
        this._hiddenForExpansion = false;
        this._position = 0;
        this._dragging = false;
        this._dragRatio = 0;
        this._pollId = null;

        this.actor = new St.Widget({
            layout_manager: new Clutter.FixedLayout(),
            x_expand: true,
            reactive: true,
            track_hover: true,
            clip_to_allocation: true,
            width: COMPACT_WIDTH,
            height: COMPACT_HEIGHT,
        });

        this._buildActors();
        this._connectEvents();
        this.updateMedia(media);
        this.setExpanded(false, false, true);
    }

    _buildActors() {
        const styles = this._indicator._popupStyles;

        this._art = new St.Widget({
            layout_manager: new Clutter.FixedLayout(),
            reactive: true,
            style: styles.artFallback,
        });
        this._appIcon = new St.Icon({ icon_name: 'audio-x-generic-symbolic', icon_size: 32 });
        this._art.add_child(this._appIcon);

        this._title = new St.Label({ text: '', style: styles.title });
        this._title.clutter_text.ellipsize = Pango.EllipsizeMode.END;

        this._subtitle = new St.Label({ text: '', style: styles.subtitle });
        this._subtitle.clutter_text.use_markup = true;
        this._subtitle.clutter_text.ellipsize = Pango.EllipsizeMode.END;

        const pw = buildProgressWidgets(styles);
        this._timeCurrent = pw.timeCurrent;
        this._timeTotal = pw.timeTotal;
        this._timeRow = pw.timeRow;
        this._progressTrack = pw.progressTrack;
        this._progressFill = pw.progressFill;
        this._progressThumb = pw.progressThumb;

        this._visualizer = new Visualizer(styles);
        this._visualizer.actor.opacity = 0;
        this._visualizer.actor.hide();

        this._shuffleBtn = this._makeButton('media-playlist-shuffle-symbolic', 16, () => this._toggleShuffle());
        this._prevBtn = this._makeButton('media-skip-backward-symbolic', 18, () => this._indicator._mprisManager.previous(this.media.busName));
        this._playBtn = this._makeButton('media-playback-start-symbolic', 24, () => this._indicator._mprisManager.playPause(this.media.busName));
        this._nextBtn = this._makeButton('media-skip-forward-symbolic', 18, () => this._indicator._mprisManager.next(this.media.busName));
        this._repeatBtn = this._makeButton('media-playlist-repeat-symbolic', 16, () => this._cycleRepeat());

        for (const actor of [
            this._art, this._title, this._subtitle, this._timeRow,
            this._progressTrack, this._shuffleBtn, this._prevBtn, this._playBtn,
            this._nextBtn, this._repeatBtn, this._visualizer.actor,
        ])
            this.actor.add_child(actor);
    }

    _connectEvents() {
        this._art.connectObject('button-release-event', (_a, event) => {
            if (event.type() === Clutter.EventType.BUTTON_RELEASE) {
                focusPlayerWindow(this._indicator, this.media);
                return Clutter.EVENT_STOP;
            }
            return Clutter.EVENT_PROPAGATE;
        }, this);

        this.actor.connectObject(
            'notify::hover', () => this._onHoverChanged(),
            'button-release-event', (_a, event) => this._onRowButtonRelease(event),
            'notify::allocation', () => this._updateProgress(),
            this);

        this._progressTrack.connectObject(
            'button-press-event', (_a, event) => this._onProgressPress(event),
            'motion-event', (_a, event) => this._onProgressMotion(event),
            'button-release-event', (_a, event) => this._onProgressRelease(event),
            'notify::hover', () => this._updateProgress(),
            this);
    }

    _makeButton(iconName, iconSize, onClick) {
        const btn = makeButton(this._indicator._popupStyles, iconName, iconSize);
        btn.connectObject(
            'notify::hover', () => this._syncButtonStyle(btn),
            'clicked', onClick,
            this);
        return btn;
    }

    updateMedia(media) {
        this.media = media;
        this._updateInfo();
        this._updateArt();
        this._syncControlState();
        this._syncColors();
        this._updateProgress();
    }

    _updateInfo() {
        const media = this.media;
        this._title.text = media.title || (media.identity ? `${media.identity} is playing media` : _('Unknown'));
        const artist = media.artist ? escMarkup(media.artist) : '';
        const album = media.album ? escMarkup(media.album) : '';
        const separator = (artist && album) ? ` — ` : '';
        this._subtitle.clutter_text.set_markup(artist + separator + album);
        this._subtitle.visible = !!(artist || album);
    }

    _updateArt() {
        const appGicon = lookupAppGicon(this._indicator, this.media);
        applyArtBin(this._art, this._appIcon, this.media, {
            boxSize: ART_SIZE,
            fallbackIconSize: 32,
        }, this._indicator._popupStyles, this._indicator._preferences, appGicon);
    }

    _syncControlState() {
        const media = this.media;
        this._playBtn.get_child().icon_name = media.status === 'Playing'
            ? 'media-playback-pause-symbolic'
            : 'media-playback-start-symbolic';

        this._visualizer.setPlaying(media.status === 'Playing');

        this._prevBtn.reactive = media.canGoPrevious !== false;
        this._nextBtn.reactive = media.canGoNext !== false;
        this._prevBtn.opacity = this._prevBtn.reactive ? 255 : 110;
        this._nextBtn.opacity = this._nextBtn.reactive ? 255 : 110;

        const shuffleAvail = media.shuffle !== null && media.canControl;
        this._shuffleBtn.reactive = shuffleAvail;
        this._shuffleBtn.opacity = shuffleAvail ? 255 : 110;
        this._shuffleBtn._active = shuffleAvail && media.shuffle;

        const repeatAvail = media.loopStatus !== null && media.canControl;
        this._repeatBtn.reactive = repeatAvail;
        this._repeatBtn.opacity = repeatAvail ? 255 : 110;
        this._repeatBtn.get_child().icon_name = media.loopStatus === 'Track'
            ? 'media-playlist-repeat-song-symbolic'
            : 'media-playlist-repeat-symbolic';
        this._repeatBtn._active = repeatAvail && media.loopStatus !== 'None';

        for (const btn of [this._shuffleBtn, this._prevBtn, this._playBtn, this._nextBtn, this._repeatBtn])
            this._syncButtonStyle(btn);
    }

    _syncColors() {
        const styles = this._indicator._popupStyles;
        this._title.style = styles.title;
        this._subtitle.style = styles.subtitle;
        this._timeCurrent.style = styles.time;
        this._timeTotal.style = styles.time;
        this._progressTrack.style = styles.progressTrack;
        this._progressFill.style = styles.progressFill;
        this._progressThumb.style = styles.progressThumb;
        this._visualizer.setStyle(styles);
        for (const btn of [this._shuffleBtn, this._prevBtn, this._playBtn, this._nextBtn, this._repeatBtn]) {
            btn.get_child().style = styles.iconColor;
            this._syncButtonStyle(btn);
        }
    }

    _syncButtonStyle(btn) {
        const styles = this._indicator._popupStyles;
        if (btn.hover)
            btn.style = this._expanded ? styles.btnHover : styles.compactBtnHover;
        else if (btn._active)
            btn.style = styles.btnActive;
        else
            btn.style = this._expanded ? styles.btn : styles.compactBtn;
    }

    setExpanded(expanded, hideBecauseOtherExpanded = false, immediate = false) {
        this._expanded = expanded;
        this._hiddenForExpansion = hideBecauseOtherExpanded;
        this.actor.visible = true;
        this.actor.reactive = !hideBecauseOtherExpanded;

        const layout = expanded ? this._expandedLayout() : this._compactLayout();
        const duration = immediate ? 0 : ANIM_MS;
        const rowHeight = hideBecauseOtherExpanded ? 0 : layout.rowHeight;
        const rowWidth = hideBecauseOtherExpanded ? 0 : layout.rowWidth;
        const rowOpacity = hideBecauseOtherExpanded ? 0 : 255;

        this.actor.ease({
            width: rowWidth,
            height: rowHeight,
            opacity: rowOpacity,
            duration,
            mode: Clutter.AnimationMode.EASE_OUT_CUBIC,
            onComplete: () => {
                if (this.actor)
                    this.actor.visible = !hideBecauseOtherExpanded;
            },
        });

        if (hideBecauseOtherExpanded) {
            this._stopPolling();
            this._visualizer.setActive(false);
            return;
        }

        this._animateActor(this._art, layout.art, 255, duration);
        this._animateActor(this._title, layout.title, 255, duration);
        this._animateActor(this._subtitle, layout.subtitle, this._subtitle.visible ? 255 : 0, duration);
        this._animateActor(this._playBtn, layout.play, 255, duration);
        this._animateActor(this._nextBtn, layout.next, 255, duration);
        this._setExpandedControlsVisible(expanded, layout, duration);

        const visOn = this._indicator._preferences.popupShowVisualizer;
        if (expanded && visOn) {
            this._animateActor(this._visualizer.actor, layout.visualizer, 255, duration);
            this._visualizer.actor.reactive = false;
        } else {
            this._visualizer.actor.reactive = false;
            this._visualizer.actor.ease({
                opacity: 0,
                duration,
                mode: Clutter.AnimationMode.EASE_OUT_CUBIC,
                onComplete: () => {
                    if (this.actor &&
                        !(this._expanded && this._indicator._preferences.popupShowVisualizer))
                        this._visualizer.actor.hide();
                },
            });
        }
        this._visualizer.setActive(expanded && visOn && this._indicator.menu.isOpen);
        this._visualizer.setPlaying(this.media?.status === 'Playing');

        for (const btn of [this._shuffleBtn, this._prevBtn, this._playBtn, this._nextBtn, this._repeatBtn])
            this._syncButtonStyle(btn);

        if (expanded) {
            this._startPolling();
            this._pollPosition();
        } else {
            this._stopPolling();
        }
    }

    _compactLayout() {
        return {
            rowWidth: COMPACT_WIDTH,
            rowHeight: COMPACT_HEIGHT,
            art: { x: 0, y: 0, w: ART_SIZE, h: ART_SIZE },
            title: { x: 78, y: 13, w: 224, h: 24 },
            subtitle: { x: 78, y: 39, w: 224, h: 22 },
            play: { x: 312, y: 21, w: COMPACT_BUTTON_SIZE, h: COMPACT_BUTTON_SIZE },
            next: { x: 350, y: 21, w: COMPACT_BUTTON_SIZE, h: COMPACT_BUTTON_SIZE },
        };
    }

    _expandedLayout() {
        const textW = EXPANDED_WIDTH - 80 - VIS_WIDTH - 12;
        return {
            rowWidth: EXPANDED_WIDTH,
            rowHeight: EXPANDED_HEIGHT,
            art: { x: 0, y: 0, w: ART_SIZE, h: ART_SIZE },
            title: { x: 80, y: 8, w: textW, h: 26 },
            subtitle: { x: 80, y: 38, w: textW, h: 24 },
            visualizer: { x: EXPANDED_WIDTH - VIS_WIDTH, y: 20, w: VIS_WIDTH, h: VIS_HEIGHT },
            time: { x: 0, y: 82, w: EXPANDED_WIDTH, h: 16 },
            progress: { x: 0, y: 102, w: EXPANDED_WIDTH, h: PROGRESS_HEIGHT },
            shuffle: { x: 62, y: 122, w: BUTTON_SIZE, h: BUTTON_SIZE },
            prev: { x: 118, y: 122, w: BUTTON_SIZE, h: BUTTON_SIZE },
            play: { x: 174, y: 122, w: BUTTON_SIZE, h: BUTTON_SIZE },
            next: { x: 230, y: 122, w: BUTTON_SIZE, h: BUTTON_SIZE },
            repeat: { x: 286, y: 122, w: BUTTON_SIZE, h: BUTTON_SIZE },
        };
    }

    _animateActor(actor, box, opacity = 255, duration = ANIM_MS) {
        actor.show();
        actor.ease({
            x: box.x,
            y: box.y,
            width: box.w,
            height: box.h,
            opacity,
            duration,
            mode: Clutter.AnimationMode.EASE_OUT_CUBIC,
        });
    }

    _setExpandedControlsVisible(expanded, layout, duration) {
        const expandedActors = [
            [this._timeRow, layout.time],
            [this._progressTrack, layout.progress],
            [this._shuffleBtn, layout.shuffle],
            [this._prevBtn, layout.prev],
            [this._repeatBtn, layout.repeat],
        ];

        for (const [actor, box] of expandedActors) {
            if (expanded) {
                this._animateActor(actor, box, 255, duration);
                actor.reactive = true;
            } else {
                actor.reactive = false;
                actor.ease({
                    opacity: 0,
                    duration,
                    mode: Clutter.AnimationMode.EASE_OUT_CUBIC,
                    onComplete: () => {
                        if (!this._expanded)
                            actor.hide();
                    },
                });
            }
        }
    }

    _onHoverChanged() {
        if (this._indicator._preferences.popupCompactExpandMode !== COMPACT_EXPAND_HOVER)
            return;

        if (this.actor.hover)
            this._indicator._setExpandedBusName(this.media.busName);
        else if (this._indicator._expandedBusName === this.media.busName)
            this._indicator._setExpandedBusName(null);
    }

    _onRowButtonRelease(event) {
        if (event.get_button && event.get_button() !== Clutter.BUTTON_PRIMARY)
            return Clutter.EVENT_PROPAGATE;
        if (this._indicator._preferences.popupCompactExpandMode !== COMPACT_EXPAND_CLICK)
            return Clutter.EVENT_PROPAGATE;
        if (this._eventFromInteractiveChild(event))
            return Clutter.EVENT_PROPAGATE;

        const alreadyExpanded =
            this._indicator._expandedBusName === this.media.busName;
        this._indicator._setExpandedBusName(
            alreadyExpanded ? null : this.media.busName);
        return Clutter.EVENT_STOP;
    }

    _eventFromInteractiveChild(event) {
        const source = event.get_source?.();
        return this._contains(this._art, source) ||
            this._contains(this._playBtn, source) ||
            this._contains(this._nextBtn, source) ||
            this._contains(this._shuffleBtn, source) ||
            this._contains(this._prevBtn, source) ||
            this._contains(this._repeatBtn, source) ||
            this._contains(this._progressTrack, source);
    }

    _contains(root, actor) {
        for (let cur = actor; cur; cur = cur.get_parent?.()) {
            if (cur === root)
                return true;
        }
        return false;
    }

    _toggleShuffle() {
        if (!this.media || this.media.shuffle === null || !this.media.canControl)
            return;
        this._indicator._mprisManager.setShuffle(!this.media.shuffle, this.media.busName);
    }

    _cycleRepeat() {
        if (!this.media || this.media.loopStatus === null || !this.media.canControl)
            return;
        this._indicator._mprisManager.setLoopStatus(loopNext(this.media.loopStatus), this.media.busName);
    }

    _startPolling() {
        if (this._pollId)
            return;
        this._pollId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, POLL_MS, () => {
            this._pollPosition();
            return GLib.SOURCE_CONTINUE;
        });
    }

    _stopPolling() {
        if (this._pollId) {
            GLib.Source.remove(this._pollId);
            this._pollId = null;
        }
        this._dragging = false;
    }

    _pollPosition() {
        if (!this._expanded || !this.media?.busName)
            return;
        if (this._dragging) {
            this._updateProgress();
            return;
        }
        this._indicator._mprisManager.getPositionAsync((position) => {
            if (!this.actor)
                return;
            this._position = position;
            this._updateProgress();
        }, this.media.busName);
    }

    _updateProgress() {
        const media = this.media;
        if (!media) {
            this._timeCurrent.text = '0:00';
            this._timeTotal.text = '0:00';
            this._progressFill.width = 0;
            this._progressThumb.visible = false;
            return;
        }

        const length = media.length || 0;
        const trackWidth = Math.max(0, this._progressTrack.width || 0);
        let ratio;
        if (this._dragging) {
            ratio = this._dragRatio;
            this._timeCurrent.text = formatTime(Math.floor(ratio * length));
        } else {
            ratio = length > 0 ? Math.max(0, Math.min(1, this._position / length)) : 0;
            this._timeCurrent.text = formatTime(this._position);
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
        if (!this.media || !this.media.length)
            return null;
        const trackWidth = Math.max(1, this._progressTrack.width || 1);
        const [stageX] = event.get_coords();
        const [trackStageX] = this._progressTrack.get_transformed_position();
        return Math.max(0, Math.min(1, (stageX - trackStageX) / trackWidth));
    }

    _onProgressPress(event) {
        if (event.get_button() !== Clutter.BUTTON_PRIMARY)
            return Clutter.EVENT_PROPAGATE;
        if (!this.media || !this.media.canSeek || !this.media.length || !this.media.trackId)
            return Clutter.EVENT_PROPAGATE;
        const ratio = this._ratioFromEvent(event);
        if (ratio === null)
            return Clutter.EVENT_PROPAGATE;
        this._dragging = true;
        this._dragRatio = ratio;
        this._updateProgress();
        return Clutter.EVENT_STOP;
    }

    _onProgressMotion(event) {
        if (!this._dragging)
            return Clutter.EVENT_PROPAGATE;
        const ratio = this._ratioFromEvent(event);
        if (ratio === null)
            return Clutter.EVENT_PROPAGATE;
        this._dragRatio = ratio;
        this._updateProgress();
        return Clutter.EVENT_STOP;
    }

    _onProgressRelease(event) {
        if (!this._dragging)
            return Clutter.EVENT_PROPAGATE;
        if (event.get_button() !== Clutter.BUTTON_PRIMARY)
            return Clutter.EVENT_PROPAGATE;
        const ratio = this._ratioFromEvent(event) ?? this._dragRatio;
        this._dragging = false;
        if (this.media?.length)
            this._indicator._mprisManager.setPosition(Math.floor(ratio * this.media.length), this.media.busName);
        this._updateProgress();
        return Clutter.EVENT_STOP;
    }

    stop() {
        this._stopPolling();
        this.setExpanded(false, false);
    }

    animateOutAndDestroy() {
        this._stopPolling();
        this.actor.reactive = false;
        this.actor.ease({
            height: 0,
            opacity: 0,
            duration: ANIM_MS,
            mode: Clutter.AnimationMode.EASE_OUT_CUBIC,
            onComplete: () => this.destroy(),
        });
    }

    destroy() {
        this._stopPolling();
        this._visualizer.destroy();
        this.actor.disconnectObject(this);
        this._art.disconnectObject(this);
        this._progressTrack.disconnectObject(this);
        for (const btn of [this._shuffleBtn, this._prevBtn, this._playBtn, this._nextBtn, this._repeatBtn])
            btn.disconnectObject(this);
        this.actor.destroy();
        this.actor = null;
    }
}
