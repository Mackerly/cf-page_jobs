/**
 * 单页 A4 Word 招聘简章生成器
 *
 * 直接用 OOXML + ZIP 拼出 .docx，不依赖 python-docx / LibreOffice。
 * 排版策略与 Flask 版一致：先估算整页高度，再挑能压进一页的最大字号。
 */
import { zipSync, strToU8 } from 'fflate';
import {
  DocInfo, QR_CAPTION, QR_WIDTH_CM, docFilename,
} from './format';
import { QR_JPEG_B64 } from './qr';

const CN_FONT = '宋体';
const CN_FONT_BOLD = '黑体';

// 单位换算
const CM2TWIP = 567;        // 1cm = 567 twips
const PT2TWIP = 20;         // 1pt = 20 twips
const CM2EMU = 360000;      // 1cm = 360000 EMU

const PAGE_W = Math.round(21 * CM2TWIP);        // 11906
const PAGE_H = Math.round(29.7 * CM2TWIP);      // 16838
const MARGIN_T = Math.round(2.0 * CM2TWIP);     // 1134
const MARGIN_B = Math.round(1.8 * CM2TWIP);     // 1021
const MARGIN_LR = Math.round(2.4 * CM2TWIP);    // 1361

const LABEL_W = Math.round(3.7 * CM2TWIP);      // 2098
const VALUE_W = Math.round(12.5 * CM2TWIP);     // 7087
const TABLE_W = LABEL_W + VALUE_W;              // 9185
const MIN_ROW_H = Math.round(0.86 * CM2TWIP);   // 488

const XML_HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';

function esc(s: string): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function halfPt(pt: number): number {
  return Math.round(pt * 2);
}

interface RunOpts {
  size?: number;
  bold?: boolean;
  font?: string;
  color?: string;
}

function run(text: string, o: RunOpts = {}): string {
  const size = o.size ?? 12;
  const font = o.font ?? CN_FONT;
  const parts: string[] = [
    `<w:rFonts w:ascii="${font}" w:hAnsi="${font}" w:eastAsia="${font}" w:cs="${font}"/>`,
  ];
  if (o.bold) parts.push('<w:b/><w:bCs/>');
  if (o.color) parts.push(`<w:color w:val="${o.color.replace('#', '')}"/>`);
  parts.push(`<w:sz w:val="${halfPt(size)}"/><w:szCs w:val="${halfPt(size)}"/>`);
  return `<w:r><w:rPr>${parts.join('')}</w:rPr><w:t xml:space="preserve">${esc(text)}</w:t></w:r>`;
}

interface ParaOpts extends RunOpts {
  text?: string;
  align?: 'left' | 'center' | 'right';
  line?: number;          // 精确行高（pt）
  lineMultiple?: number;  // 倍数行距，如 1.0
  before?: number;        // 段前（pt）
  after?: number;         // 段后（pt）
  indent?: number;        // 首行缩进（pt）
  keepNext?: boolean;
  pageBreak?: boolean;    // 段前强制分页（多条合并时每条从新页开始）
  bottomBorder?: boolean;
  drawing?: string;       // 直接塞入的 <w:r> 片段
}

function para(o: ParaOpts = {}): string {
  const p: string[] = [];
  if (o.keepNext) p.push('<w:keepNext/>');
  if (o.pageBreak) p.push('<w:pageBreakBefore/>');
  if (o.bottomBorder) {
    p.push('<w:pBdr><w:bottom w:val="single" w:sz="12" w:space="1" w:color="333333"/></w:pBdr>');
  }
  const sp: string[] = [];
  if (o.before !== undefined) sp.push(`w:before="${Math.round(o.before * PT2TWIP)}"`);
  if (o.after !== undefined) sp.push(`w:after="${Math.round(o.after * PT2TWIP)}"`);
  if (o.line !== undefined) {
    sp.push(`w:line="${Math.round(o.line * PT2TWIP)}"`, 'w:lineRule="exact"');
  } else if (o.lineMultiple !== undefined) {
    sp.push(`w:line="${Math.round(o.lineMultiple * 240)}"`, 'w:lineRule="auto"');
  }
  if (sp.length) p.push(`<w:spacing ${sp.join(' ')}/>`);
  if (o.indent) p.push(`<w:ind w:firstLine="${Math.round(o.indent * PT2TWIP)}"/>`);
  if (o.align) p.push(`<w:jc w:val="${o.align}"/>`);

  const pPr = p.length ? `<w:pPr>${p.join('')}</w:pPr>` : '';
  const body = o.drawing ?? (o.text !== undefined ? run(o.text, o) : '');
  return `<w:p>${pPr}${body}</w:p>`;
}

function imagePara(rId: string, cx: number, cy: number, name: string, imgId: number): string {
  const drawing = `<w:r><w:drawing>
<wp:inline distT="0" distB="0" distL="0" distR="0">
<wp:extent cx="${cx}" cy="${cy}"/><wp:effectExtent l="0" t="0" r="0" b="0"/>
<wp:docPr id="${imgId}" name="${esc(name)}"/>
<wp:cNvGraphicFramePr><a:graphicFrameLocks noChangeAspect="1"/></wp:cNvGraphicFramePr>
<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">
<pic:pic>
<pic:nvPicPr><pic:cNvPr id="${imgId}" name="${esc(name)}"/><pic:cNvPicPr/></pic:nvPicPr>
<pic:blipFill><a:blip r:embed="${rId}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>
<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm>
<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr>
</pic:pic></a:graphicData></a:graphic>
</wp:inline></w:drawing></w:r>`;
  return para({
    align: 'center', before: 12, after: 0, lineMultiple: 1, keepNext: true, drawing,
  });
}

interface CellOpts {
  width: number;
  text: string;
  bold?: boolean;
  size: number;
  align?: 'left' | 'center' | 'right';
  shade?: string;
  valign?: 'top' | 'center';
  lines?: string[];
  line?: number;
}

function cell(o: CellOpts): string {
  const paras = (o.lines ?? [o.text]).map((t) =>
    para({
      text: t, size: o.size, bold: o.bold, align: o.align ?? 'left',
      line: o.line, after: 0,
    }),
  );
  return `<w:tc><w:tcPr><w:tcW w:w="${o.width}" w:type="dxa"/>`
    + (o.shade ? `<w:shd w:val="clear" w:color="auto" w:fill="${o.shade}"/>` : '')
    + `<w:vAlign w:val="${o.valign ?? 'center'}"/></w:tcPr>${paras.join('')}</w:tc>`;
}

function row(cells: string[], minHeight = MIN_ROW_H): string {
  return `<w:tr><w:trPr><w:cantSplit/><w:trHeight w:val="${minHeight}" w:hRule="atLeast"/></w:trPr>`
    + cells.join('') + '</w:tr>';
}

function contentTypes(hasHeader: boolean): string {
  return `${XML_HEAD}
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Default Extension="jpeg" ContentType="image/jpeg"/>
<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
${hasHeader ? '<Override PartName="/word/header1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/>' : ''}
</Types>`;
}

const ROOT_RELS = `${XML_HEAD}
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`;

function docRels(hasQr: boolean, hasHeader: boolean): string {
  const items = [
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>',
  ];
  if (hasQr) {
    items.push('<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/qr.jpeg"/>');
  }
  if (hasHeader) {
    items.push('<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/header" Target="header1.xml"/>');
  }
  return `${XML_HEAD}
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${items.join('')}</Relationships>`;
}

/**
 * 页眉部件：居中 9pt 深灰文字 + 一条细底边线。
 * <w:pBdr> 必须排在 <w:jc> 之前，否则 Word 判定文档损坏。
 */
function headerXml(text: string): string {
  return `${XML_HEAD}
<w:hdr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"
 xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<w:p><w:pPr><w:pBdr><w:bottom w:val="single" w:sz="6" w:space="1" w:color="808080"/></w:pBdr>
<w:jc w:val="center"/></w:pPr>
${run(text, { size: 9, color: '595959' })}
</w:p></w:hdr>`;
}

function stylesXml(bodyPt: number): string {
  const sz = halfPt(bodyPt);
  return `${XML_HEAD}
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:docDefaults>
<w:rPrDefault><w:rPr>
<w:rFonts w:ascii="${CN_FONT}" w:hAnsi="${CN_FONT}" w:eastAsia="${CN_FONT}" w:cs="${CN_FONT}"/>
<w:sz w:val="${sz}"/><w:szCs w:val="${sz}"/>
</w:rPr></w:rPrDefault>
<w:pPrDefault><w:pPr><w:spacing w:before="0" w:after="0" w:line="240" w:lineRule="auto"/></w:pPr></w:pPrDefault>
</w:docDefaults>
<w:style w:type="paragraph" w:default="1" w:styleId="Normal">
<w:name w:val="Normal"/><w:qFormat/>
<w:pPr><w:spacing w:before="0" w:after="0" w:line="240" w:lineRule="auto"/></w:pPr>
<w:rPr><w:rFonts w:ascii="${CN_FONT}" w:hAnsi="${CN_FONT}" w:eastAsia="${CN_FONT}" w:cs="${CN_FONT}"/>
<w:sz w:val="${sz}"/><w:szCs w:val="${sz}"/></w:rPr>
</w:style>
</w:styles>`;
}

/** 生成一条招聘简章的全部段落块；pageBreak=true 时从新页开始 */
function recordBlocks(info: DocInfo, imgId: number, pageBreak: boolean): string[] {
  const bodyPt = info.bodyPt;
  const line = bodyPt * 1.28;

  const blocks: string[] = [];

  // 编号
  blocks.push(para({
    text: `编号：ZP-${info.year}-${String(info.id).padStart(4, '0')}`,
    size: 9, color: '888888', align: 'right', after: 3, pageBreak,
  }));

  // 标题
  blocks.push(para({
    text: '招 聘 简 章', size: 22, bold: true, font: CN_FONT_BOLD, align: 'center', after: 3,
  }));
  blocks.push(para({
    text: info.company, size: 13.5, bold: true, font: CN_FONT_BOLD, align: 'center', after: 2,
  }));
  // 装饰横线：字号压到 1pt，避免白占一整行
  blocks.push(para({ text: '', size: 1, after: 8, bottomBorder: true }));

  // 信息表
  const rows: string[] = [];
  const simpleRow = (label: string, value: string, bold = false) =>
    row([
      cell({ width: LABEL_W, text: label, bold: true, size: bodyPt, align: 'center', shade: 'F2F2F2', line }),
      cell({ width: VALUE_W, text: value, bold, size: bodyPt, line }),
    ]);

  rows.push(simpleRow('招聘岗位', info.position, true));
  rows.push(simpleRow('招聘人数', info.headcount));
  rows.push(simpleRow('工资待遇', info.salary, true));
  rows.push(simpleRow('工作地址', info.address));
  rows.push(simpleRow('联系电话', info.phone));
  rows.push(row([
    cell({ width: LABEL_W, text: '岗位要求', bold: true, size: bodyPt, align: 'center', shade: 'F2F2F2', line }),
    cell({ width: VALUE_W, text: '', size: bodyPt, lines: info.reqLines, valign: 'top', line }),
  ]));

  blocks.push(`<w:tbl><w:tblPr>
<w:tblW w:w="${TABLE_W}" w:type="dxa"/><w:jc w:val="center"/>
<w:tblBorders>
<w:top w:val="single" w:sz="6" w:space="0" w:color="404040"/>
<w:left w:val="single" w:sz="6" w:space="0" w:color="404040"/>
<w:bottom w:val="single" w:sz="6" w:space="0" w:color="404040"/>
<w:right w:val="single" w:sz="6" w:space="0" w:color="404040"/>
<w:insideH w:val="single" w:sz="6" w:space="0" w:color="404040"/>
<w:insideV w:val="single" w:sz="6" w:space="0" w:color="404040"/>
</w:tblBorders>
<w:tblLayout w:type="fixed"/>
<w:tblCellMar><w:top w:w="36" w:type="dxa"/><w:left w:w="100" w:type="dxa"/>
<w:bottom w:w="36" w:type="dxa"/><w:right w:w="100" w:type="dxa"/></w:tblCellMar>
</w:tblPr>
<w:tblGrid><w:gridCol w:w="${LABEL_W}"/><w:gridCol w:w="${VALUE_W}"/></w:tblGrid>
${rows.join('')}
</w:tbl>`);
  // 表格后必须跟一个空段落，否则 Word 会把表格和后续内容粘连
  blocks.push(para({ text: '', size: 1 }));

  // 应聘说明
  blocks.push(para({
    text: '有意应聘者请携带本人身份证及相关证件，于工作日到上述地址报名面试，或来电咨询。'
      + '本简章长期有效，招满为止。',
    size: bodyPt, before: 10, line: bodyPt * 1.45, indent: bodyPt * 2,
  }));

  // 落款
  blocks.push(para({
    text: `发布单位：${info.company}（盖章）`,
    size: bodyPt, align: 'right', before: 8, line: bodyPt * 1.5, keepNext: true,
  }));
  blocks.push(para({
    text: `发布日期：${info.publish.year} 年 ${info.publish.month} 月 ${info.publish.day} 日`,
    size: bodyPt, align: 'right', line: bodyPt * 1.5, keepNext: info.hasQr,
  }));

  // 二维码
  if (info.hasQr) {
    const emu = Math.round(QR_WIDTH_CM * CM2EMU);
    blocks.push(imagePara('rId2', emu, emu, 'qr.jpeg', imgId));
    blocks.push(para({
      text: QR_CAPTION, size: 9, color: '404040', align: 'center',
      before: 5, keepNext: true,
    }));
  }

  blocks.push(para({
    text: '— 本招聘简章最终解释权归用人单位所有 —',
    size: 8.5, color: '808080', align: 'center', before: 10,
  }));

  return blocks;
}

/** 把若干段落块打包成 .docx 字节 */
function packDocx(
  blocks: string[], bodyPt: number, hasQr: boolean, header = '',
): Uint8Array {
  const hdrText = String(header ?? '').trim();
  const hasHeader = hdrText !== '';
  // <w:headerReference> 必须是 <w:sectPr> 的第一个子元素
  const hdrRef = hasHeader ? '<w:headerReference w:type="default" r:id="rId3"/>' : '';
  const documentXml = `${XML_HEAD}
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"
 xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"
 xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"
 xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"
 xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture">
<w:body>
${blocks.join('\n')}
<w:sectPr>
${hdrRef}
<w:pgSz w:w="${PAGE_W}" w:h="${PAGE_H}"/>
<w:pgMar w:top="${MARGIN_T}" w:right="${MARGIN_LR}" w:bottom="${MARGIN_B}" w:left="${MARGIN_LR}" w:header="567" w:footer="567" w:gutter="0"/>
<w:cols w:space="425"/>
<w:docGrid w:linePitch="312"/>
</w:sectPr>
</w:body></w:document>`;

  const files: Record<string, Uint8Array> = {
    '[Content_Types].xml': strToU8(contentTypes(hasHeader)),
    '_rels/.rels': strToU8(ROOT_RELS),
    'word/document.xml': strToU8(documentXml),
    'word/styles.xml': strToU8(stylesXml(bodyPt)),
    'word/_rels/document.xml.rels': strToU8(docRels(hasQr, hasHeader)),
  };
  if (hasHeader) {
    files['word/header1.xml'] = strToU8(headerXml(hdrText));
  }
  if (hasQr) {
    files['word/media/qr.jpeg'] = qrBytes();
  }
  return zipSync(files, { level: 6, mtime: new Date() });
}

/** 单条招聘信息 → 单页 .docx */
export function buildDocx(info: DocInfo, header = ''): Uint8Array {
  return packDocx(recordBlocks(info, 1, false), info.bodyPt, info.hasQr, header);
}

/**
 * 多条招聘信息 → 同一个 .docx，每条占一页（需登录后使用）。
 * 每条的第一个段落带 <w:pageBreakBefore/>，不额外插空段落，避免多占高度。
 */
export function buildDocxMulti(infos: DocInfo[], header = ''): Uint8Array {
  if (!infos.length) throw new Error('没有可导出的招聘信息');
  const blocks = infos.flatMap((info, i) => recordBlocks(info, i + 1, i > 0));
  return packDocx(blocks, infos[0].bodyPt, infos.some((i) => i.hasQr), header);
}

let _qrCache: Uint8Array | null = null;

/** 裁好的二维码 JPEG 字节（内嵌在代码里，无需外部依赖） */
export function qrBytes(): Uint8Array {
  if (!_qrCache) {
    const bin = atob(QR_JPEG_B64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    _qrCache = out;
  }
  return _qrCache;
}
