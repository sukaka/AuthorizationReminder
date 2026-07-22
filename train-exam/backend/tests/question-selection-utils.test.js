const {
  dedupeQuestionSnapshots,
  findDuplicateQuestionIds,
  selectUniqueQuestionsByRules,
} = require('../src/question-selection-utils');

describe('question selection utils', () => {
  it('selects unique questions when random rule candidate pools overlap and refills', async () => {
    const pools = [
      [{ id: 101 }, { id: 102 }],
      [{ id: 102 }, { id: 103 }, { id: 104 }],
    ];

    const selections = await selectUniqueQuestionsByRules({
      rules: [{ question_count: 2 }, { question_count: 2 }],
      fetchCandidates: async (rule, { excludedIds }) => {
        const pool = pools[rule.question_count === 2 && excludedIds.size > 0 ? 1 : 0] || [];
        return pool.filter((row) => !excludedIds.has(row.id));
      },
      shuffleCandidates: (items) => items,
    });

    expect(selections.map(({ row }) => row.id)).toEqual([101, 102, 103, 104]);
    expect(new Set(selections.map(({ row }) => row.id)).size).toBe(4);
  });

  it('reports duplicate fixed question ids and keeps the first snapshot', () => {
    expect(findDuplicateQuestionIds([554, 555, 554, 554, 556])).toEqual([554]);
    expect(dedupeQuestionSnapshots([
      { question_id: 554, stem: 'first' },
      { question_id: 555, stem: 'second' },
      { question_id: 554, stem: 'duplicate' },
    ])).toEqual([
      { question_id: 554, stem: 'first' },
      { question_id: 555, stem: 'second' },
    ]);
  });

  it('scopes uniqueness to one selection, allowing the same question in another session', () => {
    const firstSession = dedupeQuestionSnapshots([{ question_id: 554 }]);
    const secondSession = dedupeQuestionSnapshots([{ question_id: 554 }]);

    expect(firstSession).toEqual([{ question_id: 554 }]);
    expect(secondSession).toEqual([{ question_id: 554 }]);
  });
});
