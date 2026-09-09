import 'dart:convert';
import 'dart:io';
import 'dart_contract.dart';

void main(List<String> args) {
  if (args.length != 2) {
    stderr.writeln('usage: dart-adapter <corpus> <output>');
    exitCode = 2;
    return;
  }
  final cases = jsonDecode(File(args[0]).readAsStringSync()) as List<dynamic>;
  final version = Platform.version.split(' ').first;
  final evidence = evaluateCases(cases,
      id: 'dart-vm-contract', runtime: 'dart-vm@$version',
      validator: 'contract-derived-dart/v1', toolchain: 'dart@$version');
  File(args[1]).writeAsStringSync('${const JsonEncoder.withIndent('  ').convert(evidence)}\n');
}
