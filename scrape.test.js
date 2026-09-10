// Self-check for the risky parsing logic. Run: node scrape.test.js
const assert = require('assert');
const { extractAppData, csvEscape, val, flattenGroup, runPool } = require('./scrape.js');

// 1. brace-matching stops at the correct closing brace, ignoring braces inside strings
const html1 = `<script>window.APP_DATA = {"a": 1, "b": "text with } brace", "c": {"d": 2}}</script><script>window.other = {}</script>`;
const data1 = extractAppData(html1);
assert.deepStrictEqual(data1, { a: 1, b: 'text with } brace', c: { d: 2 } });

// 2. bare `undefined` tokens become null, but the substring inside a string is untouched
const html2 = `window.APP_DATA = {"x": undefined, "y": "undefined-ish", "z": [1, undefined, 3]}`;
const data2 = extractAppData(html2);
assert.deepStrictEqual(data2, { x: null, y: 'undefined-ish', z: [1, null, 3] });

// 3. missing marker returns null instead of throwing
assert.strictEqual(extractAppData('<html>no app data here</html>'), null);

// 4. csvEscape quotes fields containing commas/quotes/newlines
assert.strictEqual(csvEscape('plain'), 'plain');
assert.strictEqual(csvEscape('a,b'), '"a,b"');
assert.strictEqual(csvEscape('a"b'), '"a""b"');
assert.strictEqual(csvEscape(undefined), '');

// 5. val() normalizes nested attribute shapes
assert.strictEqual(val('red'), 'red');
assert.strictEqual(val({ value: 'blue' }), 'blue');
assert.strictEqual(val(['a', 'b']), 'a; b');
assert.strictEqual(val(null), '');

// 6. flattenGroup joins a group's details into one string
assert.strictEqual(
  flattenGroup({ title: 'Delivery', details: [{ key: 'ETA', value: '5 days' }, { key: 'Returns', value: null }] }),
  'ETA: 5 days'
);

// 7. runPool caps concurrency and completes every item exactly once, in order
(async () => {
  const items = [30, 10, 25, 5, 20, 15, 1, 2];
  let inFlight = 0;
  let maxInFlight = 0;
  const seen = [];
  const results = await runPool(items, 2, async (ms, i) => {
    inFlight++;
    maxInFlight = Math.max(maxInFlight, inFlight);
    await new Promise((r) => setTimeout(r, ms));
    inFlight--;
    seen.push(i);
    return ms * 2;
  });
  assert.strictEqual(maxInFlight <= 2, true, `expected at most 2 in flight, saw ${maxInFlight}`);
  assert.deepStrictEqual(results, items.map((ms) => ms * 2));
  assert.strictEqual(seen.length, items.length);
  assert.deepStrictEqual([...seen].sort((a, b) => a - b), items.map((_, i) => i));

  console.log('All checks passed.');
})();
