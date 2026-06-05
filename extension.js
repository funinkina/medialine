import GLib from 'gi://GLib';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';

import { ExtensionSettings } from './helpers/settings.js';
import { MprisManager } from './helpers/mprisManager.js';
import { Indicator } from './helpers/indicator.js';

const PANEL_POSITIONS = ['left', 'center', 'right'];

export default class MedialineExtension extends Extension {
    enable() {
        this._preferences = new ExtensionSettings(this);
        this._mprisManager = new MprisManager();
        this._indicator = null;
        this._enableTimeoutId = null;

        this._preferences.connectObject(
            'changed::panel-position', () => this._updateIndicatorPosition(),
            'changed::panel-index', () => this._updateIndicatorPosition(),
            this
        );

        this._enableTimeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 500, () => {
            if (this._preferences && this._mprisManager) {
                const position = PANEL_POSITIONS[this._preferences.panelPosition] ?? 'right';
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
        if (this._enableTimeoutId) {
            GLib.Source.remove(this._enableTimeoutId);
            this._enableTimeoutId = null;
        }

        this._preferences.disconnectObject(this);

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
