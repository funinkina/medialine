UUID = medialine@funinkina.co.in
INSTALL_DIR = $(HOME)/.local/share/gnome-shell/extensions/$(UUID)
SRC_FILES = extension.js prefs.js metadata.json

.PHONY: all install uninstall enable disable pack clean

all: schemas/gschemas.compiled

schemas/gschemas.compiled: schemas/*.gschema.xml
	glib-compile-schemas schemas/

install: schemas/gschemas.compiled
	mkdir -p $(INSTALL_DIR)
	cp -r $(SRC_FILES) helpers schemas icons $(INSTALL_DIR)

uninstall:
	rm -rf $(INSTALL_DIR)

enable:
	gnome-extensions enable $(UUID)

disable:
	gnome-extensions disable $(UUID)

pack: schemas/gschemas.compiled
	mkdir -p dist
	zip -r dist/$(UUID).zip $(SRC_FILES) helpers schemas icons LICENSE README.md

clean:
	rm -f schemas/gschemas.compiled
	rm -rf dist
