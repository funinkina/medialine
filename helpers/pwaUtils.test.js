// Gate test: pure PWA app-id parsing. Run: node helpers/pwaUtils.test.js
import assert from 'node:assert/strict';
import { chromiumAppId, pwaDesktopCandidates, pickWindowIndex } from './pwaUtils.js';

const ID = 'akoojlghcahgflgegngciajnbeoeepdh'; // 32 chars, a-p

// native Chromium PWA window class
assert.equal(chromiumAppId(`crx_${ID}`), ID);
// Flatpak window class (the form the reddit reporter saw)
assert.equal(chromiumAppId(`chrome-${ID}-Default`), ID);
assert.equal(chromiumAppId(`brave-${ID}-Default`), ID);
// instance with trailing scope number
assert.equal(chromiumAppId(`chrome-${ID}-Default.0`), ID);

// real strings observed live from Helium (Chromium fork) on Wayland:
// PWA window app_id carries the id, the plain browser window does not.
assert.equal(chromiumAppId('chrome-cinhimbnkkaeohfgghhklpknlkffjgod-Default'),
    'cinhimbnkkaeohfgghhklpknlkffjgod'); // YouTube Music PWA
assert.equal(chromiumAppId('chrome-hnpfjngllnobngcgfapefoaidbinmjnm-Default'),
    'hnpfjngllnobngcgfapefoaidbinmjnm'); // WhatsApp PWA
assert.equal(chromiumAppId('helium'), null); // browser window -> no PWA icon

// non-PWA classes must not match
assert.equal(chromiumAppId('Google-chrome'), null);
assert.equal(chromiumAppId('brave-browser'), null);
assert.equal(chromiumAppId('spotify'), null);
assert.equal(chromiumAppId(''), null);
assert.equal(chromiumAppId(null), null);
// wrong length / out-of-range chars
assert.equal(chromiumAppId(`crx_${ID}x`), null);        // 33 chars
assert.equal(chromiumAppId('crx_zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz'), null); // z not in a-p

// desktop candidates include the edited and unedited Flatpak forms
const cands = pwaDesktopCandidates(ID);
assert.ok(cands.includes(`chrome-${ID}-Default.desktop`));
assert.ok(cands.includes(`brave-${ID}-Default.desktop`));

// --- window selection (Chromium shares one MPRIS bus across tab + PWA) ---

// the live Helium layout: browser window + YT Music PWA window, one bus.
const browserWin = { title: 'Foo - LinkedIn - Helium', wmClass: 'helium', userTime: 16925023 };
const ytmusicWin = {
    title: 'YouTube Music - tolerate it | YouTube Music',
    wmClass: 'chrome-cinhimbnkkaeohfgghhklpknlkffjgod-Default',
    userTime: 16499876,
};
const wins = [ytmusicWin, browserWin];

// PWA media playing -> pick the PWA window even though the browser window is more
// recent (higher userTime). Title + known-app-name must dominate.
assert.equal(pickWindowIndex(wins, { title: 'tolerate it' }), 0);

// Regression for the cache-poison bug: a class cached while only the browser
// window existed must NOT pin selection to the browser once the PWA appears.
assert.equal(pickWindowIndex(wins, { title: 'tolerate it', knownClass: 'helium' }), 0);
// even with no song-title match, the youtube-music known title wins over the cache.
assert.equal(pickWindowIndex(wins, { title: '', knownClass: 'helium' }), 0);

// browser media playing (title matches the browser tab) -> pick browser window.
const browserPlaying = { title: 'Some Video - Helium', wmClass: 'helium', userTime: 100 };
assert.equal(pickWindowIndex([ytmusicWin, browserPlaying], { title: 'Some Video' }), 1);

// knownClass acts as a tiebreak only when nothing else distinguishes the windows.
const a = { title: 'x', wmClass: 'aaa', userTime: 0 };
const b = { title: 'x', wmClass: 'bbb', userTime: 0 };
assert.equal(pickWindowIndex([a, b], { knownClass: 'bbb' }), 1);

console.log('pwaUtils.test.js: all assertions passed');
