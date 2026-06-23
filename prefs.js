import Adw from 'gi://Adw';
import Gdk from 'gi://Gdk';
import Gio from 'gi://Gio';
import Gtk from 'gi://Gtk';

import { ExtensionPreferences, gettext as _ } from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

export default class MedialinePreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings();

        this._registerIconPath();

        window.add(this._buildAppearancePage(settings, window));
        window.add(this._buildPanelPage(settings));
        window.add(this._buildPopupPage(settings));
        window.add(this._buildMousePage(settings));

        this._addAboutButton(window);
    }

    _registerIconPath() {
        const display = Gdk.Display.get_default();
        if (!display) return;
        const iconTheme = Gtk.IconTheme.get_for_display(display);
        const iconDir = this.dir.get_child('icons').get_path();
        if (iconDir && !iconTheme.get_search_path().includes(iconDir))
            iconTheme.add_search_path(iconDir);
    }

    _addAboutButton(window) {
        const button = new Gtk.Button({
            icon_name: 'emblem-favorite-symbolic',
            tooltip_text: _('About Medialine'),
        });
        button.add_css_class('flat');
        button.connect('clicked', () => this._showAbout(window));

        const headerBar = this._findHeaderBar(window);
        if (headerBar)
            headerBar.pack_start(button);
    }

    _findHeaderBar(widget) {
        if (widget instanceof Adw.HeaderBar || widget instanceof Gtk.HeaderBar)
            return widget;
        let child = widget.get_first_child?.();
        while (child) {
            const found = this._findHeaderBar(child);
            if (found) return found;
            child = child.get_next_sibling();
        }
        return null;
    }

    _showAbout(parent) {
        const props = {
            application_name: _('Medialine'),
            application_icon: 'medialine',
            developer_name: 'Aryan Kushwaha',
            version: String(this.metadata.version ?? ''),
            comments: _('Shows currently playing media in the top bar in a minimal elegant way.'),
            website: 'https://github.com/funinkina/medialine',
            issue_url: 'https://github.com/funinkina/medialine/issues',
            support_url: 'https://www.buymeacoffee.com/funinkina',
            developers: ['Aryan Kushwaha <hello@funinkina.co.in>'],
            copyright: '© 2025-2026 Aryan Kushwaha',
            license_type: Gtk.License.MIT_X11,
        };

        const about = new Adw.AboutDialog(props);

        about.add_link(_('GitHub'), 'https://github.com/funinkina');
        about.add_link(_('Twitter'), 'https://x.com/funinkina');
        about.add_link(_('Email'), 'mailto:hello@funinkina.co.in');

        about.present(parent);
    }

    _buildAppearancePage(settings, parentWindow) {
        const page = new Adw.PreferencesPage({
            title: _('Appearance'),
            icon_name: 'preferences-desktop-appearance-symbolic',
        });

        const iconGroup = new Adw.PreferencesGroup({
            title: _('Icon'),
            description: _('Choose how Medialine represents the currently playing media in the panel and popup.'),
        });
        page.add(iconGroup);

        const iconTypeRow = this._makeComboRow(settings, 'icon-type', _('Icon source'),
            _('Album art, app icon, playback status, or a custom image'),
            this._makeStringList([
                _('App icon'),
                _('Album art'),
                _('Playing status'),
                _('Custom image'),
            ]));
        iconGroup.add(iconTypeRow);

        iconGroup.add(this._makeSpinRow(settings, 'icon-size',
            _('Icon size'), _('Size in pixels'), 8, 64, 1));
        iconGroup.add(this._makeSpinRow(settings, 'icon-spacing',
            _('Icon spacing'), _('Space between the icon and text in pixels'), 0, 32, 1));

        // A sibling group, not nested inside iconGroup — Adw.PreferencesGroup
        // is meant to sit directly on a page, not inside another group.
        const customImageGroup = this._buildCustomImageGroup(settings, parentWindow);
        customImageGroup.visible = iconTypeRow.selected === 3;
        iconTypeRow.connect('notify::selected', () => {
            customImageGroup.visible = iconTypeRow.selected === 3;
        });
        page.add(customImageGroup);

        const textGroup = new Adw.PreferencesGroup({
            title: _('Text'),
            description: _('Control what appears next to the indicator in the panel.'),
        });
        page.add(textGroup);

        textGroup.add(this._makeEntryRow(settings, 'separator', _('Separator')));
        textGroup.add(this._makeSpinRow(settings, 'max-text-width',
            _('Max text width'), _('Maximum label width in pixels (0 for unlimited)'), 0, 1000, 10));

        const fieldsGroup = new Adw.PreferencesGroup({
            title: _('Visible fields'),
            description: _('Choose which metadata fields are shown beside the panel icon.'),
        });
        page.add(fieldsGroup);
        fieldsGroup.add(this._makeSwitchRow(settings, 'show-title', _('Show title')));
        fieldsGroup.add(this._makeSwitchRow(settings, 'show-artist', _('Show artist')));
        fieldsGroup.add(this._makeSwitchRow(settings, 'show-album', _('Show album')));

        return page;
    }

    _buildCustomImageGroup(settings, parentWindow) {
        const group = new Adw.PreferencesGroup({
            title: _('Custom image'),
            description: _('Pick an image to use when the icon source is set to Custom image.'),
            margin_top: 12,
        });

        let currentPath = settings.get_string('custom-icon-path');

        const row = new Adw.ActionRow({
            title: _('Image file'),
            subtitle: currentPath || _('No file selected'),
        });

        const previewStack = new Gtk.Stack({
            transition_type: Gtk.StackTransitionType.CROSSFADE,
            valign: Gtk.Align.CENTER,
            halign: Gtk.Align.CENTER,
            width_request: 64,
            height_request: 64,
        });

        const placeholder = new Gtk.Image({
            icon_name: 'image-x-generic-symbolic',
            pixel_size: 28,
        });

        const previewPicture = new Gtk.Picture({
            can_shrink: true,
            width_request: 64,
            height_request: 64,
        });

        previewStack.add_named(placeholder, 'placeholder');
        previewStack.add_named(previewPicture, 'preview');

        const previewFrame = new Gtk.Frame({
            child: previewStack,
            width_request: 64,
            height_request: 64,
            margin_top: 8,
            margin_bottom: 8,
        });
        previewFrame.add_css_class('card');
        row.add_prefix(previewFrame);

        const chooseButton = new Gtk.Button({
            icon_name: 'document-open-symbolic',
            tooltip_text: _('Choose image'),
            valign: Gtk.Align.CENTER,
        });
        chooseButton.add_css_class('flat');
        row.add_suffix(chooseButton);
        row.set_activatable_widget(chooseButton);

        const refreshPreview = (path) => {
            row.subtitle = path || _('No file selected');

            if (!path) {
                previewStack.visible_child_name = 'placeholder';
                return;
            }

            try {
                previewPicture.file = Gio.File.new_for_path(path);
                previewStack.visible_child_name = 'preview';
            } catch (_) {
                previewStack.visible_child_name = 'placeholder';
            }
        };

        refreshPreview(currentPath);

        const fileFilter = new Gtk.FileFilter();
        fileFilter.set_name(_('Images'));
        fileFilter.add_mime_type('image/png');
        fileFilter.add_mime_type('image/jpeg');
        fileFilter.add_mime_type('image/svg+xml');
        fileFilter.add_mime_type('image/webp');

        const openChooser = () => {
            const dialog = new Gtk.FileDialog({
                title: _('Select custom image'),
                default_filter: fileFilter,
            });

            if (currentPath) {
                try {
                    dialog.initial_file = Gio.File.new_for_path(currentPath);
                } catch (_) { }
            }

            dialog.open(parentWindow, null, (_dialog, result) => {
                try {
                    const file = _dialog.open_finish(result);
                    const path = file?.get_path();
                    if (!path)
                        return;

                    currentPath = path;
                    settings.set_string('custom-icon-path', path);
                    refreshPreview(path);
                } catch (_) {
                    // Dialog was cancelled or the selection failed; nothing to do.
                }
            });
        };

        chooseButton.connect('clicked', openChooser);
        group.add(row);

        return group;
    }

    _buildPanelPage(settings) {
        const page = new Adw.PreferencesPage({
            title: _('Panel'),
            icon_name: 'view-grid-symbolic',
        });

        const positionGroup = new Adw.PreferencesGroup({
            title: _('Position'),
            description: _('Where the indicator appears in the top bar.'),
        });
        page.add(positionGroup);

        const positionRow = this._makeComboRow(settings, 'panel-position', _('Panel section'),
            _('Which area of the top bar to place the indicator'),
            this._makeStringList([_('Left'), _('Center'), _('Right')]));
        positionGroup.add(positionRow);

        positionGroup.add(this._makeSpinRow(settings, 'panel-index',
            _('Position index'), _('Order within the panel section (0 is first)'), 0, 20, 1));

        const notificationsGroup = new Adw.PreferencesGroup({
            title: _('Notifications'),
            description: _('Manage visibility of GNOME\u2019s built-in media notifications.'),
        });
        page.add(notificationsGroup);
        notificationsGroup.add(this._makeSwitchRow(settings, 'hide-default-notification',
            _('Hide default notification'),
            _('Remove GNOME\u2019s media notification while the panel indicator is shown')));

        return page;
    }

    _buildMousePage(settings) {
        const page = new Adw.PreferencesPage({
            title: _('Mouse'),
            icon_name: 'input-mouse-symbolic',
        });

        const group = new Adw.PreferencesGroup({
            title: _('Click actions'),
            description: _('What happens when you click the media bar indicator'),
        });
        page.add(group);

        const clickActionModel = this._makeStringList([
            _('Nothing'), _('Open popup'), _('Play / Pause'), _('Open settings'),
            _('Next track'), _('Previous track'), _('Raise player'),
        ]);

        const clickActionValues = [0, 1, 2, 3, 4, 5, 8];

        for (const [key, title, subtitle] of [
            ['left-click-action', _('Left click'), _('Action when left-clicking the indicator')],
            ['middle-click-action', _('Middle click'), _('Action when middle-clicking the indicator')],
            ['right-click-action', _('Right click'), _('Action when right-clicking the indicator')],
        ]) {
            const enumValue = settings.get_enum(key);
            const modelIndex = clickActionValues.indexOf(enumValue);
            const row = new Adw.ComboRow({ title, subtitle, model: clickActionModel, selected: modelIndex });
            row.connect('notify::selected', () =>
                settings.set_enum(key, clickActionValues[row.selected]));
            group.add(row);
        }

        const scrollActionModel = this._makeStringList([
            _('Nothing'), _('Open popup'), _('Play / Pause'), _('Open settings'),
            _('Next track'), _('Previous track'),
            _('Volume up'), _('Volume down'), _('Raise player'),
        ]);

        const scrollGroup = new Adw.PreferencesGroup({
            title: _('Scroll actions'),
            description: _('What happens when you scroll over the media bar indicator'),
        });
        page.add(scrollGroup);

        for (const [key, title, subtitle] of [
            ['scroll-up-action', _('Scroll up'), _('Action when scrolling up over the indicator')],
            ['scroll-down-action', _('Scroll down'), _('Action when scrolling down over the indicator')],
        ]) {
            scrollGroup.add(this._makeComboRow(settings, key, title, subtitle, scrollActionModel));
        }

        return page;
    }

    _buildPopupPage(settings) {
        const page = new Adw.PreferencesPage({
            title: _('Popup'),
            icon_name: 'preferences-color-symbolic',
        });

        const colorsGroup = new Adw.PreferencesGroup({
            title: _('Colors'),
            description: _('Customize the popup color scheme'),
        });
        page.add(colorsGroup);

        colorsGroup.add(this._makeColorRow(settings, 'popup-primary-color',
            _('Primary color'), _('Color for text and controls'),
            '#FFFFFF'));
        colorsGroup.add(this._makeColorRow(settings, 'popup-secondary-color',
            _('Secondary color'), _('Color for backgrounds and accents'),
            '#888888'));
        colorsGroup.add(this._makeColorRow(settings, 'popup-background-color',
            _('Background color'), _('Background color for the popup'),
            ''));

        const dynamicBgGroup = new Adw.PreferencesGroup({
            title: _('Dynamic Background'),
            description: _('Extract the dominant color from album art to use as the popup background color.'),
        });
        page.add(dynamicBgGroup);

        const dynamicBgSwitch = this._makeSwitchRow(settings, 'popup-dynamic-bg',
            _('Dynamic background'),
            _('Use the dominant color from album art as background'));
        dynamicBgGroup.add(dynamicBgSwitch);

        const intensityRow = new Adw.SpinRow({
            title: _('Intensity'),
            subtitle: _('How bright or dark the background appears'),
            adjustment: new Gtk.Adjustment({
                lower: 0, upper: 100, step_increment: 5,
                value: Math.round(settings.get_double('popup-dynamic-bg-intensity') * 100),
            }),
        });
        intensityRow.connect('notify::value', () => {
            settings.set_double('popup-dynamic-bg-intensity', intensityRow.value / 100.0);
        });
        intensityRow.visible = settings.get_boolean('popup-dynamic-bg');
        dynamicBgSwitch.connect('notify::active', () => {
            intensityRow.visible = dynamicBgSwitch.active;
        });
        dynamicBgGroup.add(intensityRow);

        const appIconGroup = new Adw.PreferencesGroup({
            title: _('App icon'),
            description: _('Overlay the playing app\u2019s icon on the album art shown in the popup.'),
        });
        page.add(appIconGroup);
        appIconGroup.add(this._makeSwitchRow(settings, 'popup-show-app-icon',
            _('Show app icon on the bottom right of the album art')));

        const compactGroup = new Adw.PreferencesGroup({
            title: _('Compact layout'),
            description: _('Control how multi-source compact rows expand in the popup.'),
        });
        page.add(compactGroup);

        compactGroup.add(this._makeComboRow(settings, 'popup-compact-expand-mode',
            _('Expand layout on'), _('When multiple media sources are shown'),
            this._makeStringList([_('Off'), _('Hover'), _('Click')])));

        const pwaGroup = new Adw.PreferencesGroup({
            title: _('PWA'),
            description: _('Whether or not to use some workaround for displaying PWA icons.'),
        });
        page.add(pwaGroup);
        pwaGroup.add(this._makeSwitchRow(settings, 'enhanced-pwa-support',
            _('Enhanced PWA support'),
            _('Use advanced detection to find the active PWA window for the correct icon. Might have unintended consequences of displaying the wrong icon.')));

        return page;
    }

    _makeColorRow(settings, key, title, subtitle, defaultValue = null) {
        const currentValue = settings.get_string(key);
        const rgba = new Gdk.RGBA();
        if (currentValue)
            rgba.parse(currentValue);
        else
            rgba.parse('#7F7F7F'); // neutral placeholder for "no custom color"

        const button = new Gtk.ColorDialogButton({
            dialog: new Gtk.ColorDialog({
                title: _('Choose a color'),
                with_alpha: false,
            }),
            rgba,
            valign: Gtk.Align.CENTER,
        });

        const row = new Adw.ActionRow({ title, subtitle, activatable_widget: button });
        row.add_suffix(button);

        let _resetBtn = null;
        let _suppressNotify = false;

        const updateResetButton = () => {
            const val = settings.get_string(key);
            const needsReset = defaultValue !== null && val !== defaultValue;

            if (needsReset && !_resetBtn) {
                _resetBtn = new Gtk.Button({
                    icon_name: 'edit-undo-symbolic',
                    valign: Gtk.Align.CENTER,
                    tooltip_text: _('Reset to default'),
                });
                _resetBtn.add_css_class('flat');
                _resetBtn.connect('clicked', () => {
                    _suppressNotify = true;
                    settings.set_string(key, defaultValue);
                    const neutral = new Gdk.RGBA();
                    neutral.parse('#7F7F7F');
                    button.rgba = neutral;
                    _suppressNotify = false;
                    _resetBtn.unparent();
                    _resetBtn = null;
                });
                row.add_suffix(_resetBtn);
            } else if (!needsReset && _resetBtn) {
                _resetBtn.unparent();
                _resetBtn = null;
            }
        };

        button.connect('notify::rgba', () => {
            if (_suppressNotify) return;
            const c = button.rgba;
            const toHex = (channel) => Math.round(channel * 255).toString(16).padStart(2, '0');
            settings.set_string(key, `#${toHex(c.red)}${toHex(c.green)}${toHex(c.blue)}`.toUpperCase());
            updateResetButton();
        });

        updateResetButton();

        return row;
    }

    _makeStringList(labels) {
        const model = new Gtk.StringList();
        for (const label of labels) model.append(label);
        return model;
    }

    _makeSpinRow(settings, key, title, subtitle, lower, upper, step) {
        const row = new Adw.SpinRow({
            title,
            subtitle,
            adjustment: new Gtk.Adjustment({
                lower, upper, step_increment: step,
                value: settings.get_int(key),
            }),
        });
        row.connect('notify::value', () => settings.set_int(key, row.value));
        return row;
    }

    _makeSwitchRow(settings, key, title, subtitle = null) {
        const row = new Adw.SwitchRow({ title, subtitle: subtitle ?? '' });
        settings.bind(key, row, 'active', Gio.SettingsBindFlags.DEFAULT);
        return row;
    }

    _makeEntryRow(settings, key, title) {
        const row = new Adw.EntryRow({ title });
        settings.bind(key, row, 'text', Gio.SettingsBindFlags.DEFAULT);
        return row;
    }

    _makeComboRow(settings, key, title, subtitle, model) {
        const row = new Adw.ComboRow({ title, subtitle, model, selected: settings.get_enum(key) });
        row.connect('notify::selected', () => settings.set_enum(key, row.selected));
        return row;
    }
}
