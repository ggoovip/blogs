async function verifyPassword(password, env) {
  try {
    const row = await env.DB.prepare("SELECT value FROM config WHERE key = 'admin_password'").first();
    if (row && row.value) return password === row.value;
  } catch (e) {}
  return password === env.ADMIN_PASSWORD;
}

export async function onRequestPost(context) {
  const { request, env } = context;
  const authHeader = request.headers.get("Authorization");

  if (!(await verifyPassword(authHeader, env))) {
    return new Response("Unauthorized", { status: 401 });
  }

  try {
    const { id } = await request.json();

    // === 【核心逻辑：自动清理图片】===
    // A. 尝试从 R2 获取原 Markdown 文本内容
    const mdKey = `posts/${id}.md`;
    const r2Object = await env.MY_BUCKET.get(mdKey);
    
    if (r2Object) {
      const mdText = await r2Object.text();
      // 正则表达式匹配：该文章内引用的所有属于您 R2 自定义域名的图片文件名
      const r2DomainEscaped = env.R2_CUSTOM_DOMAIN.replace(/\./g, '\\.');
      const imgRegex = new RegExp(`https://${r2DomainEscaped}/([^\\)\\s\\?]+)`, "g");
      
      let match;
      while ((match = imgRegex.exec(mdText)) !== null) {
        const fileName = match[1];
        // 排除存储在虚拟目录 posts/ 下的文章本身，只删除直接上传在根目录的图片对象
        if (fileName && !fileName.startsWith("posts/")) {
          await env.MY_BUCKET.delete(fileName); // 从 R2 物理销毁图片
        }
      }
    }

    // B. 从 R2 删除 Markdown 文章文件本身
    await env.MY_BUCKET.delete(mdKey);

    // C. 从 D1 数据库删除索引元数据
    await env.DB.prepare("DELETE FROM posts WHERE id = ?").bind(id).run();

    return new Response(JSON.stringify({ success: true }), { headers: { 'Content-Type': 'application/json' } });

  } catch (err) {
    return new Response(err.message, { status: 500 });
  }
}
