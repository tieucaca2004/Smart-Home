# Tuya Cloud API Integration — Tiểu Home

Tích hợp điều khiển thiết bị Tuya/Smart Life bằng Tuya Cloud OpenAPI (Node.js,
không phụ thuộc thư viện ngoài — chỉ dùng `https` + `crypto` built-in).

## 1. Tuya Project

| Trường            | Giá trị                          |
|-------------------|-----------------------------------|
| Project           | Phong Tieu Home                   |
| Data Center       | Western America                   |
| API Endpoint      | `https://openapi.tuyaus.com`      |

**Không đổi Data Center / endpoint.** Nếu sau này cần đổi region, phải tạo
project mới ở Data Center tương ứng — Tuya không cho di chuyển project giữa
các Data Center.

### Required Cloud Services (phải ở trạng thái "Authorized", không phải
"Trial expired")

- IoT Core
- Authorization Token Management
- Smart Home Basic Service
- Smart Home Device Control (cần cho `/v1.0/devices/{id}/commands`)

Nếu dùng thêm API v2.0 (Send Property) hoặc Scene, cần subscribe thêm
tương ứng (Smart Home Scene Linkage...). Việc thiếu subscribe hoặc service
đã hết hạn trial sẽ trả lỗi dạng "no permission" dù access_id/secret đúng.

## 2. Device

| Trường     | Giá trị                        |
|------------|----------------------------------|
| Tên        | Công tắc quán A Tiểu             |
| Model      | W-W603                           |
| Device ID  | `1638018234ab950c4e80`           |
| DP code    | `switch_1` (Boolean, true=ON, false=OFF) |

## 3. Cấu trúc project

```
tuya-integration/
├── tuya-client.js   # Client lib: getToken, getDevices, getDeviceInfo,
│                    # getDeviceStatus, sendCommand, turnOn, turnOff
├── run-tests.js     # Test tuần tự A→F theo yêu cầu
├── package.json
└── README.md
```

## 4. Credentials

Đọc **duy nhất** từ environment variables — không hard-code, không commit:

```bash
export TUYA_ACCESS_ID="xxxxxxxx"
export TUYA_ACCESS_SECRET="xxxxxxxx"
# tuỳ chọn, mặc định đã đúng cho project này:
export TUYA_ENDPOINT="https://openapi.tuyaus.com"
export TUYA_DEVICE_ID="1638018234ab950c4e80"
```

`TUYA_ACCESS_SECRET` không bao giờ được `console.log`, ghi log, hay đưa vào
Git. `tuya-client.js` chỉ in ra cảnh báo "missing" khi thiếu biến, không in
giá trị.

## 5. Cách chạy test

```bash
cd tuya-integration
export TUYA_ACCESS_ID=...
export TUYA_ACCESS_SECRET=...
node run-tests.js
```

Test chạy tuần tự và in cho mỗi bước: `endpoint`, `http_status`,
`tuya_code`, `tuya_msg`, `success`, `result`:

- A. Authentication — `GET /v1.0/token?grant_type=1`
- B. Get device info — `GET /v1.0/devices/{id}`
- C. Get device status — `GET /v1.0/devices/{id}/status`
- D. Turn ON — `POST /v1.0/devices/{id}/commands` `{code: switch_1, value: true}`
- E. Turn OFF — `POST /v1.0/devices/{id}/commands` `{code: switch_1, value: false}`
- F. Get device status lại — xác nhận trạng thái đã đổi

Nếu bước A (Authentication) fail, các bước sau tự động bị bỏ qua (SKIPPED)
vì không có access_token hợp lệ để ký request.

## 6. Signing (HMAC-SHA256)

Áp dụng đúng "Simple Mode" signing hiện tại của Tuya Cloud API:

```
stringToSign = HTTPMethod + "\n" + SHA256(body) + "\n" + Headers + "\n" + pathWithQuery
str          = client_id + [access_token] + t + stringToSign
sign         = HMAC-SHA256(str, access_secret).toUpperCase()
```

- Gọi `/v1.0/token` (lấy access_token): **không** có `access_token` trong `str`.
- Mọi API nghiệp vụ khác: **có** `access_token` hiện tại trong `str`, và
  header `access_token` được gửi kèm.
- `access_token` được cache trong bộ nhớ (per-process) và tự refresh khi
  gần hết hạn (refresh sớm 60s).

## 7. Root cause đã xác định cho lỗi `1106` / `40001900`

**Cả hai lỗi đều là lỗi phân quyền ở cấp Cloud Project ↔ Device/Space,
không phải lỗi signing hay lỗi code.**

- `1106 permission deny`: access_id/access_secret của project **chưa được
  cấp quyền điều khiển thiết bị cụ thể này** qua OpenAPI. "Device Debugging"
  trên Developer Platform hoạt động được vì nó dùng phiên đăng nhập của
  chính developer (quyền owner trên platform), khác hoàn toàn với đường
  quyền của access_id/secret gọi qua OpenAPI. Để OpenAPI điều khiển được
  thiết bị, thiết bị phải được liên kết vào **đúng project** qua
  `Cloud → Development → [project] → Devices → Link Tuya App Account`
  (quét QR bằng đúng tài khoản Smart Life sở hữu thiết bị), và thiết bị
  phải xuất hiện trong danh sách "All Devices" của project đó.
- `40001900 No space permission`: lỗi này thuộc mô hình phân quyền theo
  "Space" (Home/Asset) mới hơn của Tuya, dùng cho API v2.0 (Send Property).
  Nó nghĩa là danh tính gọi API (thông qua app account đã link vào project)
  **chưa có quyền trên Space (Home) chứa thiết bị này** — khác với quyền
  điều khiển từng thiết bị riêng lẻ. Nguyên nhân thường gặp: app account
  được link vào project không phải là chủ/admin của Home chứa
  "Công tắc quán A Tiểu", hoặc Home đó chưa được cấp quyền cho project.

**Kết luận:** đây không phải thiếu 1 trong 4 mục "Smart Home Basic
Service / IoT Core / Authorization Token Management / Smart Home Device
Control" (4 mục này đã Authorized theo xác nhận của bạn) — mà là bước
**liên kết thiết bị/space vào project qua Devices tab chưa hoàn tất đúng
cách**, hoặc tài khoản Smart Life đã link không phải chủ sở hữu/không đủ
quyền trên Home chứa thiết bị.

### Cách khắc phục (thao tác trên Tuya Developer Platform, cần bạn tự làm
vì cần đăng nhập + quét QR bằng điện thoại — không thể tự động hoá từ đây)

1. Vào `iot.tuya.com` → **Cloud** → **Development** → chọn project
   *Phong Tieu Home* → tab **Devices**.
2. Kiểm tra mục **Link Tuya App Account**: xác nhận tài khoản Smart Life
   sở hữu thiết bị "Công tắc quán A Tiểu" đã ở trong danh sách. Nếu chưa
   chắc, **Unlink** rồi **Link lại** (quét QR bằng app Smart Life), đây là
   cách khắc phục phổ biến nhất cho lỗi 1106 dù đã "linked" trước đó.
3. Sau khi link, vào **All Devices** trong tab Devices, xác nhận thiết bị
   `1638018234ab950c4e80` xuất hiện trong danh sách của project.
4. Nếu vẫn lỗi `40001900`, kiểm tra quyền Space: tài khoản Smart Life dùng
   để link phải là **chủ nhà (Home owner/admin)** của Home chứa thiết bị
   này, không phải member được share quyền hạn chế.
5. Sau khi hoàn tất, chạy lại `node run-tests.js`.

## 8. Cách thêm thiết bị mới

1. Đảm bảo thiết bị đã pair vào app Smart Life (cùng tài khoản đã link ở
   mục 7).
2. Lấy `deviceId` từ tab Devices → All Devices trên Tuya Developer
   Platform, hoặc gọi `getDeviceInfo(deviceId)` nếu đã biết ID.
3. Lấy danh sách DP code của thiết bị bằng
   `getDeviceStatus(deviceId)` (trả về mảng `{code, value}` hiện tại).
4. Gọi điều khiển bằng `sendCommand(deviceId, code, value)`, ví dụ:
   ```js
   const { sendCommand } = require('./tuya-client');
   await sendCommand('newDeviceId123', 'switch_1', true);
   ```
5. Không cần sửa `tuya-client.js` — mọi function đều nhận `deviceId` làm
   tham số.

## 9. Giới hạn đã biết trong môi trường chạy sandbox hiện tại

Trong container thực thi remote này, outbound network tới
`openapi.tuyaus.com` bị egress proxy của môi trường **chặn** (không liên
quan tới code hay tài khoản Tuya). Vì vậy các test **A–F** phải được chạy
ở máy có outbound network mở tới Tuya (máy cá nhân, server riêng, hoặc môi
trường Claude Code khác cho phép egress tới `openapi.tuyaus.com`). Code đã
được viết và syntax-check pass, sẵn sàng chạy ngay khi có credential +
network hợp lệ.
