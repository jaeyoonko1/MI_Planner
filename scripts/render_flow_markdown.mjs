/** Render the first, data-only script of project_flow.html as a private GitHub dashboard. */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export function parseFlow(source) {
  const match = source.match(/<script>\s*([\s\S]*?)<\/script>/i);
  if (!match || !match[1].includes('const FLOW = {')) {
    throw new Error('The source must contain a data-only FLOW script');
  }
  const flow = vm.runInNewContext(`${match[1]}\nFLOW`, Object.create(null), { timeout: 1000 });
  if (!flow || !Array.isArray(flow.phases) || !flow.phases.length) {
    throw new Error('Missing FLOW phases');
  }
  for (const phase of flow.phases) {
    if (!phase.id || !Array.isArray(phase.tasks)) throw new Error('Invalid phase');
    for (const task of phase.tasks) {
      if (!task.id || typeof task.done !== 'boolean') throw new Error('Invalid task');
    }
  }
  return flow;
}

const clean = value => String(value ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/\|/g, '\\|').replace(/[\r\n]+/g, ' ').trim();

export function renderFlow(flow, { sha = '', subject = '', now = new Date(), repo = 'jaeyoonko1/MI_Planner' } = {}) {
  const tasks = flow.phases.flatMap(p => p.tasks);
  const done = tasks.filter(t => t.done).length;
  const rate = Math.round(done / (tasks.length || 1) * 100);
  const units = Math.round(rate / 5);
  const progress = '🟦'.repeat(units) + '⬜'.repeat(20 - units);
  const date = new Intl.DateTimeFormat('ko-KR', {
    timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(now);
  const safeSha = /^[a-f0-9]{7,40}$/i.test(sha) ? sha : '';
  const safeRepo = /^[\w.-]+\/[\w.-]+$/.test(repo) ? repo : 'jaeyoonko1/MI_Planner';
  const short = safeSha ? `[${safeSha.slice(0, 7)}](https://github.com/${safeRepo}/commit/${safeSha})` : '로컬 미리보기';
  const shortSubject = String(subject ?? '').split(/\r?\n/, 1)[0].slice(0, 140);

  const lines = [
    '# 🗂️ MI Planner — 비공개 개발 현황',
    '',
    '> 🔒 **이 문서는 비공개 GitHub 저장소 안에서만 볼 수 있습니다.** GitHub Pages에 공개하지 않습니다.',
    '',
    `**최종 갱신:** ${date} (KST)　·　**원본 FLOW:** ${clean(flow.updated)}　·　**커밋:** ${short}`,
    '',
    `**최신 작업:** ${clean(shortSubject) || '프로젝트 진행 현황 갱신'}`,
    '',
    '## 전체 진행률',
    '',
    `### ${rate}% · ${done}/${tasks.length}개 작업 완료`,
    '',
    progress,
    '',
    '## 다음 작업',
    '',
  ];

  for (const task of tasks.filter(t => !t.done).slice(0, 5)) {
    lines.push(`- **${clean(task.id)}** ${clean(task.title)} · ${clean(task.tool)}`);
  }
  if (done === tasks.length) lines.push('모든 작업 완료 🎉');
  lines.push('', '## 단계별 현황', '', '| 단계 | 완료 | 진행률 |', '|:--|--:|--:|');

  for (const phase of flow.phases) {
    const n = phase.tasks.filter(t => t.done).length;
    const pct = Math.round(n / (phase.tasks.length || 1) * 100);
    lines.push(`| **${clean(phase.id)} · ${clean(phase.name)}** | ${n}/${phase.tasks.length} | ${pct}% |`);
  }
  lines.push('', '## 전체 작업 목록', '');
  for (const phase of flow.phases) {
    const n = phase.tasks.filter(t => t.done).length;
    lines.push(`<details><summary><strong>${clean(phase.id)} · ${clean(phase.name)}</strong> — ${n}/${phase.tasks.length} 완료</summary>`, '');
    lines.push('| 상태 | 작업 ID | 제목 | 담당 |', '|:--:|:--|:--|:--|');
    for (const t of phase.tasks) {
      lines.push(`| ${t.done ? '✅' : '⬜'} | ${clean(t.id)} | ${clean(t.title)} | ${clean(t.tool)} |`);
    }
    lines.push('', '</details>', '');
  }
  lines.push('---', '',
    '### HTML 원본 보기', '',
    '- [원본 `project_flow.html`](../project_flow.html) · GitHub는 HTML 소스를 보여주며 직접 실행하지 않습니다.',
    `- [최신 실행 결과 및 HTML 다운로드](https://github.com/${safeRepo}/actions/workflows/update-private-flow.yml) · \`MI-Planner-Flow-HTML\` 아티팩트를 다운로드해 \`index.html\`을 열면 필터·체크 등의 인터랙티브 화면이 표시됩니다.`,
    '',
    '> **진행률의 원본**은 `project_flow.html`의 `FLOW` 데이터입니다. HTML에서 누른 체크·메모는 브라우저에만 저장되며 GitHub에 동기화되지 않습니다.',
    '',
  );
  return lines.join('\n');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const input = process.env.FLOW_SOURCE || resolve(ROOT, 'project_flow.html');
  const output = process.env.FLOW_OUTPUT || resolve(ROOT, 'docs/PROJECT_FLOW_STATUS.md');
  const flow = parseFlow(readFileSync(input, 'utf8'));
  const markdown = renderFlow(flow, {
    sha: process.env.GITHUB_SHA, subject: process.env.FLOW_COMMIT_SUBJECT,
    repo: process.env.GITHUB_REPOSITORY,
  });
  mkdirSync(dirname(output), { recursive: true });
  writeFileSync(output, markdown, 'utf8');
  process.stdout.write(`Updated private flow: ${output}\n`);
}
