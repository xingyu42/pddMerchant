import { it } from 'vitest';
import assert from 'node:assert/strict';
import { Command, InvalidArgumentError } from 'commander';
import { goodsIdListArg, integerArg, reportDaysArg } from '../../src/commands/option-parsers.js';
import { register as registerDiagnose } from '../../src/commands/registry/diagnose.js';
import { register as registerGoods } from '../../src/commands/registry/goods.js';
import { validateReportDays } from '../../src/services/operating-report.js';
import { CUSTOMER_SERVICE_REPORT } from '../../src/services/customer-service.js';
import { REVIEWS_REPORT } from '../../src/services/reviews.js';
import { EXPERIENCE_REPORT } from '../../src/services/experience.js';
import { TRAFFIC_REPORT } from '../../src/services/traffic.js';
import { GOODS_TRAFFIC_REPORT } from '../../src/services/goods-traffic.js';
import { GOODS_PROFIT_REPORT } from '../../src/services/goods-profit.js';
import { runCli } from '../helpers/isolated-cli.js';

const reports = [
  ['diagnose', 'customer-service', CUSTOMER_SERVICE_REPORT], ['diagnose', 'reviews', REVIEWS_REPORT],
  ['diagnose', 'experience', EXPERIENCE_REPORT], ['diagnose', 'traffic', TRAFFIC_REPORT],
  ['goods', 'traffic', GOODS_TRAFFIC_REPORT], ['goods', 'profit', GOODS_PROFIT_REPORT],
];

it.each(reports)('derives %s %s parser, defaults and help from its service declaration', (group, name, definition) => {
  const program = new Command();
  registerDiagnose(program, () => {});
  registerGoods(program, () => {});
  const command = program.commands.find((entry) => entry.name() === group).commands.find((entry) => entry.name() === name);
  const option = command.options.find((entry) => entry.long === '--days');
  assert.equal(option.description, definition.days.description);
  assert.equal(option.defaultValue, definition.days.default);
  for (let days = 0; days <= 181; days += 1) {
    const allowed = definition.days.choices ? Object.hasOwn(definition.days.choices, days)
      : days >= definition.days.min && days <= definition.days.max;
    if (allowed) {
      assert.equal(option.parseArg(String(days)), days);
      assert.equal(validateReportDays(definition, days), days);
    } else {
      assert.throws(() => option.parseArg(String(days)), InvalidArgumentError);
      assert.throws(() => validateReportDays(definition, days), { code: 'E_USAGE', exitCode: 2 });
    }
  }
});

it.each(reports)('rejects invalid numeric text for %s %s before running a command', (group, name, definition) => {
  for (const text of ['', 'NaN', 'Infinity', '1.5', '1e1', '0x7', '99999999999999999']) {
    assert.throws(() => reportDaysArg(definition)(text), InvalidArgumentError);
  }
  const result = runCli([group, name, '--days', 'NaN']);
  assert.equal(result.status, 2);
  assert.equal(result.envelope.error.code, 'E_USAGE');
  assert.equal(result.envelope.command, `${group}.${name}`);
  assert.equal(result.envelope.meta.xhr_count ?? 0, 0);
});

it('parses integers at or above the minimum', () => {
  assert.equal(integerArg(1)('20'), 20);
  assert.equal(integerArg(1)(' 3 '), 3);
  assert.equal(integerArg(0)('0'), 0);
  assert.equal(integerArg(0)('1700000000'), 1700000000);
});

it.each([['abc', 1], ['', 1], ['1.5', 1], ['1e3', 1], ['0x10', 1], ['0', 1], ['-1', 0], ['99999999999999999', 0]])(
  'rejects %s with minimum %s', (value, min) => {
    assert.throws(() => integerArg(min)(value), InvalidArgumentError);
  });

it('bounds integers by an optional maximum', () => {
  assert.equal(integerArg(1, 10)('10'), 10);
  for (const value of ['0', '11']) assert.throws(() => integerArg(1, 10)(value), InvalidArgumentError);
});

it('accumulates repeated and comma-separated goods ids without duplicates', () => {
  const first = goodsIdListArg('101,102', undefined);
  assert.deepEqual(goodsIdListArg(' 103 ,101', first), ['101', '102', '103']);
  for (const value of ['10a', '101,,102', '0', '-1', '1.5', '99999999999999999']) {
    assert.throws(() => goodsIdListArg(value, []), InvalidArgumentError);
  }
});

it.each([
  ['orders', 'list', '--since', 'abc'],
  ['orders', 'list', '--size', '0'],
  ['orders', 'stats', '--size', '1.5'],
  ['goods', 'list', '--size', '-1'],
  ['goods', 'stock', '--threshold', 'x'],
  ['goods', 'segment', '--max-pages', '0'],
  ['promo', 'roi', '--page', '0'],
  ['promo', 'roi', '--by', 'foo'],
])('rejects %s %s %s %s as usage error before running', (...args) => {
  const result = runCli(args);
  assert.equal(result.status, 2);
  assert.equal(result.envelope.error.code, 'E_USAGE');
  assert.equal(result.envelope.meta.xhr_count ?? 0, 0);
});
