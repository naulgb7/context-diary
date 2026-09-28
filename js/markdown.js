// 日記ファイル(1日1ファイルのMarkdown)の組み立てと読み取り
import { dateFromId, hm, ymd, pad } from './util.js';

// 本文の行頭の # は見出しと区別するため \# にする
const escLine = (l) => (/^\\*#/.test(l) ? '\\' + l : l);
const unescLine = (l) => (/^\\+#/.test(l) ? l.slice(1) : l);
const escBlock = (t) => t.replace(/\r\n?/g, '\n').trim().split('\n').map(escLine).join('\n');

function entryHeading(entry, day) {
  const d = dateFromId(entry.id);
  if (!d) return '??:??';
  return ymd(d) === day ? hm(d) : `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${hm(d)}`;
}

// entries: 削除されていない記入 / summary: {answers, questions, status, updatedAt} または null
export function buildDay(day, entries, summary) {
  const out = ['---', `date: ${day}`, '---', ''];

  if (summary) {
    const answered = orderedAnswers(summary).filter(([, a]) => a && a.trim());
    out.push('## 1日のまとめ', `<!-- summary status: ${summary.status || 'draft'} updated: ${summary.updatedAt} -->`, '');
    for (const [qText, a] of answered) out.push(`### ${qText.replace(/\n/g, ' ')}`, escBlock(a), '');
  }

  const list = entries.filter((e) => !e.deleted).sort((a, b) => a.id.localeCompare(b.id));
  if (list.length) {
    out.push('## 記入', '');
    for (const e of list) {
      out.push(`### ${entryHeading(e, day)}`);
      if (e.question) out.push(`問い: ${e.question.replace(/\n/g, ' ')}`);
      out.push(escBlock(e.text));
      out.push(`<!-- id: ${e.id} updated: ${e.updatedAt} -->`, '');
    }
  }
  return out.join('\n');
}

// 設定の問いの順を基本に、設定から外れた問いの答えも後ろに残す
export function orderedAnswers(summary) {
  const keys = [...(summary.questions || [])];
  for (const k of Object.keys(summary.answers || {})) if (!keys.includes(k)) keys.push(k);
  return keys.map((k) => [k, (summary.answers || {})[k] || '']);
}

export function parseDay(text, day) {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const entries = [];
  let summary = null;
  let section = null; // 'summary' | 'entries'
  let cur = null; // 読んでいる途中の まとめの問い or 記入

  const flush = () => {
    if (!cur) return;
    const body = cur.lines.join('\n').trim();
    if (cur.kind === 'answer') summary.answers[cur.question] = body;
    else if (cur.kind === 'entry' && cur.id) {
      entries.push({ id: cur.id, day, text: body, question: cur.question || null, updatedAt: cur.updatedAt || '', deleted: false, dirty: false });
    }
    cur = null;
  };

  let i = 0;
  if (lines[0] === '---') {
    i = 1;
    while (i < lines.length && lines[i] !== '---') i++;
    i++;
  }
  for (; i < lines.length; i++) {
    const l = lines[i];
    if (l.startsWith('## ')) {
      flush();
      const h = l.slice(3).trim();
      if (h === '1日のまとめ') {
        section = 'summary';
        summary = { day, answers: {}, questions: [], status: 'done', updatedAt: '', pos: 0, dirty: false, logged: true };
      } else if (h === '記入') section = 'entries';
      else section = null;
      continue;
    }
    if (l.startsWith('### ')) {
      flush();
      if (section === 'summary') {
        const qText = l.slice(4).trim();
        summary.questions.push(qText);
        cur = { kind: 'answer', question: qText, lines: [] };
      } else if (section === 'entries') cur = { kind: 'entry', lines: [] };
      continue;
    }
    const sm = /^<!-- summary status: (\w+) updated: (\S*) -->$/.exec(l);
    if (sm && summary) {
      summary.status = sm[1];
      summary.updatedAt = sm[2];
      continue;
    }
    const im = /^<!-- id: (\S+) updated: (\S*) -->$/.exec(l);
    if (im && cur?.kind === 'entry') {
      cur.id = im[1];
      cur.updatedAt = im[2];
      continue;
    }
    if (cur?.kind === 'entry' && cur.lines.length === 0 && cur.question === undefined && l.startsWith('問い: ')) {
      cur.question = l.slice(4).trim();
      continue;
    }
    if (cur) cur.lines.push(unescLine(l));
  }
  flush();
  return { entries, summary };
}
