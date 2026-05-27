async function verifyPassword(password, env) {
  try {
    const row = await env.DB.prepare("SELECT value FROM config WHERE key = 'admin_password'").first();
    if (row && row.value) return password === row.value;
  } catch (e) {}
  return password === env.ADMIN_PASSWORD;
}

export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);

  // 1. GET：支持搜索与分类筛选
  if (request.method === "GET") {
    try {
      const q = url.searchParams.get("q");
      const category = url.searchParams.get("category");

      let query = "SELECT id, title, summary, date, views, category FROM posts";
      let params = [];
      let conditions = [];

      if (q) {
        conditions.push("(title LIKE ? OR summary LIKE ?)");
        params.push(`%${q}%`, `%${q}%`);
      }
      if (category) {
        conditions.push("category = ?");
        params.push(category);
      }

      if (conditions.length > 0) {
        query += " WHERE " + conditions.join(" AND ");
      }
      query += " ORDER BY date DESC";

      const { results } = await env.DB.prepare(query).bind(...params).all();
      return new Response(JSON.stringify(results), { headers: { "Content-Type": "application/json" } });
    } catch (err) {
      return new Response(err.message, { status: 500 });
    }
  }

  // 2. POST：保存包含分类的文章
  if (request.method === "POST") {
    const authHeader = request.headers.get("Authorization");
    if (!(await verifyPassword(authHeader, env))) {
      return new Response("Unauthorized", { status: 401 });
    }

    try {
      const { id, title, summary, content, date, category } = await request.json();

      await env.MY_BUCKET.put(`posts/${id}.md`, content, {
        httpMetadata: { contentType: "text/markdown; charset=utf-8" }
      });

      await env.DB.prepare(`
        INSERT INTO posts (id, title, summary, date, category, views) VALUES (?, ?, ?, ?, ?, 0)
        ON CONFLICT(id) DO UPDATE SET title = ?, summary = ?, category = ?
      `).bind(id, title, summary, date, category || '未分类', title, summary, category || '未分类').run();

      return new Response(JSON.stringify({ success: true }), { headers: { "Content-Type": "application/json" } });
    } catch (err) {
      return new Response(err.message, { status: 500 });
    }
  }

  return new Response("Method not allowed", { status: 405 });
}
