const fs = require('node:fs');
const path = require('node:path');

const db = require('../src/db');


const DEFAULT_CATALOG_PATH = path.resolve(
  __dirname,
  '../catalog/ai-assistant-assistants.json'
);
const DEPARTMENT_NAME = '聚信 AI 助手';
const SEED_ACTOR_NAME = 'AI 助手目录种子';


const extractVariables = (content) =>
  [...String(content || '').matchAll(/\{\{\s*([a-zA-Z0-9_\u4e00-\u9fa5-]{1,64})\s*\}\}/g)]
    .map((match) => match[1])
    .filter((value, index, values) => values.indexOf(value) === index);


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


const buildPromptDefinitions = (catalog) =>
  (catalog.assistants || []).flatMap((assistant) =>
    (assistant.tasks || []).map((task) => ({
      id: Number(task.prompt_external_id),
      assistantCode: assistant.code,
      assistantName: assistant.name,
      title: task.name,
      summary: task.description,
      content: String(task.prompt_content || '').trim(),
      tags: ['聚信 AI 助手', assistant.name, task.name, task.source_version]
        .filter(Boolean),
      status: 'published',
      variables: extractVariables(task.prompt_content),
    }))
  );


const validatePromptDefinitions = (prompts) => {
  if (!prompts.length) throw new Error('AI 助手 Prompt 目录不能为空');
  if (new Set(prompts.map((item) => item.id)).size !== prompts.length) {
    throw new Error('AI 助手 Prompt ID 存在重复');
  }
  const emptyPrompt = prompts.find((item) => !item.content);
  if (emptyPrompt) {
    throw new Error(`AI 助手 Prompt 内容不能为空：${emptyPrompt.id}`);
  }
};


const samePromptVersion = (row, prompt) =>
  row
  && row.title === prompt.title
  && String(row.summary || '') === String(prompt.summary || '')
  && row.content === prompt.content
  && JSON.stringify(JSON.parse(row.tags_json || '[]')) === JSON.stringify(prompt.tags);


const publishPromptVersion = async (
  tx,
  prompt,
  departmentId,
  categoryId,
  versionId
) => tx.run(
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
    versionId,
    SEED_ACTOR_NAME,
    prompt.id,
  ]
);


const createPromptVersion = async (tx, prompt, versionNo, changeNote) => tx.run(
  `INSERT INTO pc_prompt_versions
    (prompt_id, version_no, title, summary, content, tags_json, change_note,
     created_by_name)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  [
    prompt.id,
    versionNo,
    prompt.title,
    prompt.summary,
    prompt.content,
    JSON.stringify(prompt.tags),
    changeNote,
    SEED_ACTOR_NAME,
  ]
);


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
  if (current && (!force || samePromptVersion(current, prompt))) {
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
  const matchingVersion = !current
    ? await findLatestMatchingVersion(tx, prompt)
    : null;
  const version = matchingVersion || await createPromptVersion(
    tx,
    prompt,
    Number(latest?.version_no || 0) + 1,
    force ? 'AI 助手目录强制更新' : 'AI 助手目录补齐当前版本'
  );
  await publishPromptVersion(
    tx,
    prompt,
    departmentId,
    categoryId,
    matchingVersion ? matchingVersion.id : version.insertId
  );
  return {
    created: 0,
    versionsCreated: matchingVersion ? 0 : 1,
    updated: 1,
  };
};


const findLatestMatchingVersion = async (tx, prompt) => {
  const latest = await tx.get(
    `SELECT id, version_no, title, summary, content, tags_json
       FROM pc_prompt_versions
      WHERE prompt_id = ?
      ORDER BY version_no DESC
      LIMIT 1`,
    [prompt.id]
  );
  return samePromptVersion(latest, prompt) ? latest : null;
};


const stagePrompt = async (
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
       VALUES (?, ?, ?, ?, ?, ?, ?, 'draft', 'company', NULL, ?, ?, NULL)`,
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
    await tx.run(
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
        'AI 助手目录分阶段预发布',
        SEED_ACTOR_NAME,
      ]
    );
    return {
      created: 1,
      versionsCreated: 1,
      updated: 0,
      stagedVersionNo: 1,
    };
  }

  const current = existing.current_version_id
    ? await tx.get(
      `SELECT id, version_no, title, summary, content, tags_json
         FROM pc_prompt_versions
        WHERE id = ? AND prompt_id = ?`,
      [existing.current_version_id, prompt.id]
    )
    : null;
  if (!force || samePromptVersion(current, prompt)) {
    return {
      created: 0,
      versionsCreated: 0,
      updated: 0,
      stagedVersionNo: Number(current?.version_no || 0),
    };
  }

  const matchingVersion = await findLatestMatchingVersion(tx, prompt);
  if (matchingVersion) {
    return {
      created: 0,
      versionsCreated: 0,
      updated: 0,
      stagedVersionNo: Number(matchingVersion.version_no),
    };
  }

  const latest = await tx.get(
    'SELECT COALESCE(MAX(version_no), 0) AS version_no FROM pc_prompt_versions WHERE prompt_id = ?',
    [prompt.id]
  );
  const versionNo = Number(latest?.version_no || 0) + 1;
  await tx.run(
    `INSERT INTO pc_prompt_versions
      (prompt_id, version_no, title, summary, content, tags_json, change_note,
       created_by_name)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      prompt.id,
      versionNo,
      prompt.title,
      prompt.summary,
      prompt.content,
      JSON.stringify(prompt.tags),
      'AI 助手目录分阶段预发布',
      SEED_ACTOR_NAME,
    ]
  );
  return {
    created: 0,
    versionsCreated: 1,
    updated: 0,
    stagedVersionNo: versionNo,
  };
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
  validatePromptDefinitions(prompts);
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


const stageAiAssistantPrompts = async (
  database,
  catalog,
  { force = false } = {}
) => {
  const prompts = buildPromptDefinitions(catalog);
  validatePromptDefinitions(prompts);
  const { departmentId, categories } = await ensureTaxonomy(database, prompts);
  const report = {
    prompts: prompts.length,
    created: 0,
    versionsCreated: 0,
    updated: 0,
    stagedVersions: {},
  };
  await database.transaction(async (tx) => {
    for (const prompt of prompts) {
      const result = await stagePrompt(
        tx,
        prompt,
        departmentId,
        categories[prompt.assistantCode],
        { force }
      );
      report.created += result.created;
      report.versionsCreated += result.versionsCreated;
      report.updated += result.updated;
      report.stagedVersions[prompt.id] = result.stagedVersionNo;
    }
  });
  return report;
};


const activateStagedPrompts = async (
  database,
  catalog,
  stagedVersions
) => {
  const prompts = buildPromptDefinitions(catalog);
  validatePromptDefinitions(prompts);
  const promptById = new Map(prompts.map((prompt) => [String(prompt.id), prompt]));
  const entries = Object.entries(stagedVersions || {});
  if (!entries.length) throw new Error('AI 助手 Prompt staged version 不能为空');
  const expectedIds = new Set(promptById.keys());
  const stagedIds = new Set(entries.map(([promptId]) => String(promptId)));
  if (
    stagedIds.size !== expectedIds.size
    || [...expectedIds].some((promptId) => !stagedIds.has(promptId))
    || [...stagedIds].some((promptId) => !expectedIds.has(promptId))
  ) {
    throw new Error('AI 助手 Prompt staged version 不完整');
  }
  const { departmentId, categories } = await ensureTaxonomy(database, prompts);
  const report = {
    prompts: entries.length,
    activated: 0,
  };
  await database.transaction(async (tx) => {
    const stagedRows = [];
    for (const [promptId, versionNo] of entries) {
      const prompt = promptById.get(String(promptId));
      if (!prompt) {
        throw new Error(`AI 助手 Prompt staged version 不存在：${promptId}@${versionNo}`);
      }
      const version = await tx.get(
        `SELECT id, prompt_id, version_no, title, summary, content, tags_json
           FROM pc_prompt_versions
          WHERE prompt_id = ? AND version_no = ?
          LIMIT 1`,
        [Number(promptId), Number(versionNo)]
      );
      if (!version) {
        throw new Error(`AI 助手 Prompt staged version 不存在：${promptId}@${versionNo}`);
      }
      if (!samePromptVersion(version, prompt)) {
        throw new Error(
          `AI 助手 Prompt staged version 与当前目录不一致：${promptId}@${versionNo}`
        );
      }
      stagedRows.push({ prompt, version });
    }

    for (const { prompt, version } of stagedRows) {
      await tx.run(
        `UPDATE pc_prompts
            SET department_id = ?, category_id = ?, title = ?, summary = ?,
                content = ?, tags_json = ?, status = 'published',
                visibility = 'company', current_version_id = ?,
                updated_by_name = ?, published_at = COALESCE(published_at, NOW())
          WHERE id = ?`,
        [
          departmentId,
          categories[prompt.assistantCode],
          version.title,
          version.summary,
          version.content,
          version.tags_json,
          version.id,
          SEED_ACTOR_NAME,
          prompt.id,
        ]
      );
      report.activated += 1;
    }
  });
  return report;
};


const parseCliOptions = (argv = process.argv.slice(2)) => {
  const options = {
    force: false,
    stageOutput: null,
    activatePath: null,
  };
  const readValue = (flag, index) => {
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) {
      throw new Error(`${flag} 需要提供路径`);
    }
    return value;
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--force') {
      options.force = true;
    } else if (arg === '--stage-output') {
      options.stageOutput = readValue(arg, index);
      index += 1;
    } else if (arg === '--activate') {
      options.activatePath = readValue(arg, index);
      index += 1;
    }
  }
  if (options.stageOutput && options.activatePath) {
    throw new Error('--stage-output 与 --activate 不能同时使用');
  }
  return options;
};


const main = async () => {
  const catalogPath =
    process.env.AI_ASSISTANT_CATALOG_PATH || DEFAULT_CATALOG_PATH;
  const catalog = JSON.parse(fs.readFileSync(catalogPath, 'utf8'));
  const options = parseCliOptions();
  await db.initDb();
  try {
    let report;
    if (options.activatePath) {
      const stagedVersions = JSON.parse(fs.readFileSync(options.activatePath, 'utf8'));
      report = await activateStagedPrompts(db, catalog, stagedVersions);
    } else if (options.stageOutput) {
      report = await stageAiAssistantPrompts(db, catalog, {
        force: options.force,
      });
      fs.mkdirSync(path.dirname(options.stageOutput), { recursive: true });
      fs.writeFileSync(
        options.stageOutput,
        `${JSON.stringify(report.stagedVersions, null, 2)}\n`
      );
    } else {
      report = await seedAiAssistantPrompts(db, catalog, {
        force: options.force,
      });
    }
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
  extractVariables,
  seedAiAssistantPrompts,
  stageAiAssistantPrompts,
  activateStagedPrompts,
  upsertPrompt,
  parseCliOptions,
};
