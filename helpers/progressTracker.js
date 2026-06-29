import GLib from 'gi://GLib';
import Clutter from 'gi://Clutter';

import { formatTime } from './colorUtils.js';
import { POLL_MS, PROGRESS_HEIGHT, PROGRESS_THUMB_SIZE } from './constants.js';

export function startPositionPolling(self) {
    pollPosition(self);
    if (self._positionTimerId) return;
    self._positionTimerId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, POLL_MS, () => {
        pollPosition(self);
        return GLib.SOURCE_CONTINUE;
    });
}

export function stopPositionPolling(self) {
    if (self._positionTimerId) {
        GLib.Source.remove(self._positionTimerId);
        self._positionTimerId = null;
    }
}

export function pollPosition(self) {
    if (self._mprisManager.allMedia.length !== 1) return;

    if (self._dragging) {
        updateProgress(self);
        return;
    }
    self._mprisManager.getPositionAsync((position) => {
        if (!self._artCache) return;
        self._position = position;
        updateProgress(self);
    });
}

export function updateProgress(self) {
    const media = self._mprisManager.currentMedia;
    if (!media) {
        self._timeCurrent.text = '0:00';
        self._timeTotal.text = '0:00';
        self._progressFill.width = 0;
        self._progressThumb.visible = false;
        return;
    }
    const length = media.length || 0;
    const alloc = self._progressTrack.get_allocation_box();
    const trackWidth = alloc ? Math.max(0, alloc.x2 - alloc.x1) : 0;

    let ratio;
    if (self._dragging) {
        ratio = self._dragRatio;
        self._timeCurrent.text = formatTime(Math.floor(ratio * length));
    } else {
        const position = self._position;
        ratio = length > 0 ? Math.max(0, Math.min(1, position / length)) : 0;
        self._timeCurrent.text = formatTime(position);
    }
    self._timeTotal.text = formatTime(length);

    const fillWidth = Math.floor(ratio * trackWidth);
    self._progressFill.set_position(0, 0);
    self._progressFill.width = fillWidth;

    const canSeek = !!media.canSeek && length > 0 && !!media.trackId;
    const showThumb = canSeek && (self._dragging || self._progressTrack.hover);
    self._progressThumb.visible = showThumb;
    if (showThumb) {
        self._progressThumb.set_position(
            Math.floor(fillWidth - PROGRESS_THUMB_SIZE / 2),
            (PROGRESS_HEIGHT - PROGRESS_THUMB_SIZE) / 2);
    }
}

export function ratioFromEvent(self, event) {
    const media = self._mprisManager.currentMedia;
    if (!media || !media.length) return null;
    const alloc = self._progressTrack.get_allocation_box();
    const trackWidth = alloc ? Math.max(1, alloc.x2 - alloc.x1) : 1;
    const [stageX] = event.get_coords();
    const [trackStageX] = self._progressTrack.get_transformed_position();
    const localX = stageX - trackStageX;
    return Math.max(0, Math.min(1, localX / trackWidth));
}

export function onProgressPress(self, event) {
    if (event.get_button() !== Clutter.BUTTON_PRIMARY)
        return Clutter.EVENT_PROPAGATE;
    const media = self._mprisManager.currentMedia;
    if (!media || !media.canSeek || !media.length || !media.trackId)
        return Clutter.EVENT_PROPAGATE;
    const ratio = ratioFromEvent(self, event);
    if (ratio === null) return Clutter.EVENT_PROPAGATE;
    self._dragging = true;
    self._dragRatio = ratio;
    updateProgress(self);
    return Clutter.EVENT_STOP;
}

export function onProgressMotion(self, event) {
    if (!self._dragging) return Clutter.EVENT_PROPAGATE;
    const ratio = ratioFromEvent(self, event);
    if (ratio === null) return Clutter.EVENT_PROPAGATE;
    self._dragRatio = ratio;
    updateProgress(self);
    return Clutter.EVENT_STOP;
}

export function onProgressRelease(self, event) {
    if (!self._dragging) return Clutter.EVENT_PROPAGATE;
    if (event.get_button() !== Clutter.BUTTON_PRIMARY)
        return Clutter.EVENT_PROPAGATE;
    const ratio = ratioFromEvent(self, event) ?? self._dragRatio;
    const media = self._mprisManager.currentMedia;
    self._dragging = false;
    if (media && media.length)
        self._mprisManager.setPosition(Math.floor(ratio * media.length));
    updateProgress(self);
    return Clutter.EVENT_STOP;
}
