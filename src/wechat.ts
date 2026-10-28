/**
 * 微信发布 HTML 生成器
 * —— 与 Flask 版 wechat_gen.py 输出一致
 *
 * 微信编辑器会过滤 <style>、class 与外部资源，只保留行内样式，所以这里：
 *   * 所有样式都写成 style="..."，不使用 class / id / <style>
 *   * 只用 section + p 的块级排版，不用 flex / grid / position
 *   * 不引用任何图片：二维码等素材请在公众号编辑器里手动插入
 *
 * 生成结果是一段「片段」（不含 <html>/<body>），整段复制粘贴进编辑器即可。
 */
import { DocInfo } from './format';

const BRAND = '#c0392b';        // 主色：序号块、薪资、左侧竖条
const BRAND_BG = '#fdf3f1';     // 主色浅底
const BRAND_SOFT = '#a98079';   // 主色弱化文字（副标题、小标签）
const TEXT = '#333333';
const TEXT_SOFT = '#888888';
const MUTED = '#999999';
const CARD_BG = '#fafafa';
const NOTE_BG = '#f7f7f7';
const LINE = '#e8dcd8';

const FONT = "-apple-system,BlinkMacSystemFont,'Helvetica Neue','PingFang SC',"
  + "'Hiragino Sans GB','Microsoft YaHei',sans-serif";

export const DEFAULT_WECHAT_TITLE = '本期招聘信息';
export const DEFAULT_WECHAT_FOOTER =
  '1. 招聘不收取任何费用，请提高警惕，谨防各类招聘诈骗；<br>'
  + '2. 岗位信息以用人单位实际沟通为准，入职前请核实用工主体；<br>'
  + '3. 有意向的求职者请直接拨打上方联系电话咨询报名。';

function esc(s: unknown): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function fmtDate(d: Date): string {
  const p = new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: 'numeric', day: 'numeric',
  }).formatToParts(d);
  const g = (t: string) => p.find((x) => x.type === t)?.value ?? '';
  return `${g('year')}年${g('month')}月${g('day')}日`;
}

function infoRow(label: string, value: string): string {
  return `<p style="margin:0;font-size:14px;line-height:2;color:${TEXT};">`
    + `<span style="color:${MUTED};">${esc(label)}：</span>${esc(value)}</p>`;
}

function recordBlock(idx: number, info: DocInfo): string {
  const num = String(idx).padStart(2, '0');
  const out: string[] = [];
  out.push('  <section style="margin:0 0 24px;">');

  // 序号 + 岗位名
  out.push(`    <p style="margin:0;font-size:17px;font-weight:bold;line-height:1.7;color:#1f1f1f;">`
    + `<span style="display:inline-block;margin-right:8px;padding:1px 7px;background:${BRAND};`
    + `color:#ffffff;border-radius:4px;font-size:13px;font-weight:normal;">${num}</span>`
    + `${esc(info.position)}</p>`);
  // 用人单位
  out.push(`    <p style="margin:6px 0 12px;font-size:13px;color:${TEXT_SOFT};">`
    + `${esc(info.company)}</p>`);

  // 薪资福利
  out.push(`    <section style="margin:0 0 12px;padding:10px 12px;background:${BRAND_BG};`
    + `border-left:3px solid ${BRAND};border-radius:0 6px 6px 0;">`);
  out.push(`      <p style="margin:0;font-size:12px;color:${BRAND_SOFT};letter-spacing:1px;">薪资福利</p>`);
  out.push(`      <p style="margin:4px 0 0;font-size:16px;font-weight:bold;color:${BRAND};">`
    + `${esc(info.salary)}</p>`);
  out.push('    </section>');

  // 招聘人数 / 地址 / 电话
  const rows: string[] = [];
  if (info.headcount && info.headcount !== '—') rows.push(infoRow('招聘人数', info.headcount));
  if (info.address && info.address !== '—') rows.push(infoRow('工作地址', info.address));
  if (info.phone && info.phone !== '—') rows.push(infoRow('联系电话', info.phone));
  if (rows.length) {
    out.push('    <section style="margin:0 0 12px;">');
    for (const r of rows) out.push('      ' + r);
    out.push('    </section>');
  }

  // 具体信息（岗位要求，按行分段）
  out.push(`    <section style="margin:0;padding:12px 14px;background:${CARD_BG};border-radius:8px;">`);
  out.push(`      <p style="margin:0 0 6px;font-size:12px;color:${BRAND_SOFT};letter-spacing:1px;">具体信息</p>`);
  for (const line of info.reqLines) {
    out.push(`      <p style="margin:0 0 4px;font-size:14px;line-height:1.9;color:#444444;">`
      + `${esc(line)}</p>`);
  }
  out.push('    </section>');

  out.push('  </section>');
  return out.join('\n');
}

export interface WechatOpts {
  title?: string;
  footer?: string;
  showDivider?: boolean;
  now?: Date;
}

/** 把若干条招聘信息渲染成公众号可粘贴的 HTML 片段 */
export function buildWechatHtml(infos: DocInfo[], opts: WechatOpts = {}): string {
  if (!infos.length) return '';
  const title = opts.title || DEFAULT_WECHAT_TITLE;
  const footer = opts.footer === undefined ? DEFAULT_WECHAT_FOOTER : opts.footer;
  const showDivider = opts.showDivider !== false;

  const out: string[] = [];
  out.push(`<section style="font-size:15px;line-height:1.75;color:${TEXT};font-family:${FONT};">`);

  // 头部
  out.push(`  <section style="margin:0 0 20px;padding:16px 14px;background:${BRAND_BG};`
    + 'border-radius:10px;text-align:center;">');
  out.push(`    <p style="margin:0;font-size:19px;font-weight:bold;color:${BRAND};`
    + `letter-spacing:2px;">${esc(title)}</p>`);
  out.push(`    <p style="margin:8px 0 0;font-size:12px;color:${BRAND_SOFT};">`
    + `共 ${infos.length} 个岗位 · ${fmtDate(opts.now || new Date())}</p>`);
  out.push('  </section>');

  infos.forEach((info, i) => {
    if (showDivider && i > 0) {
      out.push(`  <section style="margin:0 0 24px;border-top:1px dashed ${LINE};"></section>`);
    }
    out.push(recordBlock(i + 1, info));
  });

  // 底部提示
  if (footer) {
    out.push(`  <section style="margin:26px 0 0;padding:14px 16px;background:${NOTE_BG};`
      + 'border-radius:8px;">');
    out.push(`    <p style="margin:0 0 8px;font-size:13px;font-weight:bold;color:${TEXT};`
      + 'letter-spacing:1px;">温馨提示</p>');
    out.push(`    <p style="margin:0;font-size:12px;line-height:1.9;color:${TEXT_SOFT};">${footer}</p>`);
    out.push('  </section>');
  }

  out.push('</section>');
  return out.join('\n');
}
