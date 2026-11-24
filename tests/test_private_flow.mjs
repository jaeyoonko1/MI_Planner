import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseFlow, renderFlow } from '../scripts/render_flow_markdown.mjs';

test('parses real project flow and renders a Korean private dashboard', () => {
  const flow = parseFlow(readFileSync(resolve('project_flow.html'), 'utf8'));
  const md = renderFlow(flow, {
    sha: 'abcdef012345', subject: '[P4-04] 평가 현황판',
    now: new Date('2026-11-24T01:00:00Z'),
  });
  const total = flow.phases.reduce((n, p) => n + p.tasks.length, 0);
  assert.ok(total > 20);
  assert.match(md, new RegExp(`/${total}개 작업 완료`));
  assert.match(md, /비공개 개발 현황/);
  assert.match(md, /2026\. 11\. 24/);
  assert.match(md, /abcdef0/);
  assert.match(md, /<details>/);
  assert.match(md, /MI-Planner-Flow-HTML/);
});

test('rejects invalid task shapes', () => {
  assert.throws(() => parseFlow('<html>empty</html>'));
  assert.throws(() => parseFlow('<script>const FLOW = {phases:[{id:"X",tasks:[{id:"t"}]}]};</script>'));
});

test('escapes untrusted flow text in GitHub Markdown', () => {
  const flow = { updated: 'today', phases: [{ id: 'A', name: 'a|b', tasks: [
    { id: 'X', title: '<img src=x onerror=alert(1)>', tool: 'Codex', done: false },
  ] }] };
  const md = renderFlow(flow, { subject: '<script>alert(2)</script>' });
  assert.ok(md.includes('a\\|b'));
  assert.ok(md.includes('&lt;img src=x'));
  assert.ok(!md.includes('<script>'));
});
