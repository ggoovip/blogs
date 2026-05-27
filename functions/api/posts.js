export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);

  // 1. GET 请求：获取文章列表
  if (request.method === "GET") {
    try {
      const { results } = await env.DB.prepare(
        "SELECT id, title, summary, date, views FROM posts ORDER BY date DESC"
      ).all();
      return new Response(JSON.stringify(results), {
        headers: { "Content-Type": "application/json" }
      });
    } catch (err) {
      return new Response(err.message, { status: 500 });
    }
  }

  // 2. POST 请求：发布或更新文章
  if (request.method === "POST") {
    const authHeader = request.headers.get("Authorization");
    if (authHeader !== env.ADMIN_PASSWORD) {
      return new Response("Unauthorized", { status: 401 });
    }

    try {
      const { id, title, summary, content, date } = await request.json();

      // A. 将 Markdown 文本直接存入 R2 存储桶（存放在 posts/ 虚拟目录下）
      await env.MY_BUCKET.put(`posts/${id}.md`, content, {
        httpMetadata: { contentType: "text/markdown; charset=utf-8" }
      });

      // B. 将元数据存入 D1 数据库 (若已存在则更新，若不存在则插入)
      await env.DB.prepare(`
        INSERT INTO posts (id, title, summary, date, views) 
        VALUES (?, ?, ?, ?, 0)
        ON CONFLICT(id) DO UPDATE SET title = ?, summary = ?
      `).bind(id, title, summary, date, title, summary).run();

      return new Response(JSON.stringify({ success: true }), {
        headers: { "Content-Type": "application/json" }
      });
    } catch (err) {
      return new Response(err.message, { status: 500 });
    }
  }

  return new Response("Method not allowed", { status: 405 });
}
