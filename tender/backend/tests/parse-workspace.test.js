import { describe, expect, it } from 'vitest';
import PizZip from 'pizzip';

import {
  normalizeParseFileRole,
  classifyParseArchiveEntries,
  resolveSelectedSheetNames,
  mergeParsedProjectFields,
  extractArchiveDocumentsFromBuffer,
  extractSpreadsheetWorkbookFromBuffer,
  buildParseClauses,
} from '../src/parse-workspace.js';

const buildWorkbookBuffer = () => {
  const zip = new PizZip();
  zip.file(
    'xl/workbook.xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
    <workbook xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
      <sheets>
        <sheet name="评分表" sheetId="1" r:id="rId1"/>
        <sheet name="技术参数" sheetId="2" r:id="rId2"/>
      </sheets>
    </workbook>`
  );
  zip.file(
    'xl/_rels/workbook.xml.rels',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
    <Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
      <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
      <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/>
    </Relationships>`
  );
  zip.file(
    'xl/sharedStrings.xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
    <sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="6" uniqueCount="6">
      <si><t>项目</t></si>
      <si><t>分值</t></si>
      <si><t>资质</t></si>
      <si><t>5</t></si>
      <si><t>参数</t></si>
      <si><t>要求</t></si>
    </sst>`
  );
  zip.file(
    'xl/worksheets/sheet1.xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
    <worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
      <sheetData>
        <row r="1">
          <c r="A1" t="s"><v>0</v></c>
          <c r="B1" t="s"><v>1</v></c>
        </row>
        <row r="2">
          <c r="A2" t="s"><v>2</v></c>
          <c r="B2"><v>5</v></c>
        </row>
      </sheetData>
    </worksheet>`
  );
  zip.file(
    'xl/worksheets/sheet2.xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
    <worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
      <sheetData>
        <row r="1">
          <c r="A1" t="s"><v>4</v></c>
          <c r="B1" t="s"><v>5</v></c>
        </row>
        <row r="2">
          <c r="A2" t="inlineStr"><is><t>CPU</t></is></c>
          <c r="B2" t="inlineStr"><is><t>8核</t></is></c>
        </row>
      </sheetData>
    </worksheet>`
  );
  return zip.generate({ type: 'nodebuffer' });
};

describe('parse workspace helpers', () => {
  it('normalizes parse file roles into supported constants', () => {
    expect(normalizeParseFileRole('main')).toBe('MAIN');
    expect(normalizeParseFileRole('clarification')).toBe('CLARIFICATION');
    expect(normalizeParseFileRole('attachment')).toBe('ATTACHMENT');
    expect(normalizeParseFileRole('unknown')).toBe('SUPPLEMENT');
  });

  it('classifies zip descendants into extractable and skipped files', () => {
    const result = classifyParseArchiveEntries([
      { entryName: '招标文件.docx', dir: false },
      { entryName: '澄清/补遗说明.pdf', dir: false },
      { entryName: '附件/参数表.xlsx', dir: false },
      { entryName: '附件/嵌套包.zip', dir: false },
      { entryName: '附件/说明.txt', dir: false },
      { entryName: '__MACOSX/', dir: true },
    ]);

    expect(result.extractable.map((item) => item.entryName)).toEqual([
      '招标文件.docx',
      '澄清/补遗说明.pdf',
      '附件/参数表.xlsx',
      '附件/嵌套包.zip',
    ]);
    expect(result.skipped.map((item) => item.entryName)).toEqual([
      '附件/说明.txt',
      '__MACOSX/',
    ]);
  });

  it('filters excel sheets by user selection and preserves manifest order', () => {
    const selected = resolveSelectedSheetNames(
      [
        { name: '封面' },
        { name: '评分表' },
        { name: '技术参数' },
        { name: '资格审查' },
      ],
      ['技术参数', '不存在', '评分表']
    );

    expect(selected).toEqual(['评分表', '技术参数']);
  });

  it('merges parsed project fields with clarification override and attachment supplement', () => {
    const merged = mergeParsedProjectFields([
      {
        file_role: 'MAIN',
        fields: {
          project_name: '政务云平台项目',
          bid_deadline: '2026-03-30 09:30',
          buyer_name: '主招标人',
        },
      },
      {
        file_role: 'ATTACHMENT',
        fields: {
          project_budget: '1200万元',
          buyer_name: '附件里的招标人',
        },
      },
      {
        file_role: 'CLARIFICATION',
        fields: {
          bid_deadline: '2026-04-02 09:30',
          buyer_name: '澄清后的招标人',
          project_budget: '',
        },
      },
    ]);

    expect(merged.values).toEqual({
      project_name: '政务云平台项目',
      bid_deadline: '2026-04-02 09:30',
      buyer_name: '澄清后的招标人',
      project_budget: '1200万元',
    });
    expect(merged.sources).toEqual({
      project_name: 'MAIN',
      bid_deadline: 'CLARIFICATION',
      buyer_name: 'CLARIFICATION',
      project_budget: 'ATTACHMENT',
    });
  });

  it('extracts nested zip descendants recursively and skips unsupported files', async () => {
    const inner = new PizZip();
    inner.file('深层/参数表.xlsx', buildWorkbookBuffer());
    inner.file('深层/notes.txt', 'skip me');

    const outer = new PizZip();
    outer.file('招标文件.docx', 'docx-bytes');
    outer.file('附件/补充.zip', inner.generate({ type: 'nodebuffer' }));
    outer.file('附件/readme.md', '# skip');

    const result = await extractArchiveDocumentsFromBuffer(outer.generate({ type: 'nodebuffer' }), {
      sourceName: '总包.zip',
    });

    expect(result.files.map((item) => item.entryName)).toEqual([
      '招标文件.docx',
      '附件/补充.zip/深层/参数表.xlsx',
    ]);
    expect(result.skipped.map((item) => item.entryName)).toContain('附件/readme.md');
    expect(result.skipped.map((item) => item.entryName)).toContain('附件/补充.zip/深层/notes.txt');
  });

  it('reads workbook sheets and only keeps selected sheet payloads', async () => {
    const workbook = await extractSpreadsheetWorkbookFromBuffer(buildWorkbookBuffer(), {
      sourceName: '参数表.xlsx',
      selectedSheetNames: ['技术参数'],
    });

    expect(workbook.sheet_manifest.map((item) => item.name)).toEqual(['评分表', '技术参数']);
    expect(workbook.selected_sheet_names).toEqual(['技术参数']);
    expect(workbook.sheets).toHaveLength(1);
    expect(workbook.sheets[0].name).toBe('技术参数');
    expect(workbook.sheets[0].rows).toEqual([
      ['参数', '要求'],
      ['CPU', '8核'],
    ]);
  });

  it('classifies clause subtypes for original copy demo prototype and authorization variants', () => {
    const clauses = buildParseClauses({
      text: [
        '须提供营业执照原件核验。',
        '提供资质证书复印件并加盖公章。',
        '投标人须现场演示核心功能。',
        '投标人须提供样机进行测试。',
        '须提供原厂授权书。',
        '须提供代理商授权函。',
      ].join('\n'),
      tables: [],
      fileRole: 'MAIN',
    });

    expect(clauses.find((item) => item.clause_text.includes('营业执照原件'))?.clause_subtype).toBe('ORIGINAL_REQUIRED');
    expect(clauses.find((item) => item.clause_text.includes('复印件'))?.clause_subtype).toBe('COPY_REQUIRED');
    expect(clauses.find((item) => item.clause_text.includes('现场演示'))?.clause_subtype).toBe('DEMO_REQUIRED');
    expect(clauses.find((item) => item.clause_text.includes('样机'))?.clause_subtype).toBe('PROTOTYPE_REQUIRED');
    expect(clauses.find((item) => item.clause_text.includes('原厂授权'))?.clause_subtype).toBe('MANUFACTURER_AUTHORIZATION');
    expect(clauses.find((item) => item.clause_text.includes('代理商授权'))?.clause_subtype).toBe('DISTRIBUTOR_AUTHORIZATION');
  });
});
