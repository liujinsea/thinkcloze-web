# 新托福阅读填空仿真考试

这是一个纯静态网页版本，直接用 GitHub Pages 发布即可，不需要安装依赖。

## 发布方式

1. 把本文件夹上传到一个 GitHub repository。
2. 确认 `index.html` 在仓库根目录。
3. 在 GitHub 仓库中进入 `Settings` -> `Pages`。
4. `Source` 选择 `Deploy from a branch`。
5. Branch 选择 `main`，Folder 选择 `/root`。
6. 保存后等待 GitHub 生成网址。

## 文件说明

- `index.html`: 网站入口，也是学生实际做题页面。
- `新托福填空题_电脑端模拟考试_仿真版.html`: 本地仿真版备份。
- `新托福填空题_题目版.docx`: 纸质题目版。
- `新托福填空题_逐空解析版.docx`: 教师逐空解析版。
- `新托福填空题_答案版.docx`: 答案版。
- `.env.example`: Supabase 环境变量示例。
- `scripts/build-config.js`: 根据 `.env` 或 Vercel 环境变量生成 `config.js`。
- `supabase/schema.sql`: Supabase 数据表、RLS 策略和触发器 SQL。
- `vercel.json`: Vercel 静态部署配置。

## 使用提示

学生进入网页后先看到 `Complete the Words` 首页。点击 `Set 1` 到 `Set 20` 中任意按钮进入单篇练习；每个 Set 独立计时。点击 `Submit` 后显示该 Set 的答案与解析，点击 `Return` 回到首页。

完成 `Set 1` 到 `Set 20` 后，首页底部会显示解锁入口。未注册时点击入口会进入注册/登录页；注册或登录后即可完成邮箱解锁流程。注册和登录现已通过 Supabase Auth 处理，提交记录会同步到 Supabase 数据库。

## Supabase 设置

本项目已接入 Supabase Auth 和答题记录保存。浏览器端只使用 publishable key，不要填写 service_role key。

1. 复制 `.env.example` 为 `.env`。
2. 在 `.env` 中填写：
   - `SUPABASE_URL`
   - `SUPABASE_PUBLISHABLE_KEY`
3. 打开 Supabase 控制台，进入 `SQL Editor`。
4. 运行 `supabase/schema.sql` 中的全部 SQL，创建：
   - `profiles`
   - `set_submissions`
   - `blank_answer_records`
5. 如果希望注册成功后立刻保持登录，请在 Supabase Auth 设置中关闭 email confirmation；如果开启邮箱验证，用户需要先完成邮件确认。

## 本地测试

```bash
npm.cmd run build
python -m http.server 8000
```

然后访问 `http://localhost:8000`。如果 PowerShell 允许直接运行 npm，也可以用 `npm run build`。提交 Set 后，如果用户尚未登录，记录会先保存在本地待同步队列；登录后会自动同步到 Supabase。

## Vercel 部署

在 Vercel 项目设置中添加环境变量：

- `SUPABASE_URL`
- `SUPABASE_PUBLISHABLE_KEY`

项目已包含 `vercel.json`，Vercel 会运行 `npm run build` 并生成 `config.js`。部署完成后，Supabase Auth 的 URL 设置中需要加入你的 Vercel 域名。
