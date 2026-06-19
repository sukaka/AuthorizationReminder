const fs = require('node:fs');
const path = require('node:path');

const db = require('../src/db');


const DEFAULT_CATALOG_PATH = path.resolve(
  __dirname,
  '../catalog/ai-assistant-assistants.json'
);
const DEPARTMENT_NAME = '聚信 AI 助手';
const SEED_ACTOR_NAME = 'AI 助手目录种子';


const expandField = (catalog, rawField) => ({
  ...(rawField.template
    ? catalog.field_templates?.[rawField.template] || {}
    : {}),
  ...Object.fromEntries(
    Object.entries(rawField).filter(([key]) => key !== 'template')
  ),
});


const buildPromptContent = (assistant, task, fields) => {
  const requiredFields = fields.filter((field) => field.required);
  const inputBlock = requiredFields
    .map((field) => `【${field.label || field.field_key}】\n{{${field.field_key}}}`)
    .join('\n\n');
  return [
    '你是北京聚信得仁科技有限公司内部的 AI 工作助手。',
    `助手：${assistant.name}`,
    `任务：${task.name}`,
    `任务目标：${task.description}`,
    '',
    '执行要求：',
    '1. 只依据用户提供的信息完成任务，不编造事实、数据、资质、承诺或结论。',
    '2. 信息不足时明确列出待确认项，不自行补造关键内容。',
    `3. 输出格式遵循：${task.output_format}。`,
    `4. 安全要求：${task.safety_notice}`,
    '5. 使用简体中文，结构清晰，可直接供员工复核和继续编辑。',
    '',
    '输入信息：',
    inputBlock,
  ].join('\n');
};


const buildPromptDefinitions = (catalog) => {
  const definitions = [];
  for (const assistant of catalog.assistants || []) {
    for (const task of assistant.tasks || []) {
      const fields = (task.fields || []).map((field) =>
        expandField(catalog, field)
      );
      definitions.push({
        id: Number(task.prompt_external_id),
        assistantCode: assistant.code,
        assistantName: assistant.name,
        title: task.name,
        summary: task.description,
        content: buildPromptContent(assistant, task, fields),
        tags: ['聚信 AI 助手', assistant.name, task.name],
        status: 'published',
        variables: fields
          .filter((field) => field.required)
          .map((field) => field.field_key),
      });
    }
  }
  return definitions;
};


const samePromptVersion = (row, prompt) =>
  row
  && row.title === prompt.title
  && String(row.summary || '') === String(prompt.summary || '')
  && row.content === prompt.content
  && JSON.stringify(JSON.parse(row.tags_json || '[]')) === JSON.stringify(prompt.tags);


const upsertPrompt = async (
  tx,
  prompt,
  departmentId,
  categoryId,
  { force = false } = {}
) => {
  const existing = await tx.get(
    'SELECT id, current_version_id FROM pc_prompts WHERE id = ?',
    [prompt.id]
  );
  if (!existing) {
    await tx.run(
      `INSERT INTO pc_prompts
        (id, department_id, category_id, title, summary, content, tags_json,
         status, visibility, current_version_id, created_by_name, updated_by_name,
         published_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'published', 'company', NULL, ?, ?, NOW())`,
      [
        prompt.id,
        departmentId,
        categoryId,
        prompt.title,
        prompt.summary,
        prompt.content,
        JSON.stringify(prompt.tags),
        SEED_ACTOR_NAME,
        SEED_ACTOR_NAME,
      ]
    );
    const version = await tx.run(
      `INSERT INTO pc_prompt_versions
        (prompt_id, version_no, title, summary, content, tags_json, change_note,
         created_by_name)
       VALUES (?, 1, ?, ?, ?, ?, ?, ?)`,
      [
        prompt.id,
        prompt.title,
        prompt.summary,
        prompt.content,
        JSON.stringify(prompt.tags),
        'AI 助手初始目录发布',
        SEED_ACTOR_NAME,
      ]
    );
    await tx.run(
      'UPDATE pc_prompts SET current_version_id = ? WHERE id = ?',
      [version.insertId, prompt.id]
    );
    return { created: 1, versionsCreated: 1, updated: 0 };
  }

  const current = existing.current_version_id
    ? await tx.get(
      `SELECT id, title, summary, content, tags_json
         FROM pc_prompt_versions
        WHERE id = ? AND prompt_id = ?`,
      [existing.current_version_id, prompt.id]
    )
    : null;
  if (!force || samePromptVersion(current, prompt)) {
    await tx.run(
      `UPDATE pc_prompts
          SET status = 'published', published_at = COALESCE(published_at, NOW())
        WHERE id = ?`,
      [prompt.id]
    );
    return { created: 0, versionsCreated: 0, updated: 0 };
  }

  const latest = await tx.get(
    'SELECT COALESCE(MAX(version_no), 0) AS version_no FROM pc_prompt_versions WHERE prompt_id = ?',
    [prompt.id]
  );
  const version = await tx.run(
    `INSERT INTO pc_prompt_versions
      (prompt_id, version_no, title, summary, content, tags_json, change_note,
       created_by_name)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      prompt.id,
      Number(latest?.version_no || 0) + 1,
      prompt.title,
      prompt.summary,
      prompt.content,
      JSON.stringify(prompt.tags),
      'AI 助手目录强制更新',
      SEED_ACTOR_NAME,
    ]
  );
  await tx.run(
    `UPDATE pc_prompts
        SET department_id = ?, category_id = ?, title = ?, summary = ?,
            content = ?, tags_json = ?, status = 'published',
            visibility = 'company', current_version_id = ?,
            updated_by_name = ?, published_at = COALESCE(published_at, NOW())
      WHERE id = ?`,
    [
      departmentId,
      categoryId,
      prompt.title,
      prompt.summary,
      prompt.content,
      JSON.stringify(prompt.tags),
      version.insertId,
      SEED_ACTOR_NAME,
      prompt.id,
    ]
  );
  return { created: 0, versionsCreated: 1, updated: 1 };
};


const ensureTaxonomy = async (database, prompts) => {
  let department = await database.get(
    'SELECT id FROM pc_departments WHERE name = ?',
    [DEPARTMENT_NAME]
  );
  if (!department) {
    const inserted = await database.run(
      `INSERT INTO pc_departments
        (name, description, sort_order, is_active)
       VALUES (?, ?, ?, 1)`,
      [DEPARTMENT_NAME, '聚信 AI 助手正式运行 Prompt', 90]
    );
    department = { id: inserted.insertId };
  }
  const categories = {};
  const assistantNames = new Map(
    prompts.map((prompt) => [prompt.assistantCode, prompt.assistantName])
  );
  let sortOrder = 10;
  for (const [code, name] of assistantNames) {
    let category = await database.get(
      'SELECT id FROM pc_categories WHERE department_id = ? AND name = ?',
      [department.id, name]
    );
    if (!category) {
      const inserted = await database.run(
        `INSERT INTO pc_categories
          (department_id, parent_id, level, name, description, sort_order, is_active)
         VALUES (?, NULL, 1, ?, ?, ?, 1)`,
        [department.id, name, `${name}任务 Prompt`, sortOrder]
      );
      category = { id: inserted.insertId };
    }
    categories[code] = category.id;
    sortOrder += 10;
  }
  return { departmentId: department.id, categories };
};


const seedAiAssistantPrompts = async (
  database,
  catalog,
  { force = false } = {}
) => {
  const prompts = buildPromptDefinitions(catalog);
  if (prompts.length !== 88) {
    throw new Error(`AI 助手 Prompt 数量必须是 88，当前为 ${prompts.length}`);
  }
  const { departmentId, categories } = await ensureTaxonomy(database, prompts);
  const report = {
    prompts: prompts.length,
    created: 0,
    versionsCreated: 0,
    updated: 0,
  };
  await database.transaction(async (tx) => {
    for (const prompt of prompts) {
      const result = await upsertPrompt(
        tx,
        prompt,
        departmentId,
        categories[prompt.assistantCode],
        { force }
      );
      report.created += result.created;
      report.versionsCreated += result.versionsCreated;
      report.updated += result.updated;
    }
  });
  return report;
};


const main = async () => {
  const catalogPath =
    process.env.AI_ASSISTANT_CATALOG_PATH || DEFAULT_CATALOG_PATH;
  const catalog = JSON.parse(fs.readFileSync(catalogPath, 'utf8'));
  await db.initDb();
  try {
    const report = await seedAiAssistantPrompts(db, catalog, {
      force: process.argv.includes('--force'),
    });
    process.stdout.write(`${JSON.stringify(report)}\n`);
  } finally {
    await db.closeDb();
  }
};


if (require.main === module) {
  main().catch((error) => {
    console.error(`[ai-assistant-prompt-seed] ${error.message}`);
    process.exitCode = 1;
  });
}


module.exports = {
  buildPromptDefinitions,
  seedAiAssistantPrompts,
  upsertPrompt,
};
