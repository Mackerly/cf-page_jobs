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
  { key: 'publish_date', label: '发布日期', required: false, type: 'text' },
  { key: 'status', label: '招聘状态', required: false, type: 'text' },
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
  publish_date: ['发布日期', '发布时间', '发布日', '日期',
    'publishdate', 'publish_date', 'date'],
  status: ['招聘状态', '状态', '招聘情况', '是否招满', '有效期状态', 'status'],
};

// --------------------------------------------------------------------------- //
// 招聘状态：招聘中 / 已招满 / 已失效
// 存库值只有 active|full|expired；「发布满 1 个月自动失效」是展示时算出来的，
// 不改库（否则过期后又续发就得批量改数据）。手动选了「已招满 / 已失效」则以手动为准。
// --------------------------------------------------------------------------- //
export type StatusKey = 'active' | 'full' | 'expired';

export const STATUS_OPTIONS: { key: StatusKey; label: string }[] = [
  { key: 'active', label: '招聘中' },
  { key: 'full', label: '已招满' },
  { key: 'expired', label: '已失效' },
];

export const STATUS_LABELS: Record<string, string> = {
  active: '招聘中',
  full: '已招满',
  expired: '已失效',
};

/** 发布后多少个月自动失效 */
export const EXPIRE_MONTHS = 1;

/** 各种写法的状态 -> 标准值；认不出的一律当「招聘中」 */
export function normStatus(raw: unknown): StatusKey {
  const s = String(raw ?? '').trim().toLowerCase();
  if (!s) return 'active';
  if (['full', '已招满', '招满', '已满', '满员', '名额已满'].includes(s)) return 'full';
  if (['expired', '已失效', '失效', '过期', '已过期', '作废', '结束', '已结束', '停招'].includes(s)) {
    return 'expired';
  }
  if (['active', '招聘中', '在招', '有效', '正常', '进行中'].includes(s)) return 'active';
  return 'active';
}

/**
 * 发布日期 + N 个月 -> YYYY-MM-DD。
 * 月末溢出按 SQLite `date(x,'+1 month')` 的规则进位（1-31 + 1 个月 = 3-03），
 * 保证 JS 与 SQL 的判定完全一致。无法解析返回空串。
 */
export function addMonths(iso: string, months = EXPIRE_MONTHS): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso ?? '').trim());
  if (!m) return '';
  const dt = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1 + months, Number(m[3])));
  if (Number.isNaN(dt.getTime())) return '';
  return dt.toISOString().slice(0, 10);
}

/** 有效期最后一天（含当天仍算有效） */
export function expireDate(iso: string): string {
  return addMonths(iso, EXPIRE_MONTHS);
}

/** 是否已过有效期：today > 发布日 + 1 个月 */
export function isExpired(publishDate: string, today: string): boolean {
  const exp = expireDate(publishDate);
  return !!exp && exp < today;
}

/** 实际状态：手动「已招满 / 已失效」优先，否则发布满 1 个月自动失效 */
export function effStatus(rec: Record<string, any> | null | undefined, today: string): StatusKey {
  const s = normStatus(rec?.status);
  if (s !== 'active') return s;
  return isExpired(String(rec?.publish_date ?? ''), today) ? 'expired' : 'active';
}

/** 状态标签 */
export function statusLabel(key: string): string {
  return STATUS_LABELS[key] || '招聘中';
}


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

/** 当天日期 YYYY-MM-DD（Asia/Shanghai），发布日期默认值 */
export function todayIso(d: Date = new Date()): string {
  const t = todayLocal(d);
  return `${t.year}-${String(t.month).padStart(2, '0')}-${String(t.day).padStart(2, '0')}`;
}

/**
 * 各种写法的日期 -> YYYY-MM-DD；无法识别返回空串。
 * 兼容 2026/10/28、2026年10月28日、20261028，以及 Excel 日期序列号（如 46320）。
 */
export function toIsoDate(raw: unknown): string {
  if (raw === null || raw === undefined) return '';
  let s = String(raw).trim();
  if (!s) return '';
  if (/^\d{4,5}(\.\d+)?$/.test(s)) {
    const serial = Number(s);
    if (serial > 20000 && serial < 80000) {
      const dt = new Date(Date.UTC(1899, 11, 30) + Math.round(serial) * 86400000);
      s = dt.toISOString().slice(0, 10);
    }
  }
  const m = /^(\d{4})[-/.年](\d{1,2})[-/.月](\d{1,2})/.exec(s);
  if (!m) return '';
  const y = Number(m[1]); const mo = Number(m[2]); const d = Number(m[3]);
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return '';
  return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
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

export interface DateParts { year: number; month: number; day: number }

/** 'YYYY-MM-DD' / 'YYYY-MM-DD 09:12:00' → { year, month, day }；认不出返回 null */
export function parseDateParts(raw: string): DateParts | null {
  const s = String(raw ?? '').trim();
  if (!/^\d{4}-\d{2}-\d{2}/.test(s)) return null;
  const year = Number(s.slice(0, 4));
  const month = Number(s.slice(5, 7));
  const day = Number(s.slice(8, 10));
  if (!year || month < 1 || month > 12 || day < 1 || day > 31) return null;
  return { year, month, day };
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
  /** 落款「发布日期」用的日期：记录自己的 publish_date，不是生成当天 */
  publish: DateParts;
}

/** 把一条记录整理成排版所需的展示数据（Word / 打印版 / 网页预览 / 微信共用） */
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
  // 落款日期取记录自己的发布日期：补录 / 补打旧简章时，纸上必须是当初的发布日期。
  // 没有发布日期才退回录入时间，再退回今天。编号年份也跟着它走，避免自相矛盾。
  const publish = parseDateParts(g('publish_date')) || parseDateParts(created) || todayLocal();

  return {
    id: Number(rec?.id) || 0,
    company, position, headcount, salary, address, phone, requirements,
    reqLines: reqLines.length ? reqLines : [requirements],
    created, hasQr, bodyPt, year: publish.year, publish,
  };
}

export function docFilename(info: DocInfo): string {
  return cleanFilename(`招聘简章_${info.company}_${info.position}`) + '.docx';
}

/** 多条合并成一个 Word 时的文件名，如 招聘简章_选定3份_20261022.docx */
export function multiDocFilename(count: number): string {
  return `招聘简章_选定${count}份_${nowLocal().slice(0, 10).replace(/-/g, '')}.docx`;
}

// --------------------------------------------------------------------------- //
// 日期区间（导出筛选）
// --------------------------------------------------------------------------- //
/** 校验 YYYY-MM-DD，非法（含 2026-02-30 这种）返回空串 */
export function normDate(raw: string | null | undefined): string {
  const s = String(raw ?? '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return '';
  const [y, m, d] = s.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  const valid = dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
  return valid ? s : '';
}

/** 归一化起止日期：非法值忽略，start > end 时自动对调 */
export function dateRange(
  startRaw: string | null | undefined,
  endRaw: string | null | undefined,
): { start: string; end: string } {
  let start = normDate(startRaw);
  let end = normDate(endRaw);
  if (start && end && start > end) {
    const t = start; start = end; end = t;
  }
  return { start, end };
}

/** 区间描述：2026-10-01 ~ 2026-10-27 / 2026-10-01 起 / 截至 2026-10-27 / 全部 */
export function rangeLabel(start: string, end: string): string {
  if (start && end) return start === end ? start : `${start} ~ ${end}`;
  if (start) return `${start} 起`;
  if (end) return `截至 ${end}`;
  return '全部';
}

/** 文件名里的日期段：20261001-20261027 / 20261001起 / 截至20261027 / 全部 */
function rangeTag(start: string, end: string): string {
  const c = (s: string) => s.replace(/-/g, '');
  if (start && end) return start === end ? c(start) : `${c(start)}-${c(end)}`;
  if (start) return `${c(start)}起`;
  if (end) return `截至${c(end)}`;
  return '全部';
}

/** 按日期导出 Word 的文件名，如 招聘简章_20261001-20261027_5份.docx */
export function rangeDocFilename(count: number, start: string, end: string): string {
  return `招聘简章_${rangeTag(start, end)}_${count}份.docx`;
}

/** 导出 Excel 的文件名：有日期段带日期段，否则用当天日期 */
export function rangeXlsxFilename(start: string, end: string, today: string): string {
  return start || end ? `招聘信息_${rangeTag(start, end)}.xlsx` : `招聘信息_${today}.xlsx`;
}

