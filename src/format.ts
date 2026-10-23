/**
 * 招聘信息字段定义、格式化与单页排版估算
 * —— 与 Flask 版 docx_gen.py / excel_io.py 保持一致的规则
 */

export interface FieldDef {
  key: string;
  label: string;
  required: boolean;
  type: 'text' | 'textarea';
}

export const FIELDS: FieldDef[] = [
  { key: 'company_name', label: '用人单位名称', required: true, type: 'text' },
  { key: 'position', label: '招聘岗位', required: true, type: 'text' },
  { key: 'headcount', label: '招聘数（人）', required: false, type: 'text' },
  { key: 'requirements', label: '岗位要求', required: false, type: 'textarea' },
  { key: 'salary', label: '工资待遇（元）', required: false, type: 'text' },
  { key: 'address', label: '地址', required: false, type: 'text' },
  { key: 'phone', label: '联系电话', required: false, type: 'text' },
];

export const FIELD_NAMES = FIELDS.map((f) => f.key);
export const FIELD_LABELS: Record<string, string> = Object.fromEntries(
  FIELDS.map((f) => [f.key, f.label]),
);
export const HEADERS = FIELDS.map((f) => f.label);

/** 表头别名（宽松匹配，方便用户随意填写） */
export const ALIASES: Record<string, string[]> = {
  company_name: ['用人单位名称', '用人单位', '单位名称', '公司名称', '企业名称', '单位', '公司',
    'company', 'companyname', 'employer'],
  position: ['招聘岗位', '岗位', '岗位名称', '职位', '招聘职位', '招聘工种', '工种', 'position', 'job'],
  headcount: ['招聘数', '招聘人数', '人数', '需求人数', '招聘数量', '计划招聘人数', '名额',
    'headcount', 'number'],
  requirements: ['岗位要求', '要求', '任职要求', '招聘要求', '岗位职责', '职位要求', '条件',
    'requirements', 'requirement'],
  salary: ['工资待遇', '薪资待遇', '薪资', '工资', '待遇', '月薪', '薪酬', 'salary', 'wage', 'pay'],
  address: ['地址', '工作地址', '单位地址', '工作地点', '上班地址', '公司地址', 'address', 'location'],
  phone: ['联系电话', '电话', '联系方式', '手机', '手机号', '联系人电话',
    'phone', 'tel', 'telephone', 'mobile'],
};

// --------------------------------------------------------------------------- //
// 展示格式化
// --------------------------------------------------------------------------- //
export function fmtHeadcount(val: unknown): string {
  if (val === null || val === undefined) return '—';
  const s = String(val).trim();
  if (!s) return '—';
  return /^\d+$/.test(s) ? `${s} 人` : s;
}

export function fmtSalary(val: unknown): string {
  const s = (val === null || val === undefined ? '' : String(val)).trim();
  if (!s) return '面议';
  if (s.includes('元') || s.includes('面议')) return s;
  return `${s} 元/月`;
}

export function cleanFilename(name: string): string {
  const s = String(name).replace(/[\\/:*?"<>|\r\n\t]/g, '_').trim();
  return s.slice(0, 60) || '招聘简章';
}

/** 本地时间（Asia/Shanghai）格式化为 YYYY-MM-DD HH:MM:SS */
export function nowLocal(d: Date = new Date()): string {
  const p = new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  }).formatToParts(d);
  const g = (t: string) => p.find((x) => x.type === t)?.value ?? '00';
  return `${g('year')}-${g('month')}-${g('day')} ${g('hour')}:${g('minute')}:${g('second')}`;
}

export function todayLocal(d: Date = new Date()): { year: number; month: number; day: number } {
  const s = nowLocal(d);
  return {
    year: Number(s.slice(0, 4)),
    month: Number(s.slice(5, 7)),
    day: Number(s.slice(8, 10)),
  };
}

// --------------------------------------------------------------------------- //
// 单页排版估算（与 docx_gen.py 完全一致）
// --------------------------------------------------------------------------- //
export const QR_CAPTION = '扫码关注，获取最新招聘信息';
export const QR_WIDTH_CM = 2.8;
export const QR_BLOCK_H = 112.0;        // 二维码块占用高度（pt）

const USABLE_H = 734.0;                 // A4 版心高度
const SAFE_RATIO = 0.96;
const CALIB = 1.08;
const VALUE_WIDTH_PT = 354.0;           // 值列宽 12.5cm
const LINE_FACTOR = 1.28;               // 精确行距 = 字号 × 1.28
const WIDTH_SLACK = 0.97;
const FONT_CHOICES = [12, 11.5, 11, 10.5, 10, 9.5, 9, 8.5, 8];

function lineCount(text: string, bodyPt: number): number {
  if (!text) return 1;
  const perLine = Math.max(6, Math.floor((VALUE_WIDTH_PT / bodyPt) * WIDTH_SLACK));
  let lines = 0;
  const segs = String(text).split(/\r?\n/);
  for (const raw of segs.length ? segs : ['']) {
    const seg = raw.replace(/\s+$/, '');
    if (!seg) { lines += 1; continue; }
    let width = 0;
    for (const ch of seg) width += ch.codePointAt(0)! > 127 ? 1.0 : 0.6;
    lines += Math.max(1, Math.ceil(width / perLine));
  }
  return Math.max(1, lines);
}

function estimateTotal(bodyPt: number, simple: string[], req: string, hasQr: boolean): number {
  const rowPad = 2 * 2.0 + 2.0;
  const header = 12 + 22 * LINE_FACTOR + 3 + 13.5 * LINE_FACTOR + 2 + 12 + 8;
  let rows = 0;
  for (const t of simple) {
    rows += Math.max(26.0, lineCount(t, bodyPt) * bodyPt * LINE_FACTOR + rowPad);
  }
  rows += lineCount(req, bodyPt) * bodyPt * LINE_FACTOR + rowPad + 4;
  let footer = 10 + bodyPt * LINE_FACTOR * 2.2 + 8 + bodyPt * LINE_FACTOR * 2 + 10 + 12;
  if (hasQr) footer += QR_BLOCK_H;
  return (header + rows + footer) * CALIB;
}

export function chooseFont(simple: string[], req: string, hasQr: boolean): number {
  const limit = USABLE_H * SAFE_RATIO;
  for (const pt of FONT_CHOICES) {
    if (estimateTotal(pt, simple, req, hasQr) <= limit) return pt;
  }
  return FONT_CHOICES[FONT_CHOICES.length - 1];
}

export interface DocInfo {
  id: number;
  company: string;
  position: string;
  headcount: string;
  salary: string;
  address: string;
  phone: string;
  requirements: string;
  reqLines: string[];
  created: string;
  hasQr: boolean;
  bodyPt: number;
  year: number;
  today: { year: number; month: number; day: number };
}

/** 把一条记录整理成排版所需的展示数据（Word / 网页预览共用） */
export function prepare(rec: Record<string, any>, hasQr: boolean): DocInfo {
  const g = (k: string) => (rec?.[k] === null || rec?.[k] === undefined ? '' : String(rec[k]));
  const company = g('company_name').trim() || '用人单位';
  const position = g('position').trim() || '—';
  const headcount = fmtHeadcount(rec?.headcount);
  const salary = fmtSalary(rec?.salary);
  const address = g('address').trim() || '—';
  const phone = g('phone').trim() || '—';
  const requirements = g('requirements').trim() || '详见面谈。';
  const created = g('created_at').trim();

  const bodyPt = chooseFont([position, headcount, salary, address, phone], requirements, hasQr);
  const reqLines = requirements.split(/\r?\n/).map((s) => s.replace(/\s+$/, '')).filter((s) => s.trim());
  const today = todayLocal();
  const year = /^\d{4}-\d{2}-\d{2}/.test(created) ? Number(created.slice(0, 4)) : today.year;

  return {
    id: Number(rec?.id) || 0,
    company, position, headcount, salary, address, phone, requirements,
    reqLines: reqLines.length ? reqLines : [requirements],
    created, hasQr, bodyPt, year, today,
  };
}

export function docFilename(info: DocInfo): string {
  return cleanFilename(`招聘简章_${info.company}_${info.position}`) + '.docx';
}

/** 多条合并成一个 Word 时的文件名，如 招聘简章_选定3份_20261022.docx */
export function multiDocFilename(count: number): string {
  return `招聘简章_选定${count}份_${nowLocal().slice(0, 10).replace(/-/g, '')}.docx`;
}
