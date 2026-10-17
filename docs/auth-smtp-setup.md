# 认证邮件配置（Clerk + Resend）

本系统的注册/登录验证码由 **Clerk 生成**，但通过 **Resend 的 SMTP relay** 投递，
所以用户收到的验证码邮件 From 是 `udify.fun`，而不是 `clerk.dev`。

> 流程链路：用户输入邮箱 → Clerk 生成 6 位验证码 → Clerk 经 Custom SMTP →
> `smtp.resend.com`（Resend）→ 用户收件箱

## 前置：系统已完成的工作（代码侧）

- `/sign-up` / `/sign-in` 页面（Clerk 托管 UI，含邮箱验证码步骤）
- `/api/webhooks/clerk` — 首个注册用户自动成为管理员
- `/admin` — 功能开关 + 用户管理后台
- 角色守卫 `src/lib/auth/roles.ts`、后端客户端 `src/lib/auth/clerk-client.ts`

下面这些只能在你自己的 Dashboard / DNS 里手动配置，代码无法替你完成。

---

## 1. Clerk：填入 API Key

`.env`（本地）和部署环境变量（生产）都要有：

```
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_test_xxx   # 或 pk_live_xxx
CLERK_SECRET_KEY=sk_test_xxx
CLERK_WEBHOOK_SIGNING_SECRET=whsec_xxx
```

`isValidClerkKey` 为 true 后，14 个 API 路由的 `auth()` 守卫才会真正生效，
`/sign-in` `/sign-up` 才会渲染真实登录表单（否则走 dev-user 旁路）。

## 2. Clerk：开启邮箱验证码（email_code）

Clerk Dashboard → **User & Authentication → Email, Phone, Username**：
1. 确认 Email 地址已作为登录方式启用。
2. **Verification** 策略选 **Email verification code (6-digit)** —— 这就是
   用户「收到验证码后填入」的形态。不要选 Email link（那是魔法链接）。

## 3. Resend：创建 API Key 与发件域

1. 注册 [resend.com](https://resend.com)，创建 API Key（`re_xxx`）。
2. **Domains → Add Domain** → 填 `udify.fun`。
   > 现状（2026-08-01）：免费计划每个账号仅 1 个域名；`udify.fun` 已在 Resend
   > 添加并 **Verified**，3 条 DNS 记录（DKIM TXT / `send` MX / `send` SPF TXT）
   > 已写入 Cloudflare。**所以本节 DNS 工作已完成，可直接跳到第 4 节。**
3. Resend 会给你 **3 条 DNS 记录**（DKIM TXT 1 条、`send` 子域 MX + SPF TXT 各 1 条）
   —— 全部加到 `udify.fun` 的 DNS 服务商（本项目用 Cloudflare）。
4. 等待 Resend 显示 **Verified**（通常几分钟到几小时）。

> ⚠️ 不要试图把发件域做成子域 `nanosparks.udify.fun`：免费计划加不了第二个域
> （Resend 会 403 `Your plan includes 1 domain`），子域也不会继承 apex 的
> DKIM/SPF。直接用 `udify.fun` 即可。

## 4. Clerk：Custom SMTP 指向 Resend（关键一步）

Clerk Dashboard → **Emails & SMS → SMTP**（或 Settings → Email delivery）：
1. 启用 **Custom SMTP server**。
2. 填入 Resend 的 SMTP 参数：

   | 字段 | 值 |
   |------|----|
   | Host | `smtp.resend.com` |
   | Port | `465`（SSL）或 `587`（STARTTLS） |
   | Username | `resend` |
   | Password | 你的 Resend API Key（`re_xxx`） |
   | From email | `noreply@udify.fun` |

3. Clerk 会发一封测试邮件验证连通。从这之后，所有 Clerk 验证码邮件都从
   `udify.fun` 发出，不再带 clerk.dev 标记。

## 5. Clerk：配置 Webhook（首个用户 = 管理员）

Clerk Dashboard → **Webhooks → Add Endpoint**：
1. Endpoint URL：`https://nanosparks.udify.fun/api/webhooks/clerk`
2. 订阅事件：至少勾 **user.created**（角色分配靠它）。
3. 创建后复制 **Signing Secret**（`whsec_xxx`）→ 填到 `CLERK_WEBHOOK_SIGNING_SECRET`。

验证：注册第一个账号后，查 Clerk 该用户的 `publicMetadata.role` 应为 `admin`，
或调 `/api/admin/users` 看到该用户 role=admin。

---

## 验收检查清单

- [ ] `.env` 里 4 个 Clerk/Resend 变量全部填实
- [ ] Clerk 邮箱验证策略 = Email verification code
- [x] Resend 域名 `udify.fun` 显示 Verified（2026-08-01 确认，DKIM / `send` MX / `send` SPF 已写入 Cloudflare）
- [ ] Clerk Custom SMTP 指向 `smtp.resend.com`，From = `noreply@udify.fun`
- [ ] Clerk Webhook 订阅 user.created，指向 `/api/webhooks/clerk`
      （应用访问地址仍是 `https://nanosparks.udify.fun`，那是网站域名，与邮件发件域无关）
- [ ] 注册第一个账号 → 该用户 publicMetadata.role = admin → 能访问 `/admin`
- [x] 验证码邮件 From 域名 = `udify.fun`（不是 clerk.dev）
      —— DNS 侧已就绪并实测发件成功；最终 From 域名由 Clerk Custom SMTP 的 From email 决定
