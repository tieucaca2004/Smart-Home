import '../../data/hub_api_exception.dart';
import 'device_control_controller.dart';

/// Shown above the controls of a device the Hub reports as offline.
const String offlineDeviceNotice =
    'Thiết bị đang ngoại tuyến nên chưa thể điều khiển. '
    'Hãy kiểm tra nguồn điện và kết nối của thiết bị rồi tải lại.';

/// Why a command failed, in words for the person using the app. Uses the
/// Hub's protocol-neutral error codes, so it does not depend on the device
/// protocol behind the Hub. Nothing here claims the command took effect.
String commandFailureText(HubApiException error) {
  switch (error.kind) {
    case HubApiErrorKind.network:
      return 'Không kết nối được với Hub nên lệnh chưa được thực hiện. '
          'Hãy kiểm tra kết nối rồi thử lại.';
    case HubApiErrorKind.timeout:
      return 'Hub phản hồi quá lâu, chưa rõ lệnh đã được thực hiện hay chưa. '
          'Hãy đọc lại trạng thái để kiểm tra.';
    case HubApiErrorKind.parse:
      return 'Hub trả về dữ liệu không đúng định dạng, chưa rõ lệnh đã được thực hiện hay chưa. '
          'Hãy đọc lại trạng thái để kiểm tra.';
    case HubApiErrorKind.unexpected:
      return 'Đã xảy ra lỗi không mong muốn, lệnh có thể chưa được thực hiện.';
    case HubApiErrorKind.server:
      return _serverFailureText(error);
  }
}

String _serverFailureText(HubApiException error) {
  switch (error.code) {
    case 'DEVICE_OFFLINE':
      return 'Thiết bị đang ngoại tuyến nên chưa nhận được lệnh.';
    case 'DEVICE_NOT_FOUND':
      return 'Hub không tìm thấy thiết bị này nên lệnh chưa được thực hiện.';
    case 'AUTH_ERROR':
      return 'Hub không xác thực được với dịch vụ thiết bị nên lệnh chưa được thực hiện.';
    case 'UPSTREAM_ERROR':
      return 'Dịch vụ thiết bị không phản hồi nên lệnh chưa được thực hiện. '
          'Hãy thử lại sau.';
    case 'INVALID_COMMAND':
      return 'Hub từ chối lệnh này vì không hợp lệ.';
    default:
      final status = error.statusCode;
      return 'Hub báo lỗi${status == null ? '' : ' (HTTP $status)'} '
          'nên lệnh chưa được thực hiện.';
  }
}

/// The Hub accepted the command but the device did not confirm it.
String unconfirmedText(ControlUnconfirmed outcome) {
  if (outcome.statusError != null) {
    return 'Hub đã nhận lệnh nhưng không đọc lại được trạng thái để xác nhận. '
        'Hãy đọc lại trạng thái.';
  }
  return 'Hub đã nhận lệnh nhưng thiết bị chưa báo trạng thái mới. '
      'Trạng thái đang hiển thị là trạng thái thiết bị báo về.';
}

/// Shown when the status of a device could not be read.
const String statusUnavailableText = 'Không đọc được trạng thái thiết bị.';
