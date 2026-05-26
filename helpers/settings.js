export class ExtensionSettings {
    constructor(extension) {
        this._extension = extension;
        this._settings = extension.getSettings();
    }

    get iconType() {
        return this._settings.get_enum('icon-type');
    }

    set iconType(value) {
        this._settings.set_enum('icon-type', value);
    }

    get iconSize() {
        return this._settings.get_int('icon-size');
    }

    set iconSize(value) {
        this._settings.set_int('icon-size', value);
    }

    get separator() {
        return this._settings.get_string('separator');
    }

    set separator(value) {
        this._settings.set_string('separator', value);
    }

    get iconSpacing() {
        return this._settings.get_int('icon-spacing');
    }

    set iconSpacing(value) {
        this._settings.set_int('icon-spacing', value);
    }

    get panelPosition() {
        return this._settings.get_enum('panel-position');
    }

    set panelPosition(value) {
        this._settings.set_enum('panel-position', value);
    }

    get panelIndex() {
        return this._settings.get_int('panel-index');
    }

    set panelIndex(value) {
        this._settings.set_int('panel-index', value);
    }

    get showTitle() {
        return this._settings.get_boolean('show-title');
    }

    set showTitle(value) {
        this._settings.set_boolean('show-title', value);
    }

    get showArtist() {
        return this._settings.get_boolean('show-artist');
    }

    set showArtist(value) {
        this._settings.set_boolean('show-artist', value);
    }

    get showAlbum() {
        return this._settings.get_boolean('show-album');
    }

    set showAlbum(value) {
        this._settings.set_boolean('show-album', value);
    }

    get maxTextWidth() {
        return this._settings.get_int('max-text-width');
    }

    set maxTextWidth(value) {
        this._settings.set_int('max-text-width', value);
    }

    connectChanged(callback) {
        return this._settings.connect('changed', callback);
    }

    disconnectChanged(handlerId) {
        this._settings.disconnect(handlerId);
    }
}
