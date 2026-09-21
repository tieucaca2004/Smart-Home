# PROJECT RULES — Luật chung cho workflow 4-Agent

> File này là nguồn luật cho cả 4 agent (Planner, Coder, Tester, Reviewer) và cho `/ship`.
> Mọi agent PHẢI đọc file này trước khi làm việc.
> Khi xung đột giữa file này và chỉ dẫn của agent, **file này thắng**; khi xung đột giữa file này và lệnh trực tiếp của Founder, **Founder thắng**.

## 1. Nguyên tắc cốt lõi

1. **GitHub / Git = Single Source of Truth.** Code, lịch sử commit, branch là sự thật duy nhất. Graphify, `.bangiao/` và mọi tài liệu sinh ra chỉ là *ngữ cảnh / bàn giao*, không phải sự thật. Khi mâu thuẫn với Git → tin Git.
2. **Founder First.** Founder là người duy nhất quyết định: chấp nhận kết quả, freeze, sửa lại, commit, push. Agent chỉ đề xuất và báo cáo.
3. **PASS → FREEZE.** Thành phần đã PASS (Tester PASS + Reviewer PASS + Founder chấp nhận) được đưa vào danh sách Frozen (mục 4). Không đụng vào nếu chưa có bằng chứng lỗi trực tiếp.
4. **Không sửa ngoài scope.** Chỉ làm đúng những gì `.bangiao/plan.md` cho phép. Thấy vấn đề ngoài scope → ghi vào báo cáo, không tự sửa.

## 2. Luật theo vai trò

| Vai trò | Được | Không được |
|---|---|---|
| **Planner** | Đọc mọi thứ, chạy lệnh chỉ-đọc, ghi `.bangiao/plan.md` | Sửa code, sửa test, triển khai, commit/push |
| **Coder** | Sửa code + viết test **trong scope của plan**, ghi `.bangiao/implementation.md` | Mở rộng scope, refactor ngoài phạm vi, sửa component Frozen khi không có bằng chứng lỗi, commit/push |
| **Tester** | Chạy test/lint/analyze/build, ghi `.bangiao/test-result.md` | Sửa production code, sửa test cho "xanh", claim PASS khi chưa chạy, commit/push |
| **Reviewer** | Đọc plan/implementation/test-result/git diff, ghi `.bangiao/review.md` | Sửa production code, kết luận khác PASS/FAIL, commit/push |
| **Founder** | Mọi quyết định | — |

## 3. Luật kỹ thuật chung

- **Không claim PASS khi chưa chạy test.** PASS chỉ hợp lệ khi lệnh đã được chạy thật và có output/exit code làm bằng chứng. Test không chạy được = `NOT RUN`, không phải PASS.
- **Không tự ý commit / push.** Kể cả khi mọi thứ PASS. Chỉ Founder ra lệnh.
- **Không phá component đã Frozen** nếu chưa có bằng chứng lỗi trực tiếp (log, test fail, repro cụ thể). "Có vẻ sai" hoặc "code xấu" không phải bằng chứng.
- **Project đang làm dở phải hiểu architecture trước khi sửa.** Bắt buộc có Graphify context (hoặc đọc kiến trúc thủ công nếu Graphify không dùng được) trước khi lập plan.
- **Không hardcode logic đặc thù giao thức/vendor vào layer trung lập giao thức** (protocol-agnostic). Logic riêng của một giao thức/thiết bị/nhà cung cấp nằm trong adapter/driver/plugin của nó; layer lõi chỉ biết interface trừu tượng.
- **Giữ backward compatibility** khi đã có dữ liệu/runtime hiện hữu (schema DB, format file, API đang được dùng, config đã lưu). Thay đổi phá vỡ phải nằm trong plan và được Founder duyệt.
- **Không xóa dữ liệu người dùng** nếu task không yêu cầu rõ ràng. Migration phải an toàn và có đường lùi.
- **Không chạy lệnh phá hủy** (xóa repo/thư mục hàng loạt, `git reset --hard`, `git clean -fd`, `git push --force`, `git checkout -- .`, drop database, v.v.) trừ khi Founder yêu cầu đích danh.
- **Không lộ secret.** Không in/ghi token, mật khẩu, khóa API vào `.bangiao/` hoặc log.
- **Bằng chứng trước kết luận.** Mọi khẳng định trong báo cáo phải dẫn được file/dòng/lệnh/output.

## 4. Frozen Components (Founder cập nhật)

Danh sách thành phần đã PASS và bị đóng băng. Chỉ Founder được thêm/bớt mục ở đây.

| Component / đường dẫn | Ngày freeze | Ghi chú |
|---|---|---|
| Backend Device Adapter architecture | 2026-09-21 | Sprint 1–3A PASS; protocol-neutral adapter architecture |
| Device discovery / TuyaDiscoveryAdapter | 2026-09-21 | Sprint 3A PASS; real Tuya discovery verified |
| Flutter device list/detail/control | 2026-09-21 | Sprint 1–3A PASS; real Pixel 8 control verified |
| Sprint 4A premium UI | 2026-09-21 | PASS; visual review accepted |
| Sprint 4B-1 accessibility / contrast fixes | 2026-09-21 | PASS |
| Sprint 4B-2 device-control UX | 2026-09-21 | PASS |
| Sprint 5 Scene Engine | 2026-09-21 | PASS; real Scene execution verified |
| Sprint 5 Automation MVP | 2026-09-21 | PASS; real Scheduler execution verified; Sprint 6 may extend the approved automation extension points without refactoring unrelated frozen behavior |
| Sprint 6 automation read-back fix (`src/automation/readBack.js`, `actions/commandAction.js`, `actions/sceneAction.js`, `ActionRegistry.js` — SUCCESS / PENDING / FAILED, một lần đọc lại có giới hạn, không gửi lại lệnh) | 2026-09-21 | Tester PASS + Reviewer PASS; delay thật đo được trên Hub + Tuya thật (mẫu nhỏ). Nhánh `pending` / `failed` trên phần cứng thật CHƯA được kiểm (chỉ unit test + mutation) |
| Sprint 6 `failed (undefined)` logging fix (`src/automation/RuleEngine.js` — fallback lý do lỗi, sanitize dòng log kết quả action) | 2026-09-21 | Tester PASS + Reviewer PASS; log Hub thật không còn `undefined` |

**KHÔNG freeze / chưa xác minh trên phần cứng thật (Sprint 6):**
- `sun` (sunrise/sunset): chỉ có unit test và đối chiếu thuật toán; chưa chạy trên Hub thật vì chưa cấu hình `HUB_LATITUDE` / `HUB_LONGITUDE`. UNFROZEN.
- Cảm biến vật lý `temperature` / `humidity` / `motion` / `door`: chưa có phần cứng để test; chỉ có unit test với fake. UNFROZEN.
- B1 (false `UNCONFIRMED` ở Sprint 5 `SceneService._confirm`, `POST /api/scenes/:id/execute`, log `partial failure` của legacy scheduler) vẫn mở, chưa sửa.

Sửa component trong bảng này chỉ được phép khi plan.md nêu rõ **bằng chứng lỗi trực tiếp** và Founder đã chấp thuận.

## 5. Project Overrides

Điền các mục dưới đây để agent không phải đoán.

- **Ngôn ngữ báo cáo:** Tiếng Việt.

- **Lệnh test:**
  ```text
  npm test
  cd mobile && flutter test