// Gate test: pure art-url normalization. Run: node helpers/artUrl.test.js
import assert from 'node:assert/strict';
import { normalizeArtUrl, isRemoteArt, selectEvictions } from './artUrl.js';

// Spotify's bogus host gets rewritten to the real CDN host.
assert.equal(
    normalizeArtUrl('https://open.spotify.com/image/ab67616d00001e02abc'),
    'https://i.scdn.co/image/ab67616d00001e02abc');

// Only the hard-coded prefix is touched; the image id is preserved verbatim.
assert.equal(
    normalizeArtUrl('https://open.spotify.com/image/'),
    'https://i.scdn.co/image/');

// Already-correct i.scdn.co urls pass through untouched.
const scdn = 'https://i.scdn.co/image/ab67616d00001e02abc';
assert.equal(normalizeArtUrl(scdn), scdn);

// Unrelated art urls are left alone.
const local = 'file:///home/u/.cache/cover.png';
assert.equal(normalizeArtUrl(local), local);
const other = 'https://example.com/open.spotify.com/image/x';
assert.equal(normalizeArtUrl(other), other);

// Empty / nullish inputs don't throw.
assert.equal(normalizeArtUrl(''), '');
assert.equal(normalizeArtUrl(null), null);
assert.equal(normalizeArtUrl(undefined), undefined);

// isRemoteArt: http(s) only.
assert.equal(isRemoteArt('https://i.scdn.co/image/x'), true);
assert.equal(isRemoteArt('http://example.com/a.png'), true);
assert.equal(isRemoteArt('file:///home/u/cover.png'), false);
assert.equal(isRemoteArt(''), false);
assert.equal(isRemoteArt(null), false);
assert.equal(isRemoteArt(undefined), false);
assert.equal(isRemoteArt('ftp://x/y'), false);

// selectEvictions: LRU planner.
const files = [
    { name: 'a', size: 30, mtime: 100 }, // oldest
    { name: 'b', size: 30, mtime: 200 },
    { name: 'c', size: 30, mtime: 300 }, // newest
];
// Under budget -> nothing evicted.
assert.deepEqual(selectEvictions(files, 100), []);
assert.deepEqual(selectEvictions(files, 90), []);
// Over budget -> drop oldest first until total <= budget (90 -> need <=60).
assert.deepEqual(selectEvictions(files, 60), ['a']);
// Tighter budget evicts the two oldest, keeps newest.
assert.deepEqual(selectEvictions(files, 30), ['a', 'b']);
// maxBytes 0 / falsy -> disabled, evict nothing.
assert.deepEqual(selectEvictions(files, 0), []);
// Empty cache -> nothing.
assert.deepEqual(selectEvictions([], 10), []);
// Input order independent: same plan regardless of array order.
const shuffled = [files[2], files[0], files[1]];
assert.deepEqual(selectEvictions(shuffled, 60), ['a']);

console.log('artUrl.test.js: all assertions passed');
