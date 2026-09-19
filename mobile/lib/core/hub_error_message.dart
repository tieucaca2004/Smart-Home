import '../data/hub_api_exception.dart';

/// User-facing wording (Vietnamese) for a [HubApiException].
class HubErrorText {
  const HubErrorText({required this.title, required this.hint, this.detail});

  /// One short sentence saying what went wrong.
  final String title;

  /// What the person can try.
  final String hint;

  /// Technical detail for troubleshooting; may be null.
  final String? detail;
}

/// Turns a data-layer failure into text for the screen. The Hub's own error
/// codes (`AUTH_ERROR`, `UPSTREAM_ERROR`, ...) are protocol-neutral, so this
/// does not depend on which device protocol is behind the Hub.
HubErrorText describeHubError(HubApiException error, {required Uri hubUrl}) {
  switch (error.kind) {
    case HubApiErrorKind.network:
      return HubErrorText(
        title: 'Không kết nối được với Hub',
        hint: 'Hãy kiểm tra Hub đang chạy và địa chỉ $hubUrl là đúng. '
            'Điện thoại thật phải dùng địa chỉ IP trong mạng LAN của máy chạy Hub.',
        detail: error.message,
      );
    case HubApiErrorKind.timeout:
      return HubErrorText(
        title: 'Hub phản hồi quá lâu',
        hint: 'Hãy kiểm tra mạng rồi thử lại.',
        detail: error.message,
      );
    case HubApiErrorKind.server:
      return _serverError(error);
    case HubApiErrorKind.parse:
      return HubErrorText(
        title: 'Dữ liệu từ Hub không đúng định dạng',
        hint: 'Có thể app và Hub đang khác phiên bản. Hãy cập nhật cả hai rồi thử lại.',
        detail: error.message,
      );
    case HubApiErrorKind.unexpected:
      return HubErrorText(
        title: 'Đã xảy ra lỗi không mong muốn',
        hint: 'Hãy thử lại. Nếu lỗi lặp lại, đây có thể là lỗi của ứng dụng.',
        detail: error.message,
      );
  }
}

HubErrorText _serverError(HubApiException error) {
  final status = error.statusCode;
  final detail = [
    if (status != null) 'HTTP $status',
    if (error.code != null) error.code!,
    error.message,
  ].join(' · ');

  switch (error.code) {
    case 'AUTH_ERROR':
      return HubErrorText(
        title: 'Hub không xác thực được với dịch vụ thiết bị',
        hint: 'Hãy kiểm tra thông tin đăng nhập cấu hình trên Hub.',
        detail: detail,
      );
    case 'UPSTREAM_ERROR':
      return HubErrorText(
        title: 'Dịch vụ thiết bị không phản hồi',
        hint: 'Hub đang chạy nhưng không lấy được dữ liệu từ dịch vụ thiết bị. Hãy thử lại sau.',
        detail: detail,
      );
    case 'DEVICE_NOT_FOUND':
      return HubErrorText(
        title: 'Hub không tìm thấy thiết bị này',
        hint: 'Thiết bị có thể đã bị xoá. Hãy quay lại danh sách và tải lại.',
        detail: detail,
      );
    case 'DEVICE_OFFLINE':
      return HubErrorText(
        title: 'Thiết bị đang ngoại tuyến',
        hint: 'Hãy kiểm tra nguồn điện và kết nối của thiết bị.',
        detail: detail,
      );
    default:
      return HubErrorText(
        title: 'Hub báo lỗi${status == null ? '' : ' (HTTP $status)'}',
        hint: 'Hãy thử lại. Nếu lỗi lặp lại, xem nhật ký của Hub để biết nguyên nhân.',
        detail: detail,
      );
  }
}
