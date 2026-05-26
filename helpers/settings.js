export class ExtensionSettings {
    constructor(extension) {
        this._settings = extension.getSettings();
    }

    get iconType() { return this._settings.get_enum('icon-type'); }
    get iconSize() { return this._settings.get_int('icon-size'); }
    get separator() { return this._settings.get_string('separator'); }
    get iconSpacing() { return this._settings.get_int('icon-spacing'); }
    get panelPosition() { return this._settings.get_enum('panel-position'); }
    get panelIndex() { return this._settings.get_int('panel-index'); }
    get showTitle() { return this._settings.get_boolean('show-title'); }
    get showArtist() { return this._settings.get_boolean('show-artist'); }
    get showAlbum() { return this._settings.get_boolean('show-album'); }
    get maxTextWidth() { return this._settings.get_int('max-text-width'); }
    get leftClickAction() { return this._settings.get_enum('left-click-action'); }
    get middleClickAction() { return this._settings.get_enum('middle-click-action'); }
    get rightClickAction() { return this._settings.get_enum('right-click-action'); }

    connect(signal, callback) {
        return this._settings.connect(signal, callback);
    }

    disconnect(handlerId) {
        this._settings.disconnect(handlerId);
    }
}
