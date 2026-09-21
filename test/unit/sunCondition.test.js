'use strict';

/**
 * Unit tests for sunCalc (sunrise/sunset maths), the `sun` condition and the
 * HUB_LATITUDE / HUB_LONGITUDE reader.
 *
 * REFERENCE VALUES (sunCalc): the expected local times below are the widely
 * published almanac figures for the 2026-06-21 solstice as the Coder recalls
 * them (timeanddate.com / USNO style tables, minute precision) - they were
 * NOT re-fetched over the network in this session. Tolerance is +/- 3 min,
 * which covers the minute rounding of published tables. The Tester should
 * cross-check them against a public source. Independent of any table, the
 * physical-sanity tests (equator/equinox day length, polar day/night = null,
 * later sunset in summer) guard the algorithm.
 */

const assert = require('assert');
const { sunEvents } = require('../../src/automation/conditions/sunCalc');
const sunCondition = require('../../src/automation/conditions/sunCondition');
const { readHubLocation } = require('../../src/bootstrap');

let passCount = 0;
let failCount = 0;

async function check(name, fn) {
  try {
    await fn();
    console.log(`  ✔ ${name}`);
    passCount += 1;
  } catch (err) {
    console.log(`  ✘ ${name}`);
    console.log(`      ${err.stack || err.message}`);
    failCount += 1;
  }
}

/** UTC epoch ms -> minutes since midnight in a fixed UTC offset (hours). */
function minutesInZone(epochMs, offsetHours) {
  const d = new Date(epochMs + offsetHours * 3600000);
  return d.getUTCHours() * 60 + d.getUTCMinutes();
}
const hm = (h, m) => h * 60 + m;

const SOLSTICE = new Date(2026, 5, 21, 12, 0, 0); // only the local calendar day matters

async function run() {
  console.log('=== sunCalc / sun condition / HUB location unit tests ===\n');

  const references = [
    // [label, lat, lon, utcOffsetHours, sunrise, sunset]
    ['London (BST)', 51.5074, -0.1278, 1, hm(4, 43), hm(21, 21)],
    ['New York (EDT)', 40.7128, -74.006, -4, hm(5, 25), hm(20, 30)],
    ['Sydney (AEST)', -33.8688, 151.2093, 10, hm(7, 0), hm(16, 54)],
    ['Hanoi (UTC+7)', 21.0285, 105.8542, 7, hm(5, 16), hm(18, 40)],
  ];
  for (const [label, lat, lon, offset, rise, set] of references) {
    await check(`sunCalc 2026-06-21 ${label}: sunrise/sunset within 3 min of the published figures`, () => {
      const ev = sunEvents(SOLSTICE, lat, lon);
      assert.ok(ev, 'expected sunrise/sunset');
      const gotRise = minutesInZone(ev.sunrise, offset);
      const gotSet = minutesInZone(ev.sunset, offset);
      assert.ok(Math.abs(gotRise - rise) <= 3, `sunrise ${gotRise} vs ${rise}`);
      assert.ok(Math.abs(gotSet - set) <= 3, `sunset ${gotSet} vs ${set}`);
    });
  }

  await check('sunCalc: at the equator on an equinox the day is ~12h (a few minutes more, from refraction)', () => {
    const ev = sunEvents(new Date(2026, 2, 20, 12, 0, 0), 0, 0);
    const dayMinutes = (ev.sunset - ev.sunrise) / 60000;
    assert.ok(dayMinutes > 715 && dayMinutes < 735, `day length ${dayMinutes} min`);
  });

  await check('sunCalc: summer day is longer than winter day in the northern hemisphere', () => {
    const summer = sunEvents(new Date(2026, 5, 21, 12), 51.5, -0.1);
    const winter = sunEvents(new Date(2026, 11, 21, 12), 51.5, -0.1);
    assert.ok(summer.sunset - summer.sunrise > winter.sunset - winter.sunrise + 6 * 3600000);
  });

  await check('sunCalc: polar day and polar night return null', () => {
    assert.strictEqual(sunEvents(new Date(2026, 5, 21, 12), 80, 0), null); // midnight sun
    assert.strictEqual(sunEvents(new Date(2026, 11, 21, 12), 80, 0), null); // polar night
  });

  // --- the `sun` condition; location follows the machine's own time zone so "the local day" is consistent ---
  const zoneLon = -new Date().getTimezoneOffset() / 4; // meridian of the local zone, degrees east
  const location = { latitude: 20, longitude: zoneLon };
  const day = new Date(2026, 5, 21, 12, 0, 0);
  const events = sunEvents(day, location.latitude, location.longitude);
  const sunriseMs = events.sunrise;
  const sunsetMs = events.sunset;
  const ev = (node, nowMs, loc = location) =>
    sunCondition.evaluate({ type: 'sun', offsetMinutes: 0, ...node }, { now: new Date(nowMs), location: loc });
  const MIN = 60000;

  await check('sun "at": true during the sunrise minute, false a few minutes either side', async () => {
    const node = { event: 'sunrise', relation: 'at' };
    assert.strictEqual(await ev(node, sunriseMs), true);
    assert.strictEqual(await ev(node, sunriseMs - 5 * MIN), false);
    assert.strictEqual(await ev(node, sunriseMs + 5 * MIN), false);
  });

  await check('sun "after sunrise": false before, true from sunrise until the end of the day', async () => {
    const node = { event: 'sunrise', relation: 'after' };
    assert.strictEqual(await ev(node, sunriseMs - 5 * MIN), false);
    assert.strictEqual(await ev(node, sunriseMs + MIN), true);
    assert.strictEqual(await ev(node, sunsetMs + 60 * MIN), true);
  });

  await check('sun "before sunset": true earlier in the day, false after sunset', async () => {
    const node = { event: 'sunset', relation: 'before' };
    assert.strictEqual(await ev(node, sunriseMs + 60 * MIN), true);
    assert.strictEqual(await ev(node, sunsetMs - 5 * MIN), true);
    assert.strictEqual(await ev(node, sunsetMs + 5 * MIN), false);
  });

  await check('sun offsetMinutes shifts the reference (30 min after sunset / 30 min before sunrise)', async () => {
    const afterSunsetPlus30 = { event: 'sunset', relation: 'after', offsetMinutes: 30 };
    assert.strictEqual(await ev(afterSunsetPlus30, sunsetMs + 10 * MIN), false);
    assert.strictEqual(await ev(afterSunsetPlus30, sunsetMs + 31 * MIN), true);
    const atSunriseMinus30 = { event: 'sunrise', relation: 'at', offsetMinutes: -30 };
    assert.strictEqual(await ev(atSunriseMinus30, sunriseMs - 30 * MIN), true);
    assert.strictEqual(await ev(atSunriseMinus30, sunriseMs), false);
  });

  await check('sun evaluates to null (unknown) without a location, and on a polar day', async () => {
    assert.strictEqual(await ev({ event: 'sunrise', relation: 'after' }, sunriseMs, null), null);
    const polar = { latitude: 80, longitude: zoneLon };
    assert.strictEqual(await ev({ event: 'sunrise', relation: 'after' }, sunriseMs, polar), null);
  });

  await check('sun validate: needs a location, valid event/relation/offset, no extra fields', () => {
    const v = (node, loc = location) => sunCondition.validate(node, { path: 'when', location: loc });
    assert.deepStrictEqual(v({ type: 'sun', event: 'sunset', relation: 'after' }), {
      type: 'sun', event: 'sunset', relation: 'after', offsetMinutes: 0,
    });
    const bad = [
      [{ type: 'sun', event: 'noon', relation: 'at' }, 'when.event'],
      [{ type: 'sun', event: 'sunrise', relation: 'during' }, 'when.relation'],
      [{ type: 'sun', event: 'sunrise', relation: 'at', offsetMinutes: 181 }, 'when.offsetMinutes'],
      [{ type: 'sun', event: 'sunrise', relation: 'at', offsetMinutes: 1.5 }, 'when.offsetMinutes'],
      [{ type: 'sun', event: 'sunrise', relation: 'at', x: 1 }, 'when.x'],
    ];
    for (const [node, fragment] of bad) {
      assert.throws(() => v(node), (e) => e.code === 'VALIDATION_ERROR' && e.message.includes(fragment), JSON.stringify(node));
    }
    assert.throws(
      () => v({ type: 'sun', event: 'sunrise', relation: 'at' }, null),
      (e) => e.code === 'VALIDATION_ERROR' && e.message.includes('HUB_LATITUDE')
    );
  });

  const warnings = [];
  const quiet = { warn: (m) => warnings.push(m) };

  await check('readHubLocation: unset or blank -> null without a warning', () => {
    assert.strictEqual(readHubLocation({}, quiet), null);
    assert.strictEqual(readHubLocation({ HUB_LATITUDE: '  ', HUB_LONGITUDE: '' }, quiet), null);
    assert.strictEqual(warnings.length, 0);
  });

  await check('readHubLocation: valid pair is parsed (never defaults blank to 0)', () => {
    assert.deepStrictEqual(readHubLocation({ HUB_LATITUDE: '21.03', HUB_LONGITUDE: ' 105.85 ' }, quiet), {
      latitude: 21.03,
      longitude: 105.85,
    });
    assert.deepStrictEqual(readHubLocation({ HUB_LATITUDE: '-33.5', HUB_LONGITUDE: '-70' }, quiet), {
      latitude: -33.5,
      longitude: -70,
    });
  });

  await check('readHubLocation: half-set, non-numeric or out-of-range -> null with a warning', () => {
    warnings.length = 0;
    assert.strictEqual(readHubLocation({ HUB_LATITUDE: '21' }, quiet), null);
    assert.strictEqual(readHubLocation({ HUB_LATITUDE: 'north', HUB_LONGITUDE: '105' }, quiet), null);
    assert.strictEqual(readHubLocation({ HUB_LATITUDE: '91', HUB_LONGITUDE: '105' }, quiet), null);
    assert.strictEqual(readHubLocation({ HUB_LATITUDE: '20', HUB_LONGITUDE: '181' }, quiet), null);
    assert.strictEqual(warnings.length, 4);
    assert.ok(warnings.every((w) => !/[0-9]{2}\.[0-9]/.test(w)), 'warnings must not echo the coordinates');
  });

  console.log(`\n${failCount === 0 ? '✅ PASS' : '❌ FAIL'} — ${passCount} passed, ${failCount} failed.`);
  if (failCount > 0) process.exitCode = 1;
}

run();
