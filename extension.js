import GLib from 'gi://GLib';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';
import * as MprisModule from 'resource:///org/gnome/shell/ui/mpris.js';

import { ExtensionSettings } from './helpers/settings.js';
import { MprisManager } from './helpers/mprisManager.js';
import { Indicator } from './helpers/indicator.js';

const PANEL_POSITIONS = ['left', 'center', 'right'];
const MprisSource = MprisModule.MprisSource ?? MprisModule.MediaSection;

export default class MedialineExtension extends Extension {
    enable() {
        this._preferences = new ExtensionSettings(this);
        this._mprisManager = new MprisManager();
        this._indicator = null;
        this._enableIdleId = null;
        this._origAddPlayer = null;
        this._panelSignalIds = [];

        this._preferences.connectObject(
            'changed::panel-position', () => {
                this._updateIndicatorPosition();
                this._connectPanelBoxSignals();
            },
            'changed::panel-index', () => this._updateIndicatorPosition(),
            'changed::hide-default-notification', () => this._updateDefaultNotification(),
            this
        );

        this._enableIdleId = GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
            if (this._preferences && this._mprisManager) {
                const position = PANEL_POSITIONS[this._preferences.panelPosition] ?? 'right';
                const index = this._preferences.panelIndex || 0;
                this._indicator = new Indicator(this._preferences, this, this._mprisManager);
                Main.panel.addToStatusArea(this.uuid, this._indicator, index, position);
                this._connectPanelBoxSignals();
            }
            this._enableIdleId = null;
            return GLib.SOURCE_REMOVE;
        });

        this._updateDefaultNotification();
    }

    _connectPanelBoxSignals() {
        for (const [box, id] of this._panelSignalIds)
            box.disconnect(id);
        this._panelSignalIds = [];

        const positionName = PANEL_POSITIONS[this._preferences?.panelPosition] ?? 'right';
        const boxes = {
            left: Main.panel._leftBox,
            center: Main.panel._centerBox,
            right: Main.panel._rightBox,
        };
        const targetBox = boxes[positionName];
        if (!targetBox) return;

        // Re-enforce our index whenever another extension (e.g. AppIndicator)
        // adds an actor to the same box after us, shifting our position.
        const id = targetBox.connect('actor-added', (_box, actor) => {
            const myContainer = this._indicator?.container ?? this._indicator;
            if (myContainer && actor !== myContainer)
                this._updateIndicatorPosition();
        });
        this._panelSignalIds.push([targetBox, id]);
    }

    _updateDefaultNotification() {
        const shouldHide = this._preferences.hideDefaultNotification;
        if (!MprisSource) return;

        const mediaSource =
            Main.panel.statusArea.dateMenu?._messageList?._messageView?._mediaSource ??
            Main.panel.statusArea.dateMenu?._messageList?._mediaSection;
        if (!mediaSource) return;

        if (shouldHide) {
            if (this._origAddPlayer) return;
            this._origAddPlayer = MprisSource.prototype._addPlayer;
            MprisSource.prototype._addPlayer = () => { };
            if (mediaSource._players != null) {
                for (const player of mediaSource._players.values()) {
                    mediaSource._onNameOwnerChanged(null, null, [player._busName, player._busName, '']);
                }
            }
        } else {
            if (!this._origAddPlayer) return;
            MprisSource.prototype._addPlayer = this._origAddPlayer;
            this._origAddPlayer = null;
            mediaSource._onProxyReady();
        }
    }

    _updateIndicatorPosition() {
        if (!this._indicator) return;

        const positionName = PANEL_POSITIONS[this._preferences.panelPosition] ?? 'right';
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
        if (this._enableIdleId) {
            GLib.Source.remove(this._enableIdleId);
            this._enableIdleId = null;
        }

        for (const [box, id] of this._panelSignalIds)
            box.disconnect(id);
        this._panelSignalIds = [];

        this._preferences.disconnectObject(this);

        if (this._origAddPlayer && MprisSource) {
            MprisSource.prototype._addPlayer = this._origAddPlayer;
            const mediaSource =
                Main.panel.statusArea.dateMenu?._messageList?._messageView?._mediaSource ??
                Main.panel.statusArea.dateMenu?._messageList?._mediaSection;
            if (mediaSource)
                mediaSource._onProxyReady();
            this._origAddPlayer = null;
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
