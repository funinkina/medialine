import Adw from 'gi://Adw';
import Gtk from 'gi://Gtk';

import { ExtensionPreferences, gettext as _ } from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

export default class MediaBarPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings('org.gnome.shell.extensions.media-bar');

        // ── Display Page ──────────────────────────────────────────────
        const displayPage = new Adw.PreferencesPage({
            title: _('Display'),
            icon_name: 'video-display-symbolic',
        });
        window.add(displayPage);

        const iconGroup = new Adw.PreferencesGroup({
            title: _('Icon'),
        });
        displayPage.add(iconGroup);

        const iconTypeRow = new Adw.ComboRow({
            title: _('Icon source'),
            subtitle: _('Show album art, app icon, or playback status icon'),
        });
        const iconTypeModel = new Gtk.StringList();
        iconTypeModel.append(_('App icon'));
        iconTypeModel.append(_('Album art'));
        iconTypeModel.append(_('Playing status'));
        iconTypeRow.model = iconTypeModel;
        iconTypeRow.selected = settings.get_enum('icon-type');
        iconTypeRow.connect('notify::selected', () => {
            settings.set_enum('icon-type', iconTypeRow.selected);
        });
        iconGroup.add(iconTypeRow);

        const iconSizeRow = new Adw.SpinRow({
            title: _('Icon size'),
            subtitle: _('Size in pixels'),
            adjustment: new Gtk.Adjustment({
                lower: 8,
                upper: 64,
                step_increment: 1,
                value: settings.get_int('icon-size'),
            }),
        });
        iconSizeRow.connect('notify::value', () => {
            settings.set_int('icon-size', iconSizeRow.value);
        });
        iconGroup.add(iconSizeRow);

        const iconSpacingRow = new Adw.SpinRow({
            title: _('Icon spacing'),
            subtitle: _('Space between icon and text (px)'),
            adjustment: new Gtk.Adjustment({
                lower: 0,
                upper: 32,
                step_increment: 1,
                value: settings.get_int('icon-spacing'),
            }),
        });
        iconSpacingRow.connect('notify::value', () => {
            settings.set_int('icon-spacing', iconSpacingRow.value);
        });
        iconGroup.add(iconSpacingRow);

        const textGroup = new Adw.PreferencesGroup({
            title: _('Text'),
        });
        displayPage.add(textGroup);

        const separatorRow = new Adw.EntryRow({
            title: _('Separator'),
            text: settings.get_string('separator'),
        });
        separatorRow.connect('notify::text', () => {
            settings.set_string('separator', separatorRow.text);
        });
        textGroup.add(separatorRow);

        const maxWidthRow = new Adw.SpinRow({
            title: _('Max text width'),
            subtitle: _('Maximum label width in pixels (0 = unlimited)'),
            adjustment: new Gtk.Adjustment({
                lower: 0,
                upper: 1000,
                step_increment: 10,
                value: settings.get_int('max-text-width'),
            }),
        });
        maxWidthRow.connect('notify::value', () => {
            settings.set_int('max-text-width', maxWidthRow.value);
        });
        textGroup.add(maxWidthRow);

        const fieldsGroup = new Adw.PreferencesGroup({
            title: _('Visible fields'),
        });
        displayPage.add(fieldsGroup);

        const showTitleRow = new Adw.SwitchRow({
            title: _('Show title'),
        });
        showTitleRow.active = settings.get_boolean('show-title');
        showTitleRow.connect('notify::active', () => {
            settings.set_boolean('show-title', showTitleRow.active);
        });
        fieldsGroup.add(showTitleRow);

        const showArtistRow = new Adw.SwitchRow({
            title: _('Show artist'),
        });
        showArtistRow.active = settings.get_boolean('show-artist');
        showArtistRow.connect('notify::active', () => {
            settings.set_boolean('show-artist', showArtistRow.active);
        });
        fieldsGroup.add(showArtistRow);

        const showAlbumRow = new Adw.SwitchRow({
            title: _('Show album'),
        });
        showAlbumRow.active = settings.get_boolean('show-album');
        showAlbumRow.connect('notify::active', () => {
            settings.set_boolean('show-album', showAlbumRow.active);
        });
        fieldsGroup.add(showAlbumRow);

        // ── Panel Page ────────────────────────────────────────────────
        const panelPage = new Adw.PreferencesPage({
            title: _('Panel'),
            icon_name: 'view-grid-symbolic',
        });
        window.add(panelPage);

        const panelGroup = new Adw.PreferencesGroup({
            title: _('Position'),
        });
        panelPage.add(panelGroup);

        const positionRow = new Adw.ComboRow({
            title: _('Panel section'),
            subtitle: _('Which area of the top bar to place the indicator'),
        });
        const positionModel = new Gtk.StringList();
        positionModel.append(_('Left'));
        positionModel.append(_('Center'));
        positionModel.append(_('Right'));
        positionRow.model = positionModel;
        positionRow.selected = settings.get_enum('panel-position');
        positionRow.connect('notify::selected', () => {
            settings.set_enum('panel-position', positionRow.selected);
        });
        panelGroup.add(positionRow);

        const indexRow = new Adw.SpinRow({
            title: _('Position index'),
            subtitle: _('Order within the panel section (0 = first)'),
            adjustment: new Gtk.Adjustment({
                lower: 0,
                upper: 20,
                step_increment: 1,
                value: settings.get_int('panel-index'),
            }),
        });
        indexRow.connect('notify::value', () => {
            settings.set_int('panel-index', indexRow.value);
        });
        panelGroup.add(indexRow);
    }
}
