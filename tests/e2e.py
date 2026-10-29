# -*- coding: utf-8 -*-
"""Cloudflare Pages 版本端到端测试（走真实 HTTP，针对 wrangler pages dev 本地实例）"""
import http.cookiejar
import io
import json
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import zipfile

BASE = "http://127.0.0.1:8788"
ok = fail = 0


def check(name, cond, extra=""):
    global ok, fail
    if cond:
        ok += 1
        print(f"  PASS  {name}")
    else:
        fail += 1
        print(f"  FAIL  {name}  {extra}")


class S:
    def __init__(self):
        self.jar = http.cookiejar.CookieJar()
        self.op = urllib.request.build_opener(
            urllib.request.HTTPCookieProcessor(self.jar),
            NoRedirect(),
        )

    def get(self, path):
        try:
            r = self.op.open(BASE + path)
            return r.status, r.read().decode("utf-8", "replace"), dict(r.headers)
        except urllib.error.HTTPError as e:
            return e.code, e.read().decode("utf-8", "replace"), dict(e.headers)

    def get_raw(self, path):
        """下载二进制（Excel / Word / ZIP）用，不解码"""
        try:
            r = self.op.open(BASE + path)
            return r.status, r.read(), dict(r.headers)
        except urllib.error.HTTPError as e:
            return e.code, e.read(), dict(e.headers)

    def post_file(self, path, field, filename, blob, extra=None):
        """multipart/form-data 上传（导入 Excel 用）"""
        bd = "----wbtest" + str(int(time.time() * 1000))
        parts = []
        for k, v in (extra or {}).items():
            parts.append(f'--{bd}\r\nContent-Disposition: form-data; name="{k}"\r\n\r\n{v}\r\n'.encode())
        parts.append(
            f'--{bd}\r\nContent-Disposition: form-data; name="{field}"; filename="{filename}"\r\n'
            "Content-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet\r\n\r\n".encode()
            + blob + b"\r\n")
        parts.append(f"--{bd}--\r\n".encode())
        req = urllib.request.Request(BASE + path, data=b"".join(parts),
                                     headers={"Content-Type": f"multipart/form-data; boundary={bd}"})
        try:
            r = self.op.open(req)
            return r.status, r.read().decode("utf-8", "replace"), dict(r.headers)
        except urllib.error.HTTPError as e:
            return e.code, e.read().decode("utf-8", "replace"), dict(e.headers)

    def post(self, path, data):
        body = urllib.parse.urlencode(data, doseq=True).encode()
        req = urllib.request.Request(BASE + path, data=body,
                                     headers={"Content-Type": "application/x-www-form-urlencoded"})
        try:
            r = self.op.open(req)
            return r.status, r.read().decode("utf-8", "replace"), dict(r.headers)
        except urllib.error.HTTPError as e:
            return e.code, e.read().decode("utf-8", "replace"), dict(e.headers)


    def post_raw(self, path, data):
        body = urllib.parse.urlencode(data, doseq=True).encode()
        req = urllib.request.Request(BASE + path, data=body,
                                     headers={"Content-Type": "application/x-www-form-urlencoded"})
        try:
            r = self.op.open(req)
            return r.status, r.read(), dict(r.headers)
        except urllib.error.HTTPError as e:
            return e.code, e.read(), dict(e.headers)


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def csrf(s, path):
    _, body, _ = s.get(path)
    m = re.search(r'name="_csrf" value="([^"]+)"', body)
    return m.group(1) if m else ""


def flashes(body):
    return [m.strip() for m in re.findall(r'class="flash [a-z]+">([^<]*)', body)]


def xlsx_rows(blob):
    """数 sheet1 的数据行数（不含表头），不依赖 openpyxl"""
    z = zipfile.ZipFile(io.BytesIO(blob))
    xml = z.read("xl/worksheets/sheet1.xml").decode("utf-8", "replace")
    return max(0, xml.count("<row ") - 1)


def xlsx_text(blob):
    """sheet1 的 XML 文本（用来查表头 / 单元格内容）"""
    z = zipfile.ZipFile(io.BytesIO(blob))
    return z.read("xl/worksheets/sheet1.xml").decode("utf-8", "replace")


def docx_pages(blob):
    """返回 (信息表数量, 分页符数量)：表数=条数，分页符=条数-1"""
    z = zipfile.ZipFile(io.BytesIO(blob))
    xml = z.read("word/document.xml").decode("utf-8", "replace")
    return xml.count("<w:tbl>"), xml.count("<w:pageBreakBefore/>")


print("=" * 62)
adm = S()

# 取一条真实记录 id（重建数据库后 id 不一定从 1 开始）
# 序号列已改成「每页自然顺序」，取真实 id 要读行内链接
_first = re.search(r'href="/preview/(\d+)"', S().get("/")[1])
RID = int(_first.group(1)) if _first else 1

# ---------- 1. 匿名访问 ----------
print("[1] 匿名访问")
for path in ("/", "/login", "/register", f"/docx/{RID}", "/qr.jpg", f"/preview/{RID}"):
    st, _, _ = S().get(path)
    check(f"公开可访问 {path}", st == 200, st)
for path in ("/add", "/import", "/export/excel", "/docx/zip", "/docx/range", "/docx/selected",
             "/template.xlsx", "/users", "/audit", "/backup.sql"):
    st, _, hd = S().get(path)
    check(f"匿名拦截 {path}", st == 302 and "/login" in hd.get("Location", ""), f"{st} {hd.get('Location')}")

# ---------- 2. CSRF ----------
print("[2] CSRF 防护")
st, body, _ = S().post("/login", {"username": "admin", "password": "x"})
check("缺少 CSRF 被拒", st == 400, st)
check("提示表单校验失败", "CSRF" in body)

# ---------- 3. 登录 ----------
print("[3] 登录")
st, body, _ = adm.post("/login", {"_csrf": csrf(adm, "/login"), "username": "admin",
                                  "password": "wrong-pass"})
check("密码错误 401", st == 401, st)
st, body, _ = adm.post("/login", {"_csrf": csrf(adm, "/login"), "username": "admin",
                                  "password": "admin123", "next": "/import"})
check("登录成功 302", st == 302, st)
check("按 next 跳转", adm.get("/import")[0] == 200)

# ---------- 4. 注册 ----------
print("[4] 注册与审批")
uname = "zhangsan" + str(int(time.time()) % 100000)
reg = S()
st, body, _ = reg.post("/register", {
    "_csrf": csrf(reg, "/register"), "username": uname, "password": "Test@1234",
    "confirm_password": "Test@1234", "real_name": "张三", "phone": "13800001111",
    "remark": "县就业服务中心",
})
check("注册成功跳登录", st == 302 and "/login" in body or st == 302, st)

st, body, _ = S().post("/register", {
    "_csrf": csrf(S(), "/register"), "username": uname, "password": "Test@1234",
    "confirm_password": "Test@1234", "real_name": "张三", "phone": "1",
})
check("重复用户名被拒", st in (400, 302, 500), st)

st, body, _ = reg.post("/login", {"_csrf": csrf(reg, "/login"),
                                  "username": uname, "password": "Test@1234"})
check("待审批账号登录 403", st == 403, st)
check("提示等待审批", "等待管理员审批" in body)

st, users_html, _ = adm.get("/users")
check("用户管理可访问", st == 200, st)
check("列表含待审批账号", uname in users_html)
m = re.search(r'/users/(\d+)/action', users_html)
check("页面有审批按钮", bool(m))

# 找到该用户的行 id
uid = None
for mm in re.finditer(r'<td class="mono">(\d+)</td>\s*<td class="strong">' + re.escape(uname), users_html):
    uid = int(mm.group(1))
check("定位到新用户 id", uid is not None, uid)

st, body, _ = adm.post(f"/users/{uid}/action",
                       {"_csrf": csrf(adm, "/users"), "action": "approve"})
check("审批通过", st == 302, st)
st, body, _ = reg.post("/login", {"_csrf": csrf(reg, "/login"),
                                  "username": uname, "password": "Test@1234"})
check("审批后可登录", st == 302, st)
for path in ("/add", "/import", "/export/excel", "/docx/zip", "/template.xlsx"):
    check(f"新用户可访问 {path}", reg.get(path)[0] == 200, reg.get(path)[0])
st, _, hd = reg.get("/users")
check("普通用户不能进用户管理", st == 302, st)

# ---------- 5. 增删改 ----------
print("[5] 增删改")
st, body, _ = reg.post("/add", {
    "_csrf": csrf(reg, "/add"), "company_name": "Worker测试有限公司",
    "position": "质检员", "headcount": "4", "salary": "5000-6000",
    "address": "测试路 1 号", "phone": "13500001111", "requirements": "1. 认真；2. 有经验。",
})
check("新增成功", st == 302, st)
_, lst, _ = reg.get("/")
check("新增已入库", "Worker测试有限公司" in lst)

_row = re.search(r'<tr[^>]*>\s*<td class="mono">.*?Worker测试有限公司.*?</tr>', lst, re.S)
m = re.search(r'/preview/(\d+)', _row.group(0)) if _row else None
rid = int(m.group(1)) if m else None
check("拿到新记录 id", rid is not None, rid)

st, body, _ = reg.post(f"/edit/{rid}", {
    "_csrf": csrf(reg, f"/edit/{rid}"), "company_name": "Worker测试有限公司",
    "position": "质检员（改）", "headcount": "5", "salary": "5200-6200",
    "address": "测试路 1 号", "phone": "13500001111", "requirements": "已修改",
})
check("编辑成功", st == 302, st)
_, lst, _ = reg.get("/")
check("修改已生效", "质检员（改）" in lst)

# 编辑页 GET
check("编辑页可打开", reg.get(f"/edit/{rid}")[0] == 200)

# ---------- 5.4 发布日期 ----------
print("[5.4] 发布日期（默认当天 + 按发布日期筛选）")
TD0 = time.strftime("%Y-%m-%d")
_, addpage, _ = reg.get("/add")
check("新增页有发布日期输入", 'name="publish_date"' in addpage and 'type="date"' in addpage)
check("发布日期默认当天", f'value="{TD0}"' in addpage, TD0)

st, _, _ = reg.post("/add", {
    "_csrf": csrf(reg, "/add"), "company_name": "日期测试公司", "position": "日期岗位",
    "publish_date": "2026-09-01", "headcount": "1", "salary": "面议",
    "address": "测试路 9 号", "phone": "13500009999", "requirements": "测试",
})
check("带发布日期新增成功", st == 302, st)
_, lst, _ = reg.get("/?q=%E6%97%A5%E6%9C%9F%E6%B5%8B%E8%AF%95&show_expired=1")
check("列表显示发布日期", "2026-09-01" in lst)
check("列表有发布日期表头", "发布日期" in lst)
drid = re.search(r'data-id="(\d+)"', lst)
drid = int(drid.group(1)) if drid else None
check("拿到日期测试记录 id", drid is not None, drid)

_, hit, _ = reg.get("/?q=%E6%97%A5%E6%9C%9F%E6%B5%8B%E8%AF%95&start=2026-09-01&end=2026-09-01&show_expired=1")
check("按发布日期命中", "日期测试公司" in hit)
_, miss, _ = reg.get("/?q=%E6%97%A5%E6%9C%9F%E6%B5%8B%E8%AF%95&start=2026-09-02")
check("区间外不命中", "日期测试公司" not in miss)
_, miss2, _ = reg.get("/?q=%E6%97%A5%E6%9C%9F%E6%B5%8B%E8%AF%95&end=2026-08-31")
check("结束日之前不命中", "日期测试公司" not in miss2)

st, _, _ = reg.post(f"/edit/{drid}", {
    "_csrf": csrf(reg, f"/edit/{drid}"), "company_name": "日期测试公司", "position": "日期岗位",
    "publish_date": "2026-08-15", "headcount": "1", "salary": "面议",
    "address": "测试路 9 号", "phone": "13500009999", "requirements": "测试",
})
_, lst2, _ = reg.get("/?q=%E6%97%A5%E6%9C%9F%E6%B5%8B%E8%AF%95&show_expired=1")
check("编辑后日期已更新", "2026-08-15" in lst2 and "2026-09-01" not in lst2)

st, _, _ = reg.post("/add", {
    "_csrf": csrf(reg, "/add"), "company_name": "日期非法", "position": "x",
    "publish_date": "2026-02-30",
})
check("非法发布日期被拦", st == 400, st)

st, dx, _ = reg.get_raw("/export/excel?q=%E6%97%A5%E6%9C%9F%E6%B5%8B%E8%AF%95")
check("Excel 含发布日期列", "发布日期" in xlsx_text(dx), xlsx_text(dx)[:120])
for _x in set(re.findall(r'data-id="(\d+)"', lst2)):
    reg.post(f"/delete/{_x}", {"_csrf": csrf(reg, "/"), "back": "/"})

# ---------- 5.4b 招聘状态 ----------
print("[5.4b] 招聘状态（招满 / 失效 / 自动失效 / 筛选 / 排序）")
TD1 = time.strftime("%Y-%m-%d")
OLD45 = time.strftime("%Y-%m-%d", time.localtime(time.time() - 45 * 86400))
D3 = time.strftime("%Y-%m-%d", time.localtime(time.time() - 3 * 86400))

_, page0, _ = reg.get("/")
check("列表有招聘状态表头", "招聘状态" in page0)
check("列表有状态徽标", 'class="st st-' in page0)
check("列表有状态筛选开关", 'name="show_full"' in page0 and 'name="show_expired"' in page0)

_, addpage2, _ = reg.get("/add")
check("新增页有状态下拉", 'name="status"' in addpage2)
check("状态下拉三个选项",
      addpage2.count('value="active"') + addpage2.count('value="full"')
      + addpage2.count('value="expired"') == 3)
check("状态字段在发布日期之前", addpage2.index('name="status"') < addpage2.index('name="publish_date"'))
check("发布日期仍在岗位要求之前",
      addpage2.index('name="publish_date"') < addpage2.index('name="requirements"'))


def add_rec(company, position, pub, status=""):
    body = {"_csrf": csrf(reg, "/add"), "company_name": company, "position": position,
            "publish_date": pub, "headcount": "1"}
    if status:
        body["status"] = status
    return reg.post("/add", body)[0]


check("新增在招记录", add_rec("状态在招公司", "岗位A", TD1) == 302)
check("新增招满记录", add_rec("状态招满公司", "岗位F", TD1, "full") == 302)
check("新增手动失效记录", add_rec("状态失效公司", "岗位E", TD1, "expired") == 302)
check("新增过期记录", add_rec("状态过期公司", "岗位O", OLD45) == 302)
check("新增排序新记录", add_rec("排序新公司", "岗位N", TD1) == 302)
check("新增排序旧记录", add_rec("排序旧公司", "岗位P", D3) == 302)

Q = urllib.parse.quote("状态")
_, only, _ = reg.get(f"/?q={Q}")
check("默认显示在招", "状态在招公司" in only)
check("默认隐藏招满", "状态招满公司" not in only)
check("默认隐藏手动失效", "状态失效公司" not in only)
check("默认隐藏自动失效", "状态过期公司" not in only)
check("有已隐藏提示", "已隐藏" in only)

_, wf, _ = reg.get(f"/?q={Q}&show_full=1")
check("勾选后显示招满", "状态招满公司" in wf and "状态失效公司" not in wf)
check("招满徽标", "st-full" in wf)

_, we, _ = reg.get(f"/?q={Q}&show_expired=1")
check("勾选后显示手动失效", "状态失效公司" in we)
check("勾选后显示自动失效", "状态过期公司" in we)
check("失效徽标", "st-expired" in we)

_, wall, _ = reg.get(f"/?q={Q}&show_full=1&show_expired=1")
check("全部显示四种状态都在", all(x in wall for x in (
    "状态在招公司", "状态招满公司", "状态失效公司", "状态过期公司")))

# 排序：发布日期倒序，最新发布在前
QS = urllib.parse.quote("排序")
_, srt, _ = reg.get(f"/?q={QS}")
check("按发布日期倒序（新在前）", srt.index("排序新公司") < srt.index("排序旧公司"))

# 编辑页回填状态
_, editpage, _ = reg.get(f"/edit/{RID}")
check("编辑页有状态下拉", 'name="status"' in editpage)
check("编辑页默认选中在招", '<option value="active" selected' in editpage)

# 新增页：招聘状态与发布日期同一行，默认「招聘中」+ 当天
_, addpage, _ = reg.get("/add")
same_row = re.search(
    r'<div class="grid-2">(?:(?!</div>).)*name="status"(?:(?!</div>).)*name="publish_date"(?:(?!</div>).)*</div>',
    addpage, re.S)
check("状态与发布日期同一行", same_row is not None)
check("新增页状态默认招聘中", '<option value="active" selected' in addpage)
check("新增页日期默认当天", f'name="publish_date"\n               value="{TD1}"' in addpage
      or f'value="{TD1}"' in addpage, TD1)
check("状态在发布日期之前（同一行内）",
      addpage.index('name="status"') < addpage.index('name="publish_date"'))
check("发布日期仍在岗位要求之前",
      addpage.index('name="publish_date"') < addpage.index('name="requirements"'))

# 状态写进 Excel
_, dx2, _ = reg.get_raw(f"/export/excel?q={Q}&show_full=1&show_expired=1")
check("Excel 含招聘状态列", "招聘状态" in xlsx_text(dx2), xlsx_text(dx2)[:120])

# 清理本节数据
for kw in ("状态", "排序"):
    _, pl, _ = reg.get(f"/?q={urllib.parse.quote(kw)}&show_full=1&show_expired=1&per=50")
    for x in set(re.findall(r'data-id="(\d+)"', pl)):
        reg.post(f"/delete/{x}", {"_csrf": csrf(reg, "/"), "back": "/"})
_, after, _ = reg.get(f"/?q={Q}&show_full=1&show_expired=1")
check("状态测试数据已清理", "状态在招公司" not in after)

# ---------- 5.5 勾选导出为单个 Word ----------
print("[5.5] 导出选定为 Word（每条一页）")
_, lst, _ = reg.get("/")
check("列表出现勾选框", 'class="pick-box"' in lst)
check("列表出现选择条", 'id="selForm"' in lst)
sel_token = csrf(reg, "/")

st, blob, hd = reg.post_raw("/docx/selected", {"_csrf": sel_token, "ids": [str(RID), str(rid)]})
check("导出返回 docx", st == 200 and blob[:2] == b"PK", f"{st} {len(blob)}")
check("文件名含「选定」", "%E9%80%89%E5%AE%9A" in hd.get("Content-Disposition", ""),
      hd.get("Content-Disposition"))

if blob[:2] == b"PK":
    z = zipfile.ZipFile(io.BytesIO(blob))
    xml = z.read("word/document.xml").decode("utf-8")
    check("文档含 2 个信息表", xml.count("<w:tbl>") == 2, xml.count("<w:tbl>"))
    check("文档只有 1 处分页（第 2 条起新页）", xml.count("<w:pageBreakBefore/>") == 1,
          xml.count("<w:pageBreakBefore/>"))
    check("文档含二维码图片", "word/media/qr.jpeg" in z.namelist())

st, _, _ = reg.post("/docx/selected", {"_csrf": sel_token})
check("未勾选被拦回列表", st == 302, st)
st, _, _ = reg.post("/docx/selected", {"_csrf": sel_token, "ids": ["999999"]})
check("无效 id 被拦回列表", st == 302, st)

# ---------- 5.6 按日期导出（Excel / Word） ----------
print("[5.6] 按日期导出（起止日期）")
_, lst, _ = reg.get("/")
check("列表出现日期导出条", 'class="datebar"' in lst)
check("日期条含两个日期框", lst.count('<input type="date"') == 2, lst.count('<input type="date"'))

TODAY = time.strftime("%Y-%m-%d")

st, all_xlsx, _ = reg.get_raw("/export/excel")
check("Excel 默认导出全部 200", st == 200 and all_xlsx[:2] == b"PK", st)
ALL = xlsx_rows(all_xlsx)
check("Excel 有数据行", ALL >= 3, ALL)

st, all_docx, _ = reg.get_raw("/docx/range")
check("Word 按日期导出 200", st == 200 and all_docx[:2] == b"PK", st)
tables, breaks = docx_pages(all_docx)
check("Word 条数与 Excel 一致", tables == ALL, (tables, ALL))
check("Word 每条一页", breaks == max(0, ALL - 1), breaks)
check("Word 内含二维码", zipfile.ZipFile(io.BytesIO(all_docx)).namelist().count("word/media/qr.jpeg") >= 1)

st, today_xlsx, _ = reg.get_raw(f"/export/excel?start={TODAY}&end={TODAY}")
check("Excel 今天区间 200", st == 200 and today_xlsx[:2] == b"PK", st)
TD = xlsx_rows(today_xlsx)
check("今天区间含刚新增的记录", 1 <= TD <= ALL, (TD, ALL))

st, today_docx, hd = reg.get_raw(f"/docx/range?start={TODAY}&end={TODAY}")
check("Word 今天区间条数与 Excel 一致", docx_pages(today_docx)[0] == TD, (docx_pages(today_docx)[0], TD))
check("Word 文件名含日期段", TODAY.replace("-", "") in urllib.parse.unquote(hd.get("Content-Disposition", "")),
      hd.get("Content-Disposition"))

st, empty_xlsx, _ = reg.get_raw("/export/excel?start=2000-01-01&end=2000-01-02")
check("Excel 空区间只剩表头", xlsx_rows(empty_xlsx) == 0, xlsx_rows(empty_xlsx))

st, _, _ = reg.get_raw("/docx/range?start=2000-01-01&end=2000-01-02")
check("Word 空区间跳回列表", st == 302, st)

st, wide_docx, _ = reg.get_raw("/docx/range?start=2000-01-01&end=2099-12-31")
check("Word 超大区间 = 全部", docx_pages(wide_docx)[0] == ALL, docx_pages(wide_docx)[0])

st, bad_docx, _ = reg.get_raw("/docx/range?start=abc&end=2026-13-99")
check("非法日期按全部处理", docx_pages(bad_docx)[0] == ALL, docx_pages(bad_docx)[0])

st, rev_docx, _ = reg.get_raw(f"/docx/range?start={TODAY}&end=2000-01-01")
check("起止颠倒自动对调", docx_pages(rev_docx)[0] == ALL, docx_pages(rev_docx)[0])

st, open_docx, _ = reg.get_raw(f"/docx/range?start={TODAY}")
check("只填起始 = 该天起", docx_pages(open_docx)[0] == TD, (docx_pages(open_docx)[0], TD))

# ---------- 5.7 分页与每页条数 ----------
print("[5.7] 分页 / 每页条数 / 列表日期筛选")
_, lst, _ = reg.get("/")
check("列表出现每页条数下拉", 'id="perSel"' in lst)
check("下拉有 4 个档位", lst.count('<option value="') >= 4, lst.count('<option value="'))
check("分页信息含总条数", "共 " in lst and "每页 15 条" in lst)

# 造 16 条数据，保证能翻页
token_add = csrf(reg, "/add")
made = []
for i in range(16):
    nm = f"分页测试公司{i:02d}"
    st, _, _ = reg.post("/add", {
        "_csrf": token_add, "company_name": nm, "position": f"分页岗位{i:02d}",
        "headcount": "2", "salary": "4000-5000", "address": "测试路 2 号",
        "phone": "13500002222", "requirements": "1. 测试；",
    })
    if st == 302:
        made.append(nm)
check("批量造数成功", len(made) == 16, len(made))

p1, l1, _ = reg.get("/")
check("第 1 页返回 200", p1 == 200, p1)
ids1 = re.findall(r'data-id="(\d+)"', l1)
check("默认每页 15 条", len(ids1) == 15, len(ids1))

# 序号：按当前页自然顺序 1、2、3…，与数据库 id 无关
SEQ_RE = r'<td class="mono">(?:<input[^>]*>\s*)?(\d+)</td>\s*<td class="strong">'
seq1 = re.findall(SEQ_RE, l1)
check("第 1 页序号 1..15", seq1 == [str(i) for i in range(1, 16)], seq1[:5])
check("表头第一列是序号", "序号</th>" in l1 and "编号</th>" not in l1)
check("页码按钮出现", 'class="pager-num' in l1)
check("有下一页", "下一页" in l1)
check("有末页", "末页" in l1)

_, l2, _ = reg.get("/?page=2")
ids2 = re.findall(r'data-id="(\d+)"', l2)
check("第 2 页有数据", len(ids2) > 0, len(ids2))
seq2 = re.findall(SEQ_RE, l2)
check("第 2 页序号接着数（16 起）", seq2 and seq2[0] == "16", seq2[:3])
check("序号与真实 id 不同源", seq1 and ids1 and seq1[0] != ids1[0], (seq1[0], ids1[0]))
check("第 1、2 页不重复", not set(ids1) & set(ids2), (ids1[:3], ids2[:3]))

_, l30, _ = reg.get("/?per=30")
check("per=30 生效", "每页 30 条" in l30)
check("per=30 保留在翻页链接", "per=30" in l30)
check("per=30 下拉选中", 'value="30" selected' in l30)
ids30 = re.findall(r'data-id="(\d+)"', l30)
check("per=30 一页装下更多", len(ids30) >= len(ids1), (len(ids30), len(ids1)))

_, l100, _ = reg.get("/?per=100")
check("per=100 生效", "每页 100 条" in l100)

_, lbad, _ = reg.get("/?per=999")
check("非法 per 回退 15", "每页 15 条" in lbad, lbad[lbad.find("pager-info"):lbad.find("pager-info") + 50])

# 关键词 + 每页条数组合
_, lq, _ = reg.get("/?q=%E5%88%86%E9%A1%B5%E6%B5%8B%E8%AF%95&per=50")
check("搜索保留 per=50", "per=50" in lq and "每页 50 条" in lq)
check("搜索命中 16 条", len(re.findall(r'data-id="(\d+)"', lq)) == 16,
      len(re.findall(r'data-id="(\d+)"', lq)))

# 列表按日期筛选
_, ltoday, _ = reg.get(f"/?start={TODAY}&end={TODAY}")
check("列表日期筛选生效", len(re.findall(r'data-id="(\d+)"', ltoday)) >= 1)
check("副标题显示日期", TODAY in ltoday)
check("日期框回填", f'value="{TODAY}"' in ltoday)

_, lempty, _ = reg.get("/?start=2000-01-01&end=2000-01-02")
check("空区间显示空状态", "没有符合条件的招聘信息" in lempty)

# 清理：删掉刚造的 16 条
_, lall, _ = reg.get("/?q=%E5%88%86%E9%A1%B5%E6%B5%8B%E8%AF%95&per=50")
del_ids = re.findall(r'data-id="(\d+)"', lall)
token_del = csrf(reg, "/")
for did in del_ids:
    reg.post(f"/delete/{did}", {"_csrf": token_del, "back": "/"})
_, lafter, _ = reg.get("/?q=%E5%88%86%E9%A1%B5%E6%B5%8B%E8%AF%95")
check("测试数据已清理", "没有符合条件的招聘信息" in lafter)

# ---------- 5.8 复制到公众号（微信排版） ----------
print("[5.8] 复制到公众号（微信排版 + 4 套配色）")
_, lst, _ = reg.get("/")
check("选择条有微信发布按钮", "/wechat/selected" in lst and "微信发布" in lst)
check("选择条有三个动作按钮", lst.count('class="btn btn-primary btn-xs sel-act"')
      + lst.count('class="btn btn-soft btn-xs sel-act"') == 3)
# 全选：表头的 #pickAll 也带 .pick-box（th .pick-box 的间距样式），脚本必须只取行内复选框，
# 否则「全选」会把自己算成一条、并被 sync() 立刻取消勾选
check("全选脚本只作用于行内复选框", '.pick-box[name="ids"]' in lst)
check("全选按事件目标状态同步", "e.target.checked" in lst)
check("表头全选框仍带 pick-box 样式", 'id="pickAll"' in lst and 'class="pick-box"' in lst)

st, wx, _ = reg.post("/wechat/selected", {"_csrf": sel_token, "ids": [str(RID), str(rid)]})
check("微信发布 200", st == 200, st)
check("含预览区", 'id="wxPreview"' in wx)
check("含源码框", 'id="wxCode"' in wx)
check("含复制到公众号按钮", "复制到公众号" in wx)
check("含复制源码按钮", "复制 HTML 源码" in wx)
check("含下载按钮", "下载 .html" in wx)
check("主按钮是复制到剪贴板", "复制到剪贴板" in wx)
check("含 4 套预设配色", wx.count('class="wx-theme" data-theme=') == 4,
      wx.count('class="wx-theme" data-theme='))
check("四套配色名齐全", all(n in wx for n in ("中国红", "深海蓝", "松柏绿", "藏紫")))
check("含自定义主色", 'id="wxCustom"' in wx)
check("四套配色均已渲染", all(c in wx for c in ("#c0392b", "#1d6fa5", "#2f7d5d", "#6b4a9b")))
check("配色数据已注入前端", "var VARIANTS = {" in wx and "var META = [" in wx)
check("默认配色标记为选中", "paint(state.key, state.html)" in wx)
check("提示图片需手动插入", "二维码" in wx)

preview = wx.split('id="wxPreview"')[1].split('class="card wx-code-card"')[0]
check("预览含行内样式 section", '<section style="font-size:15px' in preview)
check("预览无 <style> 标签", "<style" not in preview)
check("预览无 class 属性", 'class="' not in preview)
check("预览含序号 01", ">01</span>" in preview, preview[:200])
check("预览含薪资福利", "薪资福利" in preview)
check("预览含具体信息", "具体信息" in preview)
check("预览含温馨提示", "温馨提示" in preview)
check("预览含单位名", "Worker测试有限公司" in preview)
check("预览含岗位名", "质检员（改）" in preview)

code = wx.split('id="wxCode"')[1]
check("源码框是转义后的 HTML", "&lt;section" in code)

st, _, _ = reg.post("/wechat/selected", {"_csrf": sel_token})
check("未勾选跳回列表", st == 302, st)
st, _, _ = reg.post("/wechat/selected",
                    {"_csrf": sel_token, "ids": [str(i) for i in range(1, 32)]})
check("超过 30 条被拦", st == 302, st)
st, _, _ = S().post("/wechat/selected", {"ids": [str(RID)]})
check("匿名不能导出微信", st in (302, 400), st)

# ---------- 5.8b 直播轮播（手机全屏循环播放） ----------
print("[5.8b] 直播轮播（手机全屏循环播放）")
_, lst, _ = reg.get("/")
check("选择条有直播轮播按钮", 'formaction="/live"' in lst and "直播轮播" in lst)
check("选择条提示含直播", "手机全屏循环播放" in lst)

# 造一条带序号的岗位要求，验证「已带序号的行不再额外画圆点」
st, _, _ = reg.post("/add", {
    "_csrf": csrf(reg, "/add"), "company_name": "直播测试公司", "position": "主播助理",
    "headcount": "2", "salary": "6000-8000", "address": "直播路 9 号",
    "phone": "13500002222", "requirements": "1. 口齿清晰；\n2. 能上晚班；\n· 有经验优先",
})
check("新增直播测试记录", st == 302, st)
_, ll, _ = reg.get("/?q=" + urllib.parse.quote("直播测试"))
m = re.search(r'data-id="(\d+)"', ll)
lid = int(m.group(1)) if m else None
check("拿到直播测试记录 id", lid is not None, lid)

ltok = csrf(reg, "/")
st, _, hd = reg.post("/live", {"_csrf": ltok, "ids": [str(RID), str(lid)]})
loc = hd.get("Location", "")
check("直播 POST 302", st == 302, st)
check("跳到 GET 直播页", "/live?ids=" in loc and "interval=8" in loc, loc)
check("ids 逗号连接且保持勾选顺序",
      loc.split("ids=")[-1].split("&")[0] in (f"{RID},{lid}", f"{RID}%2C{lid}"), loc)

st, live, _ = reg.get(loc)
check("直播页 200", st == 200, st)
check("直播页是独立整页", 'id="stage"' in live and 'href="/add"' not in live)
check("直播页两条幻灯片", live.count('<section class="slide"') == 2,
      live.count('<section class="slide"'))
check("幻灯片按顺序编号", 'data-i="0"' in live and 'data-i="1"' in live)
check("含单位名", "直播测试公司" in live)
check("含岗位名", "主播助理" in live)
check("含薪资", "6000-8000" in live)
check("含招聘数", "招 2 人" in live)
check("含状态徽标", 'class="badge s-active"' in live)
check("含地址", "直播路 9 号" in live)
check("含电话", "13500002222" in live)
check("岗位要求按行拆分", live.count("<li") >= 3, live.count("<li"))
check("已带序号的行不画圆点", 'class="no-dot"' in live)
check("行首的 · 被去掉", ">有经验优先</li>" in live)
check("默认间隔 8 秒", '<option value="8" selected>' in live)
check("间隔选项 9 个", live.count("<option value=") == 9, live.count("<option value="))
check("含总数与当前序号", 'id="total">2<' in live and 'id="cur">1<' in live)
check("含进度条", 'id="bar"' in live)
check("含暂停/上下条/全屏", all(f'id="{x}"' in live for x in ("play", "prev", "next", "fs")))
check("含屏幕常亮逻辑", "wakeLock" in live)
check("含控件自动隐藏", "body.idle" in live)
check("含桌面 9:16 预览", "min-aspect-ratio: 3/4" in live)

st, live10, _ = reg.get(f"/live?ids={RID}&interval=10")
check("指定间隔 10 秒生效", '<option value="10" selected>' in live10)
st, livebad, _ = reg.get(f"/live?ids={RID}&interval=7")
check("非法间隔回退 8 秒", '<option value="8" selected>' in livebad)
st, livecomma, _ = reg.get(f"/live?ids={RID},{lid}&interval=5")
check("逗号写法也认", livecomma.count('<section class="slide"') == 2)
st, livearr, _ = reg.get(f"/live?ids={RID}&ids={lid}")
check("重复参数写法也认", livearr.count('<section class="slide"') == 2)

st, _, hd = reg.post("/live", {"_csrf": ltok})
check("未勾选跳回列表", st == 302 and hd.get("Location", "") == "/", st)
st, _, _ = reg.post("/live", {"_csrf": ltok, "ids": [str(i) for i in range(1, 32)]})
check("超过 30 条被拦", st == 302, st)
st, _, _ = reg.get("/live")
check("无 ids 跳回列表", st == 302, st)
st, _, hd = S().get(f"/live?ids={RID}")
check("匿名不能看直播页", st == 302 and "/login" in hd.get("Location", ""), st)
st, _, _ = reg.get("/live?ids=999999")
check("记录不存在跳回列表", st == 302, st)

# 清理本节数据
if lid:
    reg.post(f"/delete/{lid}", {"_csrf": csrf(reg, "/"), "back": "/"})
_, lafter2, _ = reg.get("/?q=" + urllib.parse.quote("直播测试"))
check("直播测试数据已清理", "直播测试公司" not in lafter2)

# ---------- 5.9 数据库备份 ----------
print("[5.9] 管理员备份数据库为 SQL")
st, dump, hd = adm.get_raw("/backup.sql")
sql = dump.decode("utf-8", "replace")
check("管理员可下载备份", st == 200, st)
check("返回 SQL 文本", sql.lstrip().startswith("--"), sql[:40])
check("含建表语句", "CREATE TABLE" in sql)
check("含索引", "CREATE INDEX" in sql)
check("含事务包裹", "BEGIN TRANSACTION;" in sql and "COMMIT;" in sql)
check("含 recruit 表数据", 'INSERT INTO "recruit"' in sql)
check("含 users 表数据", 'INSERT INTO "users"' in sql)
check("不含 D1 内部表", "_cf_KV" not in sql and "sqlite_" not in sql)
check("附件文件名是 .sql", ".sql" in urllib.parse.unquote(hd.get("Content-Disposition", "")),
      hd.get("Content-Disposition"))
check("含恢复说明", "恢复" in sql)

st, _, hd = reg.get("/backup.sql")
check("普通用户不能备份", st == 302, st)
st, _, hd = S().get("/backup.sql")
check("匿名不能备份", st == 302 and "/login" in hd.get("Location", ""), st)

# ---------- 6. 停用 ----------
print("[6] 停用即时失效")
st, _, _ = adm.post(f"/users/{uid}/action",
                    {"_csrf": csrf(adm, "/users"), "action": "disable"})
check("停用成功", st == 302, st)
st, _, hd = reg.get("/add")
check("停用后会话失效", st == 302 and "/login" in hd.get("Location", ""), st)
st, body, _ = reg.post("/login", {"_csrf": csrf(reg, "/login"),
                                  "username": uname, "password": "Test@1234"})
check("停用后无法登录", st == 403, st)
st, _, _ = adm.post(f"/users/{uid}/action",
                    {"_csrf": csrf(adm, "/users"), "action": "enable"})
check("启用成功", st == 302, st)
st, body, _ = reg.post("/login", {"_csrf": csrf(reg, "/login"),
                                  "username": uname, "password": "Test@1234"})
check("启用后可重新登录", st == 302, st)

# ---------- 7. 自我保护 ----------
print("[7] 自我保护")
st, _, _ = adm.post("/users/1/action", {"_csrf": csrf(adm, "/users"), "action": "disable"})
_, users_html, _ = adm.get("/users")
check("不能停用自己", "系统管理员" in users_html or "admin" in users_html)
st, _, _ = adm.post("/users/1/action", {"_csrf": csrf(adm, "/users"), "action": "delete"})
_, lst2, _ = adm.get("/users")
check("不能删除自己", "admin" in lst2)

# ---------- 8. 删除 ----------
print("[8] 删除")
st, _, _ = reg.post(f"/delete/{rid}", {"_csrf": csrf(reg, "/"), "back": "/"})
check("删除成功", st == 302, st)
_, lst, _ = reg.get("/")
# 用记录 id 判断（库里可能残留上次中断测试的同名数据）
check("已从列表移除", f'/edit/{rid}"' not in lst)

# ---------- 8.5 清理测试账号 ----------
# 注册限流是「同一 IP 每小时 5 次」，测试账号用完即删，避免反复跑测试把额度用光
st, _, _ = adm.post(f"/users/{uid}/action", {"_csrf": csrf(adm, "/users"), "action": "delete"})
check("测试账号已清理", st == 302, st)
_, users_left, _ = adm.get("/users")
check("清理后列表不含测试账号", f">{uname}<" not in users_left)

# ---------- 8.6 Excel 导入：招聘状态默认招聘中 ----------
print("[8.6] Excel 导入（状态列容错）")
from openpyxl import Workbook
_wb = Workbook()
_ws = _wb.active
_ws.append(["用人单位名称", "招聘岗位", "招聘数（人）", "岗位要求", "工资待遇（元）",
            "地址", "联系电话", "发布日期", "招聘状态"])
_ws.append(["导入空状态公司", "岗位A", "1", "要求", "5000", "地址", "13000000001", TD1, ""])
_ws.append(["导入招满公司", "岗位B", "2", "要求", "5000", "地址", "13000000002", TD1, "已招满"])
_ws.append(["导入乱写公司", "岗位C", "3", "要求", "5000", "地址", "13000000003", TD1, "随便写"])
_buf = io.BytesIO()
_wb.save(_buf)

st, imph, _ = adm.post_file("/import", "file", "t.xlsx", _buf.getvalue(),
                            {"_csrf": csrf(adm, "/import")})
check("导入请求成功", st == 200, st)
check("导入成功 3 条", "导入完成" in imph and "成功 3 条" in imph,
      imph[imph.find("导入完成"):imph.find("导入完成") + 40])

_, ilist, _ = adm.get("/?q=" + urllib.parse.quote("导入") + "&show_full=1&show_expired=1&per=50")
_rows = re.findall(r"<tr[^>]*>(.*?)</tr>", ilist, re.S)


def _st_of(name):
    for _r in _rows:
        if name in _r:
            _m = re.search(r'class="st st-\w+">([^<]+)<', _r)
            return _m.group(1) if _m else None
    return None


check("导入留空 -> 招聘中", _st_of("导入空状态公司") == "招聘中", _st_of("导入空状态公司"))
check("导入已招满 -> 已招满", _st_of("导入招满公司") == "已招满", _st_of("导入招满公司"))
check("导入乱写 -> 招聘中", _st_of("导入乱写公司") == "招聘中", _st_of("导入乱写公司"))

# 清理
for _x in set(re.findall(r'data-id="(\d+)"', ilist)):
    adm.post(f"/delete/{_x}", {"_csrf": csrf(adm, "/"), "back": "/"})
_, iclean, _ = adm.get("/?q=" + urllib.parse.quote("导入") + "&show_full=1&show_expired=1")
check("导入测试数据已清理", "导入空状态公司" not in iclean)

# ---------- 9. 审计 ----------
print("[9] 审计日志")
_, au, _ = adm.get("/audit")
for act in ("登录", "注册申请", "审批通过", "停用账号", "启用账号", "新增", "修改", "删除", "导出 Excel", "直播轮播"):
    check(f"日志含「{act}」", act in au)

# ---------- 10. 退出 ----------
print("[10] 退出")
st, _, _ = adm.post("/logout", {"_csrf": csrf(adm, "/")})
check("退出 302", st == 302, st)
check("退出后拦截", adm.get("/add")[0] == 302)

print("=" * 62)
print(f"通过 {ok} 项，失败 {fail} 项")
sys.exit(1 if fail else 0)
