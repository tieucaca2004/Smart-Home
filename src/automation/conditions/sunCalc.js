'use strict';

/**
 * Sunrise / sunset from date + latitude/longitude, pure JS, no dependency.
 * Implements the NOAA solar-position equations (the "General Solar Position
 * Calculations" spreadsheet), accurate to about a minute at mid latitudes.
 */

const RAD = Math.PI / 180;
const DEG = 180 / Math.PI;
const MS_PER_DAY = 86400000;
const MS_PER_MINUTE = 60000;
/** Sun's apparent altitude at sunrise/sunset (refraction + solar radius): zenith 90.833 deg. */
const ZENITH = 90.833;

/**
 * @param {Date} date       Only its local calendar day (year/month/day) is used.
 * @param {number} latitude  Degrees north, -90..90.
 * @param {number} longitude Degrees east, -180..180.
 * @returns {{sunrise: number, sunset: number}|null}  Epoch milliseconds, or
 *   null when the sun does not rise/set that day (polar day/night).
 */
function sunEvents(date, latitude, longitude) {
  const midnightUtc = Date.UTC(date.getFullYear(), date.getMonth(), date.getDate());
  // Julian day at local solar noon, approximately (declination / equation of time barely move within a day).
  const jd = midnightUtc / MS_PER_DAY + 2440587.5 + 0.5 - longitude / 360;
  const t = (jd - 2451545) / 36525;

  const meanLong = (280.46646 + t * (36000.76983 + t * 0.0003032)) % 360;
  const meanAnomaly = 357.52911 + t * (35999.05029 - 0.0001537 * t);
  const eccentricity = 0.016708634 - t * (0.000042037 + 0.0000001267 * t);
  const m = meanAnomaly * RAD;
  const eqCenter =
    Math.sin(m) * (1.914602 - t * (0.004817 + 0.000014 * t)) +
    Math.sin(2 * m) * (0.019993 - 0.000101 * t) +
    Math.sin(3 * m) * 0.000289;
  const trueLong = meanLong + eqCenter;
  const omega = (125.04 - 1934.136 * t) * RAD;
  const apparentLong = (trueLong - 0.00569 - 0.00478 * Math.sin(omega)) * RAD;
  const meanObliq = 23 + (26 + (21.448 - t * (46.815 + t * (0.00059 - t * 0.001813))) / 60) / 60;
  const obliq = (meanObliq + 0.00256 * Math.cos(omega)) * RAD;
  const declination = Math.asin(Math.sin(obliq) * Math.sin(apparentLong));

  const y = Math.tan(obliq / 2) ** 2;
  const l0 = meanLong * RAD;
  const eqTimeMinutes =
    4 *
    DEG *
    (y * Math.sin(2 * l0) -
      2 * eccentricity * Math.sin(m) +
      4 * eccentricity * y * Math.sin(m) * Math.cos(2 * l0) -
      0.5 * y * y * Math.sin(4 * l0) -
      1.25 * eccentricity * eccentricity * Math.sin(2 * m));

  const lat = latitude * RAD;
  const cosHa = Math.cos(ZENITH * RAD) / (Math.cos(lat) * Math.cos(declination)) - Math.tan(lat) * Math.tan(declination);
  if (!Number.isFinite(cosHa) || cosHa < -1 || cosHa > 1) return null; // sun never rises or never sets
  const haDegrees = Math.acos(cosHa) * DEG;

  const sunriseMinutesUtc = 720 - 4 * (longitude + haDegrees) - eqTimeMinutes;
  const sunsetMinutesUtc = 720 - 4 * (longitude - haDegrees) - eqTimeMinutes;
  return {
    sunrise: midnightUtc + Math.round(sunriseMinutesUtc * MS_PER_MINUTE),
    sunset: midnightUtc + Math.round(sunsetMinutesUtc * MS_PER_MINUTE),
  };
}

module.exports = { sunEvents };
