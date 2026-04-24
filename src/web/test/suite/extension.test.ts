import * as assert from 'assert';

import * as vscode from 'vscode';
import { parsePinoDocument } from '../../../shared/pinoLog';

suite('Web Extension Test Suite', () => {
	vscode.window.showInformationMessage('Start all tests.');

	test('parses valid log rows in web target', () => {
		const source = [
			'{"level":10,"time":1713916800000,"msg":"trace detail"}',
			'{"level":50,"time":1713916810000,"msg":"request failed","err":{"code":"E_PIPE"}}',
		].join('\n');

		const parsed = parsePinoDocument(source);

		assert.strictEqual(parsed.entries.length, 2);
		assert.deepStrictEqual(parsed.invalidLines, []);
		assert.strictEqual(parsed.entries[0].levelLabel, 'trace');
		assert.strictEqual(parsed.entries[1].levelLabel, 'error');
		const errObject = parsed.entries[1].context.err as { code?: string };
		assert.strictEqual(errObject.code, 'E_PIPE');
	});

	test('skips empty lines and reports parse failures', () => {
		const source = [' ', '', '{"msg":"ok"}', '{invalid}'].join('\n');
		const parsed = parsePinoDocument(source);

		assert.strictEqual(parsed.entries.length, 1);
		assert.deepStrictEqual(parsed.invalidLines, [4]);
	});
});
