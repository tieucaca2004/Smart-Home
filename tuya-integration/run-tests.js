'use strict';

/**
 * run-tests.js
 *
 * Runs the sequential Tuya Cloud API test plan against the device:
 *   Cong tac quan A Tieu (model W-W603)
 *   deviceId = 1638018234ab950c4e80
 *
 * A. Authentication (getToken)
 * B. Get device info (getDeviceInfo)
 * C. Get device status (getDeviceStatus)
 * D. Turn ON (turnOn)
 * E. Turn OFF (turnOff)
 * F. Get status again (getDeviceStatus)
 *
 * For every step, prints: endpoint, HTTP status, Tuya error code, success,
 * and the actual result payload (secrets are never printed).
 */

const {
  getToken,
  getDeviceInfo,
  getDeviceStatus,
  turnOn,
  turnOff,
} = require('./tuya-client');

const DEVICE_ID = process.env.TUYA_DEVICE_ID || '1638018234ab950c4e80';

function printStep(label, result) {
  console.log(`\n=== ${label} ===`);
  if (result.error) {
    console.log(`endpoint     : ${result.endpoint || '(n/a)'}`);
    console.log(`error        : ${result.error}`);
    console.log(`success      : false`);
    return;
  }
  const body = result.body || {};
  console.log(`endpoint     : ${result.method} ${result.url}`);
  console.log(`http_status  : ${result.statusCode}`);
  console.log(`tuya_code    : ${body.code !== undefined ? body.code : '(none)'}`);
  console.log(`tuya_msg     : ${body.msg !== undefined ? body.msg : '(none)'}`);
  console.log(`success      : ${body.success === true}`);
  console.log(`result       : ${JSON.stringify(body.result !== undefined ? body.result : body, null, 2)}`);
}

async function main() {
  console.log('Tuya Cloud API test run');
  console.log(`Endpoint : ${process.env.TUYA_ENDPOINT || 'https://openapi.tuyaus.com'}`);
  console.log(`Device ID: ${DEVICE_ID}`);

  const summary = {};

  // A. Authentication
  let tokenResult;
  try {
    tokenResult = await getToken();
    printStep('A. Authentication (GET /v1.0/token)', tokenResult);
    summary.auth = tokenResult.body && tokenResult.body.success;
  } catch (e) {
    printStep('A. Authentication (GET /v1.0/token)', { error: e.message });
    summary.auth = false;
    console.log('\nFATAL: cannot authenticate, aborting remaining tests.');
    printSummary(summary);
    process.exit(1);
  }

  if (!summary.auth) {
    console.log('\nFATAL: authentication failed, aborting remaining tests.');
    printSummary(summary);
    process.exit(1);
  }

  // B. Get device info
  try {
    const r = await getDeviceInfo(DEVICE_ID);
    printStep('B. Get device info (GET /v1.0/devices/{id})', r);
    summary.deviceRead = r.body && r.body.success;
    if (!summary.deviceRead) {
      console.log(`  -> Tuya error ${r.body.code}: ${r.body.msg}`);
    }
  } catch (e) {
    printStep('B. Get device info', { error: e.message });
    summary.deviceRead = false;
  }

  // C. Get device status
  try {
    const r = await getDeviceStatus(DEVICE_ID);
    printStep('C. Get device status (GET /v1.0/devices/{id}/status)', r);
    summary.deviceStatus1 = r.body && r.body.success;
    if (!summary.deviceStatus1) {
      console.log(`  -> Tuya error ${r.body.code}: ${r.body.msg}`);
    }
  } catch (e) {
    printStep('C. Get device status', { error: e.message });
    summary.deviceStatus1 = false;
  }

  // D. Turn ON
  try {
    const r = await turnOn(DEVICE_ID);
    printStep('D. Turn ON (POST /v1.0/devices/{id}/commands switch_1=true)', r);
    summary.turnOn = r.body && r.body.success;
    if (!summary.turnOn) {
      console.log(`  -> Tuya error ${r.body.code}: ${r.body.msg}`);
    }
  } catch (e) {
    printStep('D. Turn ON', { error: e.message });
    summary.turnOn = false;
  }

  // E. Turn OFF
  try {
    const r = await turnOff(DEVICE_ID);
    printStep('E. Turn OFF (POST /v1.0/devices/{id}/commands switch_1=false)', r);
    summary.turnOff = r.body && r.body.success;
    if (!summary.turnOff) {
      console.log(`  -> Tuya error ${r.body.code}: ${r.body.msg}`);
    }
  } catch (e) {
    printStep('E. Turn OFF', { error: e.message });
    summary.turnOff = false;
  }

  // F. Get status again
  try {
    const r = await getDeviceStatus(DEVICE_ID);
    printStep('F. Get device status again (GET /v1.0/devices/{id}/status)', r);
    summary.deviceStatus2 = r.body && r.body.success;
  } catch (e) {
    printStep('F. Get device status again', { error: e.message });
    summary.deviceStatus2 = false;
  }

  printSummary(summary);
}

function printSummary(summary) {
  console.log('\n\n===== SUMMARY =====');
  console.log(`AUTH          : ${fmt(summary.auth)}`);
  console.log(`DEVICE READ   : ${fmt(summary.deviceRead)}`);
  console.log(`DEVICE STATUS : ${fmt(summary.deviceStatus1)}`);
  console.log(`TURN ON       : ${fmt(summary.turnOn)}`);
  console.log(`TURN OFF      : ${fmt(summary.turnOff)}`);
  console.log(`STATUS RECHECK: ${fmt(summary.deviceStatus2)}`);
}

function fmt(v) {
  if (v === true) return 'PASS';
  if (v === false) return 'FAIL';
  return 'SKIPPED';
}

main().catch((e) => {
  console.error('Unhandled error:', e.message);
  process.exit(1);
});
