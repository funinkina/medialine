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

const Indicator = GObject.registerClass(
    class Indicator extends PanelMenu.Button {
        _init(preferences, extension, mprisManager) {
            super._init(0.0, _('Media Bar'));

            this._preferences = preferences;
            this._extension = extension;
            this._mprisManager = mprisManager;
            this._mediaChangedId = null;
            this._prefsChangedId = null;
            this._currentArtUrl = null;

            this._buildUI();
            this._setupMenu();

            this._mediaChangedId = this._mprisManager.connect('media-changed', () => {
                this._onMediaChanged();
            });

            this._prefsChangedId = this._preferences.connectChanged(() => {
                this._onMediaChanged();
            });

            // Show current state immediately if a player is already active
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
            const settingsItem = new PopupMenu.PopupMenuItem(_('Settings'));
            settingsItem.connect('activate', () => {
                this._extension.openPreferences().catch(e =>
                    logError(e, 'Media Bar: Failed to open preferences')
                );
            });
            this.menu.addMenuItem(settingsItem);
        }

        _onMediaChanged() {
            const media = this._mprisManager.currentMedia;

            if (!media || media.status === 'Stopped') {
                this.hide();
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
        }

        _updateIcon(media, prefs) {
            const useArt = prefs.iconType === ICON_TYPE_ART;

            if (useArt && media.artUrl && media.artUrl.startsWith('file://')) {
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
            // Use app id as icon name; Shell falls back gracefully if it doesn't exist
            this._iconActor.icon_name = appId || 'audio-x-generic-symbolic';
        }

        destroy() {
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
            if (this._preferences) {
                this._indicator = new Indicator(
                    this._preferences,
                    this,
                    this._mprisManager
                );
                this._updateIndicatorPosition();
            }
            this._enableTimeoutId = null;
            return GLib.SOURCE_REMOVE;
        });
    }

    _updateIndicatorPosition() {
        if (!this._indicator) return;

        const position = ['left', 'center', 'right'][this._preferences.panelPosition] || 'right';
        const index = this._preferences.panelIndex || 0;

        this._indicator.destroy();
        this._indicator = null;

        if (this._preferences && this._mprisManager) {
            this._indicator = new Indicator(
                this._preferences,
                this,
                this._mprisManager
            );
            Main.panel.addToStatusArea(this.uuid, this._indicator, index, position);
        }
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
