import * as assert from 'assert';

import * as vscode from 'vscode';
import { parsePinoDocument } from '../../shared/pinoLog';

suite('Extension Test Suite', () => {
	vscode.window.showInformationMessage('Start all tests.');

	test('parses pino ndjson entries and marks invalid lines', () => {
		const source = [
			'{"level":30,"time":1713916800000,"msg":"api started","service":"gateway"}',
			'{"level":40,"time":"2026-04-24T10:00:00.000Z","msg":"slow query","duration":712}',
			'invalid-json-line',
		].join('\n');

		const parsed = parsePinoDocument(source);

		assert.strictEqual(parsed.entries.length, 2);
		assert.deepStrictEqual(parsed.invalidLines, [3]);
		assert.strictEqual(parsed.entries[0].levelLabel, 'info');
		assert.strictEqual(parsed.entries[1].levelLabel, 'warn');
		assert.strictEqual(parsed.entries[1].msg, 'slow query');
		assert.strictEqual(parsed.entries[0].timestamp, '2024-04-24T00:00:00.000Z');
	});

	test('uses unknown level when level is missing', () => {
		const source = '{"time":1713916800000,"message":"fallback key"}';
		const parsed = parsePinoDocument(source);

		assert.strictEqual(parsed.entries.length, 1);
		assert.strictEqual(parsed.entries[0].levelLabel, 'unknown');
		assert.strictEqual(parsed.entries[0].msg, 'fallback key');
	});
});
