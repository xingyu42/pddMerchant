import { it } from 'vitest';
import assert from 'node:assert/strict';
import { runCli } from '../helpers/isolated-cli.js';
import { createExperienceFixtures } from '../fixtures/test-data.js';
import { renderExperience } from '../../src/commands/diagnose/experience.js';
import { toExperienceView } from '../../src/services/views/experience.js';

it('runs diagnose experience with a single JSON envelope', () => {
  const result = runCli(['diagnose', 'experience'], { fixtures: createExperienceFixtures() });
  assert.equal(result.status, 0);
  assert.equal(result.envelope.command, 'diagnose.experience');
  assert.equal(result.envelope.data.snapshot.star, 4.6);
  assert.equal(result.envelope.data.trend.days, 7);
  const view = result.envelope.data;
  assert.deepEqual(view.trend.items.map((item) => item.date), ['2026-10-24', '2026-10-30']);
  assert.equal(view.indicators[1].value, 50);
  assert.equal(view.indicators[1].next_star_threshold, 80);
  assert.equal(view.indicators[1].next_star_status, '未达标');
  assert.equal(view.indicators[3].value, null);
  assert.equal(view.mall_id, '900001');
  const serialized = JSON.stringify(view);
  for (const forbidden of ['"mallId":', '"mallName":', 'SYN-EXPERIENCE-NAME', 'Synthetic Shop']) {
    assert.equal(serialized.includes(forbidden), false, forbidden);
  }
});

it.each([0, 31, 1.5])('returns usage exit 2 for --days %s', (days) => {
  const result = runCli(['diagnose', 'experience', '--days', String(days)], { fixtures: createExperienceFixtures() });
  assert.equal(result.status, 2);
  assert.equal(result.envelope.error.code, 'E_USAGE');
});

it.each([[1, '2026-10-30', 1], [30, '2026-10-01', 2]])('accepts --days %s', (days, start, count) => {
  const { envelope } = runCli(['diagnose', 'experience', '--days', String(days)], { fixtures: createExperienceFixtures() });
  assert.equal(envelope.ok, true);
  assert.equal(envelope.data.trend.start_date, start);
  assert.equal(envelope.data.trend.items.length, count);
});

it.each(['navigatorReadyDate', 'navigatorList'])('retains the snapshot when %s fails', (endpoint) => {
  const fixtures = { ...createExperienceFixtures(), [`endpoints/experience.${endpoint}.json`]: {
    __throws: true, __error: { code: 'E_NETWORK', message: 'fixture unavailable', exitCode: 5 },
  } };
  const { envelope } = runCli(['diagnose', 'experience'], { fixtures });
  assert.equal(envelope.ok, true);
  assert.equal(envelope.data.status, '数据不完整');
  assert.equal(envelope.data.trend, null);
  assert.equal(envelope.data.snapshot.star, 4.6);
  assert.equal(envelope.data.hints.length, 1);
});

it('fails the command when snapshot collection fails', () => {
  const fixtures = { ...createExperienceFixtures(), 'endpoints/experience.navigatorInfo.json': {
    __throws: true, __error: { code: 'E_BUSINESS', message: 'fixture unavailable', exitCode: 6 },
  } };
  const result = runCli(['diagnose', 'experience'], { fixtures });
  assert.equal(result.status, 6);
  assert.equal(result.envelope.data, null);
});

it('renders human indicator values, thresholds and nulls in a table', () => {
  const fixtures = createExperienceFixtures();
  const data = toExperienceView(fixtures['endpoints/experience.navigatorInfo.json']);
  const rendered = renderExperience({ command: 'diagnose.experience', data }, { useColor: false });
  for (const expected of ['店铺综合体验星级', '近30天3分钟人工回复率', '50', '80', '未达标', '--']) {
    assert.ok(rendered.includes(expected), expected);
  }
});
