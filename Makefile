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

pack:
	mkdir -p dist
	rm -f dist/$(UUID).zip
	zip -r dist/$(UUID).zip $(SRC_FILES) helpers schemas/*.gschema.xml icons 

clean:
	rm -f schemas/gschemas.compiled
	rm -rf dist
