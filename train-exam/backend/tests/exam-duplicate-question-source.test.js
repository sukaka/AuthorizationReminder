const fs = require('node:fs');
const path = require('node:path');

const indexSource = fs.readFileSync(path.join(__dirname, '../src/index.js'), 'utf8');
const dbSource = fs.readFileSync(path.join(__dirname, '../src/db.js'), 'utf8');

describe('exam duplicate question protection source', () => {
  it('rejects duplicate fixed questions at the API boundary and preserves duplicate input', () => {
    expect(indexSource).toMatch(/const parseIdArrayPreservingDuplicates = /);
    expect(indexSource).toMatch(/固定试卷内不能包含重复题目/);
    expect(indexSource).toMatch(/findDuplicateQuestionIds\(fixedQuestionIds\)/);
  });

  it('keeps random selection and session snapshots unique by question id', () => {
    expect(indexSource).toMatch(/selectUniqueQuestionsByRules\(/);
    expect(indexSource).toMatch(/id NOT IN \(/);
    expect(indexSource).toMatch(/dedupeQuestionSnapshots\(Array\.isArray\(snapshots\)/);
  });

  it('saves answers using the session and question pair and enforces the database constraint', () => {
    expect(indexSource).toMatch(/WHERE session_id = \? AND question_id = \?/);
    expect(dbSource).toMatch(/UNIQUE KEY uk_te_exam_answers_session_question \(session_id, question_id\)/);
    expect(dbSource).toMatch(/DELETE duplicate[\s\S]*keeper\.sort_order < duplicate\.sort_order[\s\S]*keeper\.id < duplicate\.id/);
  });
});
