UUID = medialine@funinkina.co.in
INSTALL_DIR = $(HOME)/.local/share/gnome-shell/extensions/$(UUID)
SRC_FILES = extension.js prefs.js metadata.json
DOMAIN = $(UUID)
PO_DIR = po
LOCALE_DIR = locale
LANGUAGES = de es fr pt_BR zh_CN ru it pl

.PHONY: all install uninstall enable disable pack clean pot update-po locale test

all: schemas/gschemas.compiled locale

test:
	@for t in helpers/*.test.js; do echo "node $$t"; node $$t || exit 1; done

schemas/gschemas.compiled: schemas/*.gschema.xml
	glib-compile-schemas schemas/

pot:
	xgettext \
		--from-code=UTF-8 \
		--add-comments=Translators \
		--keyword=_ \
		--files-from=$(PO_DIR)/POTFILES.in \
		--output=$(PO_DIR)/$(DOMAIN).pot \
		--package-name="Medialine" \
		--package-version="6" \
		--copyright-holder="Aryan Kushwaha"

update-po: pot
	for lang in $(LANGUAGES); do \
		msgmerge --update --backup=none $(PO_DIR)/$$lang.po $(PO_DIR)/$(DOMAIN).pot; \
	done

locale: $(patsubst %, $(LOCALE_DIR)/%/LC_MESSAGES/$(DOMAIN).mo, $(LANGUAGES))

$(LOCALE_DIR)/%/LC_MESSAGES/$(DOMAIN).mo: $(PO_DIR)/%.po
	mkdir -p $(dir $@)
	msgfmt -o $@ $<

install: schemas/gschemas.compiled locale
	mkdir -p $(INSTALL_DIR)
	cp -r $(SRC_FILES) helpers schemas icons $(INSTALL_DIR)
	cp -r $(LOCALE_DIR) $(INSTALL_DIR)

uninstall:
	rm -rf $(INSTALL_DIR)

enable:
	gnome-extensions enable $(UUID)

disable:
	gnome-extensions disable $(UUID)

pack: schemas/gschemas.compiled locale
	mkdir -p dist
	rm -f dist/$(UUID).zip
	zip -r dist/$(UUID).zip $(SRC_FILES) helpers schemas/*.gschema.xml icons $(LOCALE_DIR) -x '*.test.js'

clean:
	rm -f schemas/gschemas.compiled
	rm -rf dist $(LOCALE_DIR)
