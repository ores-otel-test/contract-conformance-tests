import 'dart:convert';

int codePoints(String value) => value.runes.length;
bool boundedString(Object? value, int min, int max) =>
    value is String && codePoints(value) >= min && codePoints(value) <= max;

int? jsonInteger(Object? value) {
  if (value is int) return value;
  if (value is double && value.isFinite && value == value.truncateToDouble()) {
    return value.toInt();
  }
  return null;
}

bool exactKeys(Map<String, dynamic> value, Set<String> allowed, Set<String> required) =>
    value.keys.every(allowed.contains) && required.every(value.containsKey);

bool requestMeta(Object? input) {
  if (input is! Map<String, dynamic>) return false;
  if (!exactKeys(input, {'requestId', 'traceId', 'locale'}, {'requestId', 'traceId'})) return false;
  if (!boundedString(input['requestId'], 1, 128) || !boundedString(input['traceId'], 1, 128)) return false;
  if (input.containsKey('locale') && !boundedString(input['locale'], 2, 64)) return false;
  return true;
}

bool pageQuery(Object? input) {
  if (input is! Map<String, dynamic>) return false;
  if (!exactKeys(input, {'limit', 'cursor'}, {'limit'})) return false;
  final limit = jsonInteger(input['limit']);
  if (limit == null || limit < 1 || limit > 100) return false;
  if (input.containsKey('cursor') && !boundedString(input['cursor'], 1, 512)) return false;
  return true;
}

bool problemDetails(Object? input) {
  if (input is! Map<String, dynamic>) return false;
  if (!exactKeys(input, {'type', 'title', 'status', 'detail', 'requestId'},
      {'type', 'title', 'status', 'requestId'})) return false;
  final status = jsonInteger(input['status']);
  if (!boundedString(input['type'], 1, 512) || !boundedString(input['title'], 1, 256) ||
      status == null || status < 400 || status > 599 || !boundedString(input['requestId'], 1, 128)) return false;
  if (input.containsKey('detail') && !boundedString(input['detail'], 0, 4096)) return false;
  return true;
}

bool publicContract(Object? input) =>
    [requestMeta(input), pageQuery(input), problemDetails(input)].where((value) => value).length == 1;

bool semanticEqual(Object? left, Object? right) {
  if (left is num && right is num) return left.toDouble() == right.toDouble();
  if (left is List && right is List) {
    return left.length == right.length && List.generate(left.length, (i) => semanticEqual(left[i], right[i])).every((v) => v);
  }
  if (left is Map && right is Map) {
    if (left.length != right.length) return false;
    return left.keys.every((key) => right.containsKey(key) && semanticEqual(left[key], right[key]));
  }
  return left == right;
}

Map<String, dynamic> evaluateCases(List<dynamic> cases,
    {required String id, required String runtime, required String validator, required String toolchain}) {
  final results = <Map<String, dynamic>>[];
  for (final raw in cases) {
    final entry = (raw as Map).cast<String, dynamic>();
    final input = jsonDecode(entry['payload'] as String);
    final model = entry['model'] as String;
    final accepted = switch (model) {
      'RequestMeta' => requestMeta(input),
      'PageQuery' => pageQuery(input),
      'ProblemDetails' => problemDetails(input),
      'PublicValidationContract' => publicContract(input),
      _ => throw StateError('unknown contract model'),
    };
    if (accepted && !semanticEqual(input, jsonDecode(jsonEncode(input)))) {
      throw StateError('accepted value changed during JSON roundtrip');
    }
    results.add({
      'caseId': entry['id'],
      'declaration': 'Ores.Validation.$model',
      'verdict': accepted ? 'accepted' : 'rejected',
    });
  }
  return {
    'id': id, 'language': 'dart', 'runtime': runtime, 'validator': validator,
    'toolchain': toolchain, 'status': 'passed', 'results': results,
  };
}
