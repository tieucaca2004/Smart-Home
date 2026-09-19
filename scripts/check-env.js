'use strict';

/**
 * Read-only credential diagnostic for tieu-home-hub.
 *
 * Checks ONLY:
 *   - does .env exist, and does it declare TUYA_ACCESS_ID / TUYA_ACCESS_SECRET
 *   - are the two values accidentally identical (a common copy/paste mistake)
 *   - do the values have stray quotes/whitespace that would corrupt the signature
 *   - does process.env actually contain these values when a plain `node` process
 *     runs (this script is run with plain `node`, which does NOT load .env, so
 *     an empty process.env here is expected. `npm start` is different: it runs
 *     `node --env-file=.env src/server.js` and loads .env automatically)
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

  console.log('\n--- 3) process.env khi chạy trực tiếp bằng "node" (script này KHÔNG tự load .env) ---');
  const idFromEnv = describeEnvVar('TUYA_ACCESS_ID');
  const secretFromEnv = describeEnvVar('TUYA_ACCESS_SECRET');

  if (!idFromEnv && !secretFromEnv) {
    console.log('\nℹ️  LƯU Ý: script này chạy bằng "node" thuần nên KHÔNG tự load .env — process.env');
    console.log('   trống ở đây là bình thường, KHÔNG có nghĩa là "npm start" sẽ thiếu credential.');
    console.log('   "npm start" hiện chạy "node --env-file=.env src/server.js" (Node >= 20.7) nên');
    console.log('   TỰ ĐỘNG load .env — không cần set biến môi trường thủ công nữa. Nếu thiếu file');
    console.log('   .env, Node sẽ báo lỗi ".env: not found" và Hub không khởi động.');
    console.log('   Lưu ý thứ tự ưu tiên: biến đã được set sẵn trong shell sẽ ĐƯỢC ƯU TIÊN hơn giá trị');
    console.log('   cùng tên trong .env. Ở lần chạy này shell không có biến TUYA_ACCESS_* nào, nên');
    console.log('   sẽ không có biến cũ nào che mất .env khi "npm start" chạy từ cùng shell này.');
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
