import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseBoard, rewriteDate, RewriteError } from '../src/sources/kanban-parse.ts';

const board = `---
kanban-plugin: board
---

## To do

- [ ] Home from her place, 08:45 to 09:45 @{2026-11-09} [[Life task notes]]
- [ ] Dussmann: gift for her, 19:00 @{2026-11-09} [[Life task notes]]
- [ ] With token @{2026-11-10} @@{14:30}
- [ ] Mock exam 1, closed book, 90 min, 17:00 @{2026-11-16} [[LA check-in test and mock exam#Mock exam]]
- [ ] No date here
- [ ] Two dates @{2026-11-01} @{2026-11-02}

## Done

**Complete**
- [x] Assignment 2, submitted (due 6 Nov) @{2026-11-07} [[SE_28#Assignment 2 (done)]]

***

## Archive

- [x] Archived @{2026-01-01}

%% kanban:settings
\`\`\`
{"kanban-plugin":"board"}
\`\`\`
%%
`;

test('reads dated cards, times, done, and stops at the archive', () => {
  const cs = parseBoard(board, 'b.md', true);
  assert.equal(cs.length, 6);
  assert.deepEqual(cs.map((c) => [c.date, c.time, c.mins, c.done, c.column]), [
    ['2026-11-09', '08:45', 60, false, 'To do'],
    ['2026-11-09', '19:00', 0, false, 'To do'],
    ['2026-11-10', '14:30', 0, false, 'To do'],
    ['2026-11-16', '17:00', 90, false, 'To do'],
    ['2026-11-01', '', 0, false, 'To do'],
    ['2026-11-07', '', 0, true, 'Done'],
  ]);
  assert.equal(cs[0].title, 'Home from her place');
  assert.equal(cs[1].title, 'Dussmann: gift for her');
  assert.equal(cs[2].timeFrom, 'token');
  assert.equal(cs[5].title, 'Assignment 2, submitted (due 6 Nov)');
  assert.equal(cs[0].line, 6);
});

test('text times stay off when the setting is off', () => {
  const cs = parseBoard(board, 'b.md', false);
  assert.equal(cs[0].time, '');
  assert.equal(cs[2].time, '14:30');
});

test('rewrite changes only that date on that line', () => {
  const c = parseBoard(board, 'b.md', true)[1];
  const out = rewriteDate(board, c.line, c.raw, c.date, '2026-11-11');
  const a = board.split('\n'), b = out.split('\n');
  assert.equal(a.length, b.length);
  const diff = a.map((l, i) => (l === b[i] ? -1 : i)).filter((i) => i >= 0);
  assert.deepEqual(diff, [c.line]);
  assert.equal(b[c.line], '- [ ] Dussmann: gift for her, 19:00 @{2026-11-11} [[Life task notes]]');
});

test('rewrite finds a card that moved to another line, if it is the only one', () => {
  const c = parseBoard(board, 'b.md', true)[1];
  const shifted = '\n' + board;
  const out = rewriteDate(shifted, c.line, c.raw, c.date, '2026-11-12');
  assert.ok(out.split('\n')[c.line + 1].includes('@{2026-11-12}'));
});

test('rewrite refuses a changed card, a doubled card, two dates, and a stale date', () => {
  const cs = parseBoard(board, 'b.md', true), c = cs[1];
  assert.throws(() => rewriteDate(board.replace(c.raw, c.raw + ' edited'), c.line, c.raw, c.date, '2026-11-12'), RewriteError);
  const doubled = board.replace('- [ ] No date here', c.raw);
  assert.throws(() => rewriteDate(doubled, 99, c.raw, c.date, '2026-11-12'), RewriteError);
  const two = cs[4];
  assert.throws(() => rewriteDate(board, two.line, two.raw, two.date, '2026-11-12'), RewriteError);
  assert.throws(() => rewriteDate(board, c.line, c.raw, '2026-01-01', '2026-11-12'), RewriteError);
});

test('a time taken out of the middle leaves no stray comma', () => {
  const cs = parseBoard('- [ ] LA class: exam prep, 9:00. Ask Protim the open questions @{2026-11-13} [[SE_28#Ask Protim]]\n- [ ] Class: exam prep, Big-O and code snippets, 14:00. Ask about past papers @{2026-11-12}', 'b.md', true);
  assert.equal(cs[0].title, 'LA class: exam prep. Ask Protim the open questions');
  assert.equal(cs[0].time, '09:00');
  assert.equal(cs[1].title, 'Class: exam prep, Big-O and code snippets. Ask about past papers');
});
