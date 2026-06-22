import Gvc from 'gi://Gvc';
import Gio from 'gi://Gio';
import Clutter from 'gi://Clutter';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {
    CLICK_NOTHING, CLICK_OPEN_POPUP, CLICK_PLAY_PAUSE, CLICK_OPEN_SETTINGS,
    CLICK_NEXT_TRACK, CLICK_PREV_TRACK, CLICK_VOLUME_UP, CLICK_VOLUME_DOWN,
    CLICK_RAISE_PLAYER, SCROLL_NOTCH,
} from './constants.js';
import { focusPlayerWindow } from './windowFocus.js';

export function setupClickHandling(self) {
    self.connectObject('captured-event',
        (_actor, event) => {
            const type = event.type();
            if (type === Clutter.EventType.BUTTON_PRESS)
                return handleButtonPress(self, event);
            if (type === Clutter.EventType.SCROLL)
                return handleScroll(self, event);
            return Clutter.EVENT_PROPAGATE;
        }, self);
}

function handleButtonPress(self, event) {
    const button = event.get_button();
    let action;
    if (button === Clutter.BUTTON_PRIMARY)
        action = self._preferences.leftClickAction;
    else if (button === Clutter.BUTTON_MIDDLE)
        action = self._preferences.middleClickAction;
    else if (button === Clutter.BUTTON_SECONDARY)
        action = self._preferences.rightClickAction;
    else
        return Clutter.EVENT_PROPAGATE;

    return dispatchAction(self, action);
}

function handleScroll(self, event) {
    let action;
    switch (event.get_scroll_direction()) {
        case Clutter.ScrollDirection.UP:
            action = self._preferences.scrollUpAction;
            break;
        case Clutter.ScrollDirection.DOWN:
            action = self._preferences.scrollDownAction;
            break;
        case Clutter.ScrollDirection.SMOOTH: {
            const [, dy] = event.get_scroll_delta();
            self._scrollAccum += dy;
            if (Math.abs(self._scrollAccum) < SCROLL_NOTCH)
                return Clutter.EVENT_STOP;
            action = self._scrollAccum < 0
                ? self._preferences.scrollUpAction
                : self._preferences.scrollDownAction;
            self._scrollAccum = 0;
            break;
        }
        default:
            return Clutter.EVENT_PROPAGATE;
    }

    return dispatchAction(self, action);
}

function dispatchAction(self, action) {
    if (action === CLICK_OPEN_POPUP) {
        self.menu.toggle();
        return Clutter.EVENT_STOP;
    }

    if (action !== CLICK_NOTHING)
        executeClickAction(self, action);

    return Clutter.EVENT_STOP;
}

function executeClickAction(self, action) {
    switch (action) {
        case CLICK_PLAY_PAUSE: self._mprisManager.playPause(); break;
        case CLICK_OPEN_SETTINGS: self._extension.openPreferences(); break;
        case CLICK_NEXT_TRACK: self._mprisManager.next(); break;
        case CLICK_PREV_TRACK: self._mprisManager.previous(); break;
        case CLICK_VOLUME_UP: adjustVolume(self, 5); break;
        case CLICK_VOLUME_DOWN: adjustVolume(self, -5); break;
        case CLICK_RAISE_PLAYER: focusPlayerWindow(self, self._mprisManager.currentMedia); break;
    }
}

function adjustVolume(self, deltaPct) {
    ensureMixer(self);
    if (self._mixer.get_state() === Gvc.MixerControlState.READY)
        applyVolumeDelta(self, deltaPct);
    else
        self._pendingVolumeDelta += deltaPct;
}

function ensureMixer(self) {
    if (self._mixer) return;
    self._mixer = new Gvc.MixerControl({ name: 'Medialine' });
    self._mixer.connectObject('state-changed', () => {
        if (self._mixer.get_state() !== Gvc.MixerControlState.READY)
            return;
        if (self._pendingVolumeDelta) {
            const delta = self._pendingVolumeDelta;
            self._pendingVolumeDelta = 0;
            applyVolumeDelta(self, delta);
        }
    }, self);
    self._mixer.open();
}

function applyVolumeDelta(self, deltaPct) {
    const sink = self._mixer.get_default_sink();
    if (!sink) return;
    const maxNorm = self._mixer.get_vol_max_norm();
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

export function toggleShuffle(self) {
    const media = self._mprisManager.currentMedia;
    if (!media || media.shuffle === null || !media.canControl) return;
    self._mprisManager.setShuffle(!media.shuffle);
}

export function cycleRepeat(self) {
    const media = self._mprisManager.currentMedia;
    if (!media || media.loopStatus === null || !media.canControl) return;
    const order = ['None', 'Track', 'Playlist'];
    const idx = order.indexOf(media.loopStatus);
    const next = order[(idx >= 0 ? idx + 1 : 1) % order.length];
    self._mprisManager.setLoopStatus(next);
}
