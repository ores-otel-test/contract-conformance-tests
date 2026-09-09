import 'dart:convert';
import '../tmp/core/langs/dart/lib/ores_lib_core.dart' as core;
import '../tmp/baseline/langs/dart/lib/ores_lib_core.dart' as baseline;
import '../tmp/generated/corpus.dart';

void require(bool value, String label) {
  if (!value) throw StateError(label);
}
void rejects(void Function() action) {
  try { action(); } on FormatException { return; }
  throw StateError('invalid input was accepted');
}
// No dart:io and no assert statements; the VM and compiled JS execute identical checks.
void main() {
  final rows = jsonDecode(utf8.decode(base64Decode(encodedCases))) as List;
  require(rows.length > 3000, 'empty or truncated corpus');
  for (final row in rows) {
    final input = row['input'] as String;
    if (row['kind'] == 'correlation') {
      require(core.validCorrelationId(input) == row['expected'], row['id'] as String);
    } else if (row['expected'] == null) {
      rejects(() => core.normalizeEmailForRevocation(input));
    } else {
      final output = core.normalizeEmailForRevocation(input);
      require(output == row['expected'], row['id'] as String);
      require(core.normalizeEmailForRevocation(output) == output, 'normalization idempotence');
    }
  }
  for (final value in ['\ud800@example.com', 'a@\udfff.example', 'request-\ud800']) {
    rejects(() => core.normalizeEmailForRevocation(value));
    require(!core.validCorrelationId(value), 'unpaired surrogate');
  }
  final stored = List<int>.filled(32, 0);
  require(core.classifyIdempotency(null, stored) == core.IdempotencyDisposition.newRequest, 'new');
  for (var index = 0; index < 32; index += 1) {
    for (var byte = 0; byte < 256; byte += 1) {
      final incoming = List<int>.filled(32, 0)..[index] = byte;
      final expected = byte == 0 ? core.IdempotencyDisposition.replay : core.IdempotencyDisposition.conflict;
      require(core.classifyIdempotency(stored, incoming) == expected, 'digest result');
      require(stored.every((value) => value == 0), 'stored digest mutation');
      for (var j = 0; j < 32; j += 1) require(incoming[j] == (j == index ? byte : 0), 'incoming digest mutation');
    }
    for (final value in [-1, 256, 4294967296, -4294967296]) {
      final invalid = List<int>.filled(32, 0)..[index] = value;
      rejects(() => core.classifyIdempotency(null, invalid));
      rejects(() => core.classifyIdempotency(stored, invalid));
      rejects(() => core.classifyIdempotency(invalid, stored));
    }
  }
  for (final length in [0, 31, 33]) {
    final invalid = List<int>.filled(length, 0);
    rejects(() => core.classifyIdempotency(null, invalid));
    rejects(() => core.classifyIdempotency(invalid, stored));
  }
  // Positive controls for the old defects: no assertion that the old input was valid.
  require(baseline.normalizeEmailForRevocation('\u212a@example.com') == 'k@example.com', 'old Unicode defect must reproduce');
  require(baseline.classifyIdempotency(null, List<int>.filled(32, 256)) == baseline.IdempotencyDisposition.newRequest, 'old non-byte defect must reproduce');
  rejects(() => core.normalizeEmailForRevocation('\u212a@example.com'));
  rejects(() => core.classifyIdempotency(null, List<int>.filled(32, 256)));
  print(jsonEncode({'status': 'passed', 'sharedCorpusCases': rows.length, 'digestValuePositionCombinations': 8192, 'invalidDigestPlacements': 384, 'baselineDefectsReproduced': true}));
}
