'use strict';

/**
 * Read-only credential diagnostic for tieu-home-hub.
 *
 * Checks ONLY:
 *   - does .env exist, and does it declare TUYA_ACCESS_ID / TUYA_ACCESS_SECRET
 *   - are the two values accidentally identical (a common copy/paste mistake)
 *   - do the values have stray quotes/whitespace that would corrupt the signature
 *   - does process.env actually contain these values when a plain `node` process
 *     runs (this project has no dotenv/env-loader, so a value sitting only in
 *     .env is NOT automatically visible to process.env — see explanation below)
 *   - if process.env values exist, do they match what's declared in .env
 *     (catches a stale/wrong value left exported in the shell, overriding .env)
 *
 * Never prints the actual Access Secret (or Access ID) value — only
 * existence, length, and equality/mismatch flags.
 *
 * This script is READ-ONLY: it does not modify .env, does not modify any
 * credential, does not touch tuya-package, and is not wired into any other
 * part of the app (routes/adapters/tests are all unchanged).
 *
 * Usage (from the tieu-home-hub project root):
 *   node scripts/check-env.js
 */

const fs = require('fs');
const path = require('path');

const ENV_PATH = path.join(__dirname, '..', '.env');

function parseEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return null;
  const raw = fs.readFileSync(filePath, 'utf8');
  const result = {};
  raw.split(/\r?\n/).forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) return;
    const eq = trimmed.indexOf('=');
    if (eq === -1) return;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1);
    result[key] = { raw: value, trimmed: value.trim() };
  });
  return result;
}

function describeFileValue(label, entry) {
  if (!entry) {
    console.log(`  ${label.padEnd(20)}: KHÔNG có trong .env`);
    return null;
  }
  const hasSurroundingQuotes = /^".*"$|^'.*'$/.test(entry.trimmed);
  const hasStrayWhitespace = entry.raw !== entry.trimmed;
  const flags = [];
  if (hasSurroundingQuotes) flags.push('có dấu ngoặc kép/đơn bao quanh giá trị');
  if (hasStrayWhitespace) flags.push('có khoảng trắng/CR thừa ở đầu-cuối dòng');
  console.log(
    `  ${label.padEnd(20)}: tồn tại, length=${entry.trimmed.length}` +
      (flags.length ? ` — CẢNH BÁO: ${flags.join('; ')}` : '')
  );
  return entry.trimmed;
}

function describeEnvVar(label) {
  const val = process.env[label];
  if (!val) {
    console.log(`  ${label.padEnd(20)}: KHÔNG tồn tại trong process.env`);
    return null;
  }
  console.log(`  ${label.padEnd(20)}: tồn tại, length=${val.length}`);
  return val;
}

console.log('=== tieu-home-hub — kiểm tra .env (read-only, không sửa gì) ===\n');
console.log(`Đường dẫn .env: ${ENV_PATH}\n`);

const envFile = parseEnvFile(ENV_PATH);
if (!envFile) {
  console.log('❌ KHÔNG tìm thấy file .env tại đường dẫn trên.');
  console.log('   -> Chạy: cp .env.example .env   rồi điền giá trị thật.');
  process.exitCode = 1;
} else {
  console.log('✔ File .env tồn tại.\n');

  console.log('--- 1) Giá trị khai báo TRONG file .env ---');
  const idFromFile = describeFileValue('TUYA_ACCESS_ID', envFile.TUYA_ACCESS_ID);
  const secretFromFile = describeFileValue('TUYA_ACCESS_SECRET', envFile.TUYA_ACCESS_SECRET);

  console.log('\n--- 2) Đối chiếu ID vs SECRET trong .env ---');
  if (idFromFile && secretFromFile) {
    if (idFromFile === secretFromFile) {
      console.log('  ❌ TUYA_ACCESS_ID và TUYA_ACCESS_SECRET đang GIỐNG HỆT NHAU trong .env.');
      console.log('     Đây gần như chắc chắn là nguyên nhân — hai giá trị này phải khác nhau.');
    } else {
      console.log('  ✔ Hai giá trị khác nhau trong .env (không bị dán trùng).');
    }
  } else {
    console.log('  (bỏ qua — thiếu 1 hoặc cả 2 giá trị ở bước 1)');
  }

  console.log('\n--- 3) process.env khi chạy trực tiếp bằng "node" (KHÔNG qua dotenv) ---');
  const idFromEnv = describeEnvVar('TUYA_ACCESS_ID');
  const secretFromEnv = describeEnvVar('TUYA_ACCESS_SECRET');

  if (!idFromEnv && !secretFromEnv) {
    console.log('\n⚠️  QUAN TRỌNG: project này KHÔNG cài "dotenv" và KHÔNG tự động load .env.');
    console.log('   Việc chỉ điền giá trị vào .env KHÔNG đủ để "npm start" / gọi API thấy được');
    console.log('   TUYA_ACCESS_ID/TUYA_ACCESS_SECRET, trừ khi anh:');
    console.log('     (a) tự set biến môi trường trong shell trước khi chạy (ví dụ PowerShell:');
    console.log('         $env:TUYA_ACCESS_ID="..."; $env:TUYA_ACCESS_SECRET="..."; npm start), hoặc');
    console.log('     (b) dùng một tool load .env riêng (project hiện chưa có).');
    console.log('   Nếu lúc anh chạy Hub và gặp lỗi 1004 mà Hub vẫn khởi động được (không báo');
    console.log('   "Missing Tuya credentials"), nghĩa là lúc đó process.env CÓ giá trị — rất có');
    console.log('   thể do anh set trong cùng phiên shell đó. Hãy chạy lại chính lệnh anh dùng để');
    console.log('   khởi động Hub, nhưng thay bằng: node scripts/check-env.js  (cùng cửa sổ shell,');
    console.log('   không mở terminal mới) để thấy đúng process.env tại thời điểm chạy thật.');
  } else if (idFromFile && idFromEnv && idFromFile !== idFromEnv) {
    console.log('\n⚠️  QUAN TRỌNG: TUYA_ACCESS_ID trong process.env KHÁC với giá trị trong file .env.');
    console.log('   Có thể một biến môi trường cũ đang được set sẵn trong shell, che mất .env.');
  } else if (secretFromFile && secretFromEnv && secretFromFile !== secretFromEnv) {
    console.log('\n⚠️  QUAN TRỌNG: TUYA_ACCESS_SECRET trong process.env KHÁC với giá trị trong file .env.');
    console.log('   Có thể một biến môi trường cũ đang được set sẵn trong shell, che mất .env.');
  } else {
    console.log('\n✔ Không phát hiện lệch giữa .env và process.env (trong lần chạy này).');
  }

  if (idFromEnv && secretFromEnv && idFromEnv === secretFromEnv) {
    console.log('\n  ❌ TUYA_ACCESS_ID và TUYA_ACCESS_SECRET đang GIỐNG HỆT NHAU trong process.env.');
  }
}

console.log('\n=== Hết kiểm tra — không có gì bị thay đổi (.env, credential, tuya-package đều giữ nguyên) ===');
