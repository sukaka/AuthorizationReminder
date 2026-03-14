const xlsx = require('xlsx');

const {
  isUserImportExcelFile,
} = require('../server/user-import');

const parseAdminCenterUserImportFile = (file, { maxRecords = 5000 } = {}) => {
  if (!file) {
    throw new Error('请上传Excel文件');
  }
  if (!isUserImportExcelFile(file)) {
    throw new Error('仅支持 Excel 文件（.xlsx/.xls）');
  }
  const workbook = xlsx.read(file.buffer, { type: 'buffer' });
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) return [];
  const sheet = workbook.Sheets[sheetName];
  const rows = xlsx.utils.sheet_to_json(sheet, { defval: '', raw: false });
  if (rows.length > Number(maxRecords || 5000)) {
    throw new Error(`单次导入最多 ${Number(maxRecords || 5000)} 行`);
  }
  return rows;
};

module.exports = {
  parseAdminCenterUserImportFile,
};
