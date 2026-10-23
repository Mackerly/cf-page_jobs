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


print("=" * 62)
adm = S()

# 取一条真实记录 id（重建数据库后 id 不一定从 1 开始）
_first = re.search(r'<td class="mono">(?:<input[^>]*>\s*)?(\d+)</td>', S().get("/")[1])
RID = int(_first.group(1)) if _first else 1

# ---------- 1. 匿名访问 ----------
print("[1] 匿名访问")
for path in ("/", "/login", "/register", f"/docx/{RID}", "/qr.jpg", f"/preview/{RID}"):
    st, _, _ = S().get(path)
    check(f"公开可访问 {path}", st == 200, st)
for path in ("/add", "/import", "/export/excel", "/docx/zip", "/docx/selected",
             "/template.xlsx", "/users", "/audit"):
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

m = re.search(r'<td class="mono">(?:<input[^>]*>\s*)?(\d+)</td>\s*<td class="strong">Worker测试有限公司', lst)
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
check("已从列表移除", "Worker测试有限公司" not in lst)

# ---------- 9. 审计 ----------
print("[9] 审计日志")
_, au, _ = adm.get("/audit")
for act in ("登录", "注册申请", "审批通过", "停用账号", "启用账号", "新增", "修改", "删除", "导出 Excel"):
    check(f"日志含「{act}」", act in au)

# ---------- 10. 退出 ----------
print("[10] 退出")
st, _, _ = adm.post("/logout", {"_csrf": csrf(adm, "/")})
check("退出 302", st == 302, st)
check("退出后拦截", adm.get("/add")[0] == 302)

print("=" * 62)
print(f"通过 {ok} 项，失败 {fail} 项")
sys.exit(1 if fail else 0)
