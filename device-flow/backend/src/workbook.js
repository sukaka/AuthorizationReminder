const { Readable } = require('node:stream');
const ExcelJS = require('exceljs');

const normalizeCellValue = (value) => {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return value.toISOString();
  if (typeof value !== 'object') return value;
  if (Array.isArray(value.richText)) return value.richText.map((item) => item.text || '').join('');
  if (value.result !== undefined) return normalizeCellValue(value.result);
  if (value.text !== undefined) return normalizeCellValue(value.text);
  if (value.hyperlink !== undefined) return normalizeCellValue(value.text || value.hyperlink);
  return String(value);
};

const worksheetToRows = (worksheet) => {
  if (!worksheet || worksheet.rowCount < 1) return [];
  const headerValues = worksheet.getRow(1).values;
  const headers = Array.from({ length: Math.max(0, headerValues.length - 1) }, (_item, index) =>
    String(normalizeCellValue(headerValues[index + 1]) || '')
      .replace(/^\uFEFF/, '')
      .trim()
  );
  const rows = [];

  for (let rowNumber = 2; rowNumber <= worksheet.rowCount; rowNumber += 1) {
    const row = worksheet.getRow(rowNumber);
    const output = {};
    let hasValue = false;
    headers.forEach((header, index) => {
      if (!header) return;
      const value = normalizeCellValue(row.getCell(index + 1).value);
      if (String(value ?? '').trim() !== '') hasValue = true;
      output[header] = value ?? '';
    });
    if (hasValue) rows.push(output);
  }
  return rows;
};

const readFirstWorksheetRows = async (fileBuffer) => {
  const buffer = Buffer.isBuffer(fileBuffer) ? fileBuffer : Buffer.from(fileBuffer || '');
  if (buffer.length === 0) throw new Error('Excel 文件解析失败，请检查文件格式');
  const workbook = new ExcelJS.Workbook();

  try {
    if (buffer.subarray(0, 2).toString('binary') === 'PK') {
      await workbook.xlsx.load(buffer);
    } else {
      await workbook.csv.read(Readable.from(buffer));
    }
  } catch (_err) {
    throw new Error('Excel 文件解析失败，请检查文件格式');
  }

  const worksheet = workbook.worksheets[0];
  if (!worksheet) throw new Error('Excel 文件缺少工作表');
  return worksheetToRows(worksheet);
};

const buildWorkbookBuffer = async ({ sheetName, rows }) => {
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet(String(sheetName || 'Sheet1').slice(0, 31));
  const safeRows = Array.isArray(rows) ? rows : [];
  const headers = safeRows.length > 0 ? Object.keys(safeRows[0]) : [];

  if (headers.length > 0) {
    worksheet.columns = headers.map((header) => ({
      header,
      key: header,
      width: Math.max(12, Math.min(40, String(header).length * 2 + 4)),
    }));
    safeRows.forEach((row) => worksheet.addRow(row));
  }

  return Buffer.from(await workbook.xlsx.writeBuffer());
};

module.exports = {
  buildWorkbookBuffer,
  readFirstWorksheetRows,
  worksheetToRows,
};

