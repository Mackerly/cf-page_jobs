/**
 * Excel 导出与导入模板生成（纯 OOXML，不依赖 SheetJS / openpyxl）
 */
import { zipSync, strToU8 } from 'fflate';
import { HEADERS } from './format';

const XML_HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';

function esc(s: unknown): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function colLetter(n: number): string {
  let s = '';
  while (n > 0) {
    const m = (n - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

type Cell = { v: string | number; s: number; num?: boolean };

function cellXml(ref: string, c: Cell): string {
  if (typeof c.v === 'number') {
    return `<c r="${ref}" s="${c.s}"><v>${c.v}</v></c>`;
  }
  const t = String(c.v ?? '');
  if (t === '') return `<c r="${ref}" s="${c.s}"/>`;
  return `<c r="${ref}" s="${c.s}" t="inlineStr"><is><t xml:space="preserve">${esc(t)}</t></is></c>`;
}

interface SheetOpts {
  name: string;
  cols: number[];
  rows: Cell[][];
  rowHeights?: Record<number, number>;
  freeze?: string | null;
  autoFilterLastRow?: number;
}

function sheetXml(o: SheetOpts): string {
  const lastCol = colLetter(o.cols.length);
  const lastRow = o.rows.length;
  const cols = o.cols
    .map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`)
    .join('');

  const rows = o.rows.map((cells, ri) => {
    const r = ri + 1;
    const h = o.rowHeights?.[r];
    const attr = h ? ` ht="${h}" customHeight="1"` : '';
    const body = cells.map((c, ci) => cellXml(`${colLetter(ci + 1)}${r}`, c)).join('');
    return `<row r="${r}"${attr}>${body}</row>`;
  }).join('');

  const view = o.freeze
    ? `<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="${o.freeze}" activePane="bottomLeft" state="frozen"/>`
      + `<selection pane="bottomLeft" activeCell="${o.freeze}" sqref="${o.freeze}"/></sheetView></sheetViews>`
    : '<sheetViews><sheetView workbookViewId="0"/></sheetViews>';

  const filter = o.autoFilterLastRow
    ? `<autoFilter ref="A1:${lastCol}${o.autoFilterLastRow}"/>`
    : '';

  return `${XML_HEAD}
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<dimension ref="A1:${lastCol}${Math.max(lastRow, 1)}"/>
${view}
<sheetFormatPr defaultRowHeight="15"/>
<cols>${cols}</cols>
<sheetData>${rows}</sheetData>
${filter}
<pageMargins left="0.7" right="0.7" top="0.75" bottom="0.75" header="0.3" footer="0.3"/>
</worksheet>`;
}

const STYLES = `${XML_HEAD}
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<fonts count="3">
<font><sz val="10"/><color theme="1"/><name val="微软雅黑"/><family val="2"/></font>
<font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="微软雅黑"/><family val="2"/></font>
<font><sz val="10"/><color rgb="FF808080"/><name val="微软雅黑"/><family val="2"/></font>
</fonts>
<fills count="3">
<fill><patternFill patternType="none"/></fill>
<fill><patternFill patternType="gray125"/></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FF2F5597"/><bgColor indexed="64"/></patternFill></fill>
</fills>
<borders count="2">
<border><left/><right/><top/><bottom/><diagonal/></border>
<border>
<left style="thin"><color rgb="FFB7B7B7"/></left>
<right style="thin"><color rgb="FFB7B7B7"/></right>
<top style="thin"><color rgb="FFB7B7B7"/></top>
<bottom style="thin"><color rgb="FFB7B7B7"/></bottom>
<diagonal/>
</border>
</borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="6">
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>
<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyFont="1" applyBorder="1" applyAlignment="1"><alignment horizontal="left" vertical="center" wrapText="1"/></xf>
<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyFont="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
<xf numFmtId="0" fontId="2" fillId="0" borderId="1" xfId="0" applyFont="1" applyBorder="1" applyAlignment="1"><alignment horizontal="left" vertical="center" wrapText="1"/></xf>
<xf numFmtId="0" fontId="2" fillId="0" borderId="1" xfId="0" applyFont="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>
</cellXfs>
<cellStyles count="1"><cellStyle name="常规" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;

function pack(sheets: SheetOpts[]): Uint8Array {
  const ctOverrides = sheets
    .map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`)
    .join('');

  const contentTypes = `${XML_HEAD}
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
${ctOverrides}
<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
</Types>`;

  const rootRels = `${XML_HEAD}
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>
</Relationships>`;

  const wbSheets = sheets
    .map((s, i) => `<sheet name="${esc(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`)
    .join('');
  const workbook = `${XML_HEAD}
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"
 xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheets>${wbSheets}</sheets>
</workbook>`;

  const wbRels = `${XML_HEAD}
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
${sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}
<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`;

  const core = `${XML_HEAD}
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties"
 xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/"
 xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
<dc:title>招聘信息</dc:title><dc:creator>招聘信息管理系统</dc:creator>
</cp:coreProperties>`;

  const files: Record<string, Uint8Array> = {
    '[Content_Types].xml': strToU8(contentTypes),
    '_rels/.rels': strToU8(rootRels),
    'xl/workbook.xml': strToU8(workbook),
    'xl/_rels/workbook.xml.rels': strToU8(wbRels),
    'xl/styles.xml': strToU8(STYLES),
    'docProps/core.xml': strToU8(core),
  };
  sheets.forEach((s, i) => {
    files[`xl/worksheets/sheet${i + 1}.xml`] = strToU8(sheetXml(s));
  });
  return zipSync(files, { level: 6, mtime: new Date() });
}

/** 导出全部招聘信息 */
export function exportXlsx(rows: Record<string, any>[]): Uint8Array {
  const header: Cell[] = ['序号', ...HEADERS, '录入时间'].map((t) => ({ v: t, s: 1 }));
  const body: Cell[][] = rows.map((r, i) => {
    const wrapStyle = [2, 3, 5, 7].includes(1); // 占位，下面按列判断
    const cells: Cell[] = [{ v: i + 1, s: 3 }];
    const values = [
      r.company_name, r.position, r.headcount, r.requirements,
      r.salary, r.address, r.phone, r.created_at,
    ];
    values.forEach((v, ci) => {
      // 第 2/3/5/7 列（公司、岗位、要求、地址）左对齐换行，其余居中
      const leftAlign = [0, 1, 3, 5].includes(ci);
      cells.push({ v: v === null || v === undefined ? '' : String(v), s: leftAlign ? 2 : 3 });
    });
    void wrapStyle;
    return cells;
  });

  return pack([{
    name: '招聘信息',
    cols: [6, 26, 18, 12, 46, 16, 30, 16, 20],
    rows: [header, ...body],
    rowHeights: Object.fromEntries([
      [1, 26],
      ...body.map((_, i) => [i + 2, 34]),
    ]),
    freeze: 'A2',
    autoFilterLastRow: rows.length + 1,
  }]);
}

/** 导入模板：表头 + 示例行 + 填写说明 */
export function buildTemplate(): Uint8Array {
  const header: Cell[] = HEADERS.map((t) => ({ v: t, s: 1 }));
  const sample: Cell[] = [
    '示例：星辰精密机械有限公司', '数控车床操作工', '6',
    '1. 年龄 20-45 周岁，身体健康；\n2. 有相关经验者优先。',
    '6000-9000', '经济技术开发区兴业路 88 号', '0571-88886666',
  ].map((v, i) => ({ v, s: [0, 1, 3, 5].includes(i) ? 4 : 5 }));

  const tips = [
    '填写说明',
    '1. 第 1 行为表头，请勿修改或删除；从第 2 行开始逐条填写招聘信息。',
    '2. 「用人单位名称」「招聘岗位」为必填项，其余可留空。',
    '3. 「招聘数（人）」建议只填数字，如 6；也可填「若干」。',
    '4. 「岗位要求」可在一格内换行填写多条要求（Alt+Enter 换行）。',
    '5. 模板中的示例行请删除后再填写，或直接覆盖。',
    '6. 支持 .xlsx / .xlsm / .csv 格式；.xls 请先另存为 .xlsx。',
    '7. 表头名称容错：如「公司名称」「岗位」「薪资」「电话」等常见写法均可识别。',
  ].map((t, i) => [{ v: t, s: i === 0 ? 3 : 2 }]);

  return pack([
    {
      name: '招聘信息',
      cols: [28, 18, 12, 46, 16, 32, 16],
      rows: [header, sample],
      rowHeights: { 1: 26, 2: 52 },
      freeze: 'A2',
    },
    {
      name: '填写说明',
      cols: [90],
      rows: tips,
    },
  ]);
}
