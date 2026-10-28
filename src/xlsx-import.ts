/**
 * Excel / CSV 导入解析
 * 支持 .xlsx / .xlsm / .csv，表头名称容错（别名映射），逐行校验并返回行号错误
 */
import { unzipSync, strFromU8 } from 'fflate';
import { ALIASES, FIELD_LABELS, FIELD_NAMES, toIsoDate, todayIso } from './format';

export interface ParseResult {
  valid: Record<string, string>[];
  errors: string[];
  skipped: number;
}

function decodeXml(s: string): string {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&amp;/g, '&');
}

function colIndex(ref: string): number {
  const m = /^([A-Z]+)/.exec(ref || '');
  if (!m) return 0;
  let n = 0;
  for (const ch of m[1]) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

function stripTags(xml: string): string {
  return decodeXml(xml.replace(/<[^>]*>/g, ''));
}

/** 解析 sharedStrings.xml -> 字符串数组 */
function parseSharedStrings(xml: string): string[] {
  const out: string[] = [];
  const siRe = /<si\b[^>]*>([\s\S]*?)<\/si>/g;
  let m: RegExpExecArray | null;
  while ((m = siRe.exec(xml))) {
    const inner = m[1];
    // 富文本会有多个 <r><t>，全部拼起来；忽略 <rPh> 注音
    const cleaned = inner.replace(/<rPh\b[\s\S]*?<\/rPh>/g, '');
    const ts = [...cleaned.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map((x) => decodeXml(x[1]));
    out.push(ts.join(''));
  }
  return out;
}

/** 解析一个 worksheet -> 二维数组 */
function parseSheet(xml: string, shared: string[]): string[][] {
  const rows: string[][] = [];
  const rowRe = /<row\b([^>]*)\/?>([\s\S]*?)<\/row>|<row\b([^>]*)\/>/g;
  let rm: RegExpExecArray | null;
  while ((rm = rowRe.exec(xml))) {
    const attrs = rm[1] || rm[3] || '';
    const inner = rm[2] || '';
    const rAttr = /\br="(\d+)"/.exec(attrs);
    const rowIdx = rAttr ? Number(rAttr[1]) - 1 : rows.length;

    const cells: string[] = [];
    const cellRe = /<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g;
    let cm: RegExpExecArray | null;
    while ((cm = cellRe.exec(inner))) {
      const cAttrs = cm[1] || '';
      const cInner = cm[2] || '';
      const refM = /\br="([A-Z]+\d+)"/.exec(cAttrs);
      const idx = refM ? colIndex(refM[1]) : cells.length;
      const typeM = /\bt="([^"]+)"/.exec(cAttrs);
      const type = typeM ? typeM[1] : '';

      let value = '';
      if (type === 'inlineStr') {
        const ts = [...cInner.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map((x) => decodeXml(x[1]));
        value = ts.join('');
      } else {
        const vM = /<v\b[^>]*>([\s\S]*?)<\/v>/.exec(cInner);
        const raw = vM ? decodeXml(vM[1]) : '';
        if (type === 's') {
          value = shared[Number(raw)] ?? '';
        } else if (type === 'b') {
          value = raw === '1' ? 'TRUE' : 'FALSE';
        } else {
          value = raw;
        }
      }
      // 整数化的浮点去掉 .0（6.0 -> 6）
      if (/^-?\d+\.0+$/.test(value)) value = value.replace(/\.0+$/, '');
      while (cells.length < idx) cells.push('');
      cells[idx] = value;
    }
    while (rows.length < rowIdx) rows.push([]);
    rows[rowIdx] = cells;
  }
  return rows;
}

/** 解析 .xlsx / .xlsm 字节 -> 二维数组（取第一个工作表） */
export function readXlsx(bytes: Uint8Array): string[][] {
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(bytes);
  } catch {
    throw new Error('无法读取该文件，可能不是有效的 Excel 文件或已损坏');
  }
  const get = (p: string) => (files[p] ? strFromU8(files[p]) : null);

  const sharedXml = get('xl/sharedStrings.xml');
  const shared = sharedXml ? parseSharedStrings(sharedXml) : [];

  // 找到第一个工作表
  let sheetPath: string | null = null;
  const wb = get('xl/workbook.xml');
  const rels = get('xl/_rels/workbook.xml.rels');
  if (wb && rels) {
    const first = /<sheet\b[^>]*r:id="([^"]+)"/.exec(wb);
    if (first) {
      const rid = first[1];
      const relRe = new RegExp(`<Relationship\\b[^>]*Id="${rid}"[^>]*Target="([^"]+)"`, 'i');
      const relM = relRe.exec(rels);
      if (relM) {
        const target = relM[1].replace(/^\/?xl\//, '').replace(/^\//, '');
        if (files[`xl/${target}`]) sheetPath = `xl/${target}`;
      }
    }
  }
  if (!sheetPath) {
    sheetPath = Object.keys(files)
      .filter((k) => /^xl\/worksheets\/sheet\d+\.xml$/.test(k))
      .sort()[0] ?? null;
  }
  if (!sheetPath) throw new Error('文件里没有找到工作表');
  return parseSheet(strFromU8(files[sheetPath]), shared);
}

/** 解析 CSV（RFC4180，支持引号、逗号、换行） */
export function readCsv(bytes: Uint8Array): string[][] {
  let text: string | null = null;
  try {
    text = new TextDecoder('utf-8', { fatal: false }).decode(bytes).replace(/^\uFEFF/, '');
  } catch {
    text = null;
  }
  // 明显是乱码（UTF-8 解码出大量替换符）时尝试 GBK
  if (text === null || (text.match(/\uFFFD/g) || []).length > 3) {
    try {
      text = new TextDecoder('gbk').decode(bytes).replace(/^\uFEFF/, '');
    } catch {
      if (text === null) throw new Error('CSV 编码无法识别，请另存为 UTF-8 或改用 .xlsx');
    }
  }

  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else { inQuotes = false; }
      } else {
        field += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ',') {
      row.push(field); field = '';
    } else if (c === '\r') {
      if (text[i + 1] === '\n') i++;
      row.push(field); field = ''; rows.push(row); row = [];
    } else if (c === '\n') {
      row.push(field); field = ''; rows.push(row); row = [];
    } else {
      field += c;
    }
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows;
}

// --------------------------------------------------------------------------- //
// 表头映射
// --------------------------------------------------------------------------- //
function norm(s: unknown): string {
  if (s === null || s === undefined) return '';
  let t = String(s).trim();
  t = t.replace(/（/g, '(').replace(/）/g, ')').replace(/：/g, ':').replace(/\s+/g, '');
  t = t.replace(/\(.*?\)/g, '');
  return t.toLowerCase();
}

const ALIAS_NORM: Record<string, string[]> = Object.fromEntries(
  Object.entries(ALIASES).map(([k, list]) => [k, list.map(norm)]),
);

function headerMap(rowValues: string[]): Record<string, number> {
  const mapping: Record<string, number> = {};
  rowValues.forEach((val, idx) => {
    const key = norm(val);
    if (!key) return;
    for (const [field, names] of Object.entries(ALIAS_NORM)) {
      if (field in mapping) continue;
      if (names.includes(key)) { mapping[field] = idx; break; }
    }
  });
  return mapping;
}

/** 解析上传文件 -> 有效记录 / 错误 / 跳过行数 */
export function parseImport(filename: string, bytes: Uint8Array): ParseResult {
  const name = (filename || '').toLowerCase();
  if (name.endsWith('.xls')) {
    throw new Error('不支持旧版 .xls 格式，请用 Excel 另存为 .xlsx 后再导入');
  }
  let rows: string[][];
  if (name.endsWith('.csv')) rows = readCsv(bytes);
  else if (name.endsWith('.xlsx') || name.endsWith('.xlsm')) rows = readXlsx(bytes);
  else throw new Error('只支持 .xlsx / .xlsm / .csv 文件');

  if (!rows.length) throw new Error('文件内容为空');

  let headerIdx = -1;
  let mapping: Record<string, number> = {};
  for (let i = 0; i < Math.min(10, rows.length); i++) {
    const m = headerMap(rows[i] || []);
    if ('company_name' in m || 'position' in m) { headerIdx = i; mapping = m; break; }
  }
  if (headerIdx < 0) {
    throw new Error('未识别到表头，请确保表格包含「用人单位名称」「招聘岗位」等列');
  }
  const missing = ['company_name', 'position'].filter((f) => !(f in mapping));
  if (missing.length) {
    throw new Error('缺少必需列：' + missing.map((f) => FIELD_LABELS[f]).join('、'));
  }

  const valid: Record<string, string>[] = [];
  const errors: string[] = [];
  let skipped = 0;

  for (let i = headerIdx + 1; i < rows.length; i++) {
    const row = rows[i] || [];
    const offset = i + 1;   // 与 Excel 行号一致
    if (row.every((c) => c === undefined || c === null || String(c).trim() === '')) {
      skipped++;
      continue;
    }
    const item: Record<string, string> = {};
    for (const field of FIELD_NAMES) {
      const idx = mapping[field];
      item[field] = idx !== undefined && row[idx] !== undefined && row[idx] !== null
        ? String(row[idx]).trim() : '';
    }
    if (!item.company_name || !item.position) {
      errors.push(`第 ${offset} 行：用人单位名称或招聘岗位为空，已跳过`);
      continue;
    }
    if (item.publish_date) {
      const fixed = toIsoDate(item.publish_date);
      if (!fixed) {
        errors.push(`第 ${offset} 行：发布日期「${item.publish_date}」无法识别（示例：2026-10-28），已跳过`);
        continue;
      }
      item.publish_date = fixed;
    } else {
      item.publish_date = todayIso();
    }
    valid.push(item);
  }

  return { valid, errors, skipped };
}
