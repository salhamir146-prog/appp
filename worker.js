export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // مدیریت درخواست‌های API
    if (url.pathname.startsWith('/api/')) {
      return handleApi(request, env, url);
    }

    // نمایش فایل‌های استاتیک
    try {
      let response = await env.ASSETS.fetch(request);
      if (response.status === 404 && !url.pathname.includes('.')) {
        return env.ASSETS.fetch(new Request(new URL('/', request.url), request));
      }
      return response;
    } catch (e) {
      return new Response("Not Found", { status: 404 });
    }
  }
};

async function handleApi(request, env, url) {
  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };

  if (request.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const db = env.DB;

    // ===== ۱. ارسال کد تایید =====
    if (url.pathname === "/api/send-code" && request.method === "POST") {
      const { phone } = await request.json();
      if (!phone) {
        return new Response(JSON.stringify({ success: false, message: "شماره موبایل وارد نشده است" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }

      const code = Math.floor(1000 + Math.random() * 9000).toString();
      await env.TELEGRAM_KV.put(`otp:${phone}`, code, { expirationTtl: 300 });

      // ارسال پیامک (در صورت وجود API Key)
      if (env.SMS_IR_API_KEY) {
        try {
          const smsResponse = await fetch("https://api.sms.ir/v1/send/verify", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "X-API-KEY": env.SMS_IR_API_KEY
            },
            body: JSON.stringify({
              Mobile: phone,
              TemplateId: Number(env.SMS_IR_TEMPLATE_ID || 828739),
              Parameters: [{ Name: "OTP", Value: code }]
            })
          });
          const smsResult = await smsResponse.json();
          console.log('SMS result:', smsResult);
        } catch (smsError) {
          console.error('SMS error:', smsError);
          // ادامه بده حتی اگر پیامک ارسال نشد
        }
      }

      return new Response(JSON.stringify({ success: true, message: "کد تایید با موفقیت ارسال شد" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    // ===== ۲. تایید کد و ثبت/ورود کاربر =====
    if (url.pathname === "/api/verify-code" && request.method === "POST") {
      const { phone, code } = await request.json();
      const savedCode = await env.TELEGRAM_KV.get(`otp:${phone}`);

      if (!savedCode || savedCode !== code) {
        return new Response(JSON.stringify({ success: false, message: "کد تایید نامعتبر یا منقضی شده است" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }

      await env.TELEGRAM_KV.delete(`otp:${phone}`);

      // ثبت یا ورود کاربر در D1
      let user = await db.prepare(
        "SELECT * FROM users WHERE phone = ?"
      ).bind(phone).first();

      if (!user) {
        const result = await db.prepare(
          `INSERT INTO users (phone, name, created_at) VALUES (?, ?, ?)`
        ).bind(phone, `کاربر ${phone.slice(-4)}`, Date.now()).run();
        
        user = await db.prepare(
          "SELECT * FROM users WHERE phone = ?"
        ).bind(phone).first();
      }

      // ایجاد نشست (Session) در KV
      const sessionToken = crypto.randomUUID();
      await env.TELEGRAM_KV.put(`session:${sessionToken}`, phone, { expirationTtl: 86400 * 7 });

      return new Response(JSON.stringify({ 
        success: true, 
        message: "ورود با موفقیت انجام شد",
        user: user,
        token: sessionToken
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    // ===== ۳. ارسال پیام =====
    if (url.pathname === "/api/send-message" && request.method === "POST") {
      const { chatId, senderId, text, type = "text", fileKey = null } = await request.json();

      if (!chatId || !senderId) {
        return new Response(JSON.stringify({ success: false, message: "اطلاعات ناقص است" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }

      const result = await db.prepare(
        `INSERT INTO messages (chat_id, sender_id, text, type, file_key, created_at) 
         VALUES (?, ?, ?, ?, ?, ?)`
      ).bind(chatId, senderId, text || "", type, fileKey, Date.now()).run();

      return new Response(JSON.stringify({ 
        success: true, 
        message: "پیام ارسال شد",
        id: result.meta.last_row_id
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    // ===== ۴. دریافت پیام‌های یک چت =====
    if (url.pathname === "/api/get-messages" && request.method === "GET") {
      const chatId = url.searchParams.get('chatId');
      const limit = parseInt(url.searchParams.get('limit')) || 50;

      if (!chatId) {
        return new Response(JSON.stringify({ success: false, message: "chatId مشخص نشده" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }

      const messages = await db.prepare(
        `SELECT m.*, u.name as sender_name 
         FROM messages m
         LEFT JOIN users u ON m.sender_id = u.id
         WHERE m.chat_id = ? 
         ORDER BY m.created_at DESC 
         LIMIT ?`
      ).bind(chatId, limit).all();

      return new Response(JSON.stringify({ 
        success: true, 
        messages: messages.results 
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    // ===== ۵. دریافت لیست چت‌های کاربر =====
    if (url.pathname === "/api/get-chats" && request.method === "GET") {
      const userId = url.searchParams.get('userId');

      if (!userId) {
        return new Response(JSON.stringify({ success: false, message: "userId مشخص نشده" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }

      const chats = await db.prepare(
        `SELECT cm.chat_id, 
                (SELECT COUNT(*) FROM messages WHERE chat_id = cm.chat_id) as message_count,
                (SELECT text FROM messages WHERE chat_id = cm.chat_id ORDER BY created_at DESC LIMIT 1) as last_message
         FROM chat_members cm
         WHERE cm.user_id = ?`
      ).bind(userId).all();

      return new Response(JSON.stringify({ 
        success: true, 
        chats: chats.results 
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    // ===== ۶. ایجاد چت جدید =====
    if (url.pathname === "/api/create-chat" && request.method === "POST") {
      const { chatId, userIds } = await request.json();

      if (!chatId || !userIds || !Array.isArray(userIds)) {
        return new Response(JSON.stringify({ success: false, message: "اطلاعات ناقص است" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }

      for (const userId of userIds) {
        await db.prepare(
          `INSERT OR IGNORE INTO chat_members (chat_id, user_id, joined_at) VALUES (?, ?, ?)`
        ).bind(chatId, userId, Date.now()).run();
      }

      return new Response(JSON.stringify({ 
        success: true, 
        message: "چت ایجاد شد" 
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    // ===== ۷. دریافت اطلاعات کاربر =====
    if (url.pathname === "/api/get-user" && request.method === "GET") {
      const userId = url.searchParams.get('userId');

      if (!userId) {
        return new Response(JSON.stringify({ success: false, message: "userId مشخص نشده" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }

      const user = await db.prepare(
        "SELECT id, phone, name, avatar_url, created_at FROM users WHERE id = ?"
      ).bind(userId).first();

      if (!user) {
        return new Response(JSON.stringify({ success: false, message: "کاربر یافت نشد" }), {
          status: 404,
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }

      return new Response(JSON.stringify({ 
        success: true, 
        user: user
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    // ===== ۸. جستجوی کاربران =====
    if (url.pathname === "/api/search-users" && request.method === "GET") {
      const query = url.searchParams.get('q') || '';

      const users = await db.prepare(
        `SELECT id, phone, name, avatar_url 
         FROM users 
         WHERE name LIKE ? OR phone LIKE ? 
         LIMIT 20`
      ).bind(`%${query}%`, `%${query}%`).all();

      return new Response(JSON.stringify({ 
        success: true, 
        users: users.results 
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    // ===== ۹. به‌روزرسانی کاربر =====
    if (url.pathname === "/api/update-user" && request.method === "POST") {
      const { userId, name, username, bio } = await request.json();

      await db.prepare(
        `UPDATE users SET name = ?, username = ?, bio = ? WHERE id = ?`
      ).bind(name || '', username || '', bio || '', userId).run();

      return new Response(JSON.stringify({ success: true, message: "پروفایل به‌روز شد" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    // ===== ۱۰. آپلود عکس پروفایل =====
    if (url.pathname === "/api/upload-avatar" && request.method === "POST") {
      try {
        const formData = await request.formData();
        const file = formData.get('avatar');
        const userId = formData.get('userId');

        if (!file || !userId) {
          return new Response(JSON.stringify({ success: false, message: "اطلاعات ناقص است" }), {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" }
          });
        }

        const arrayBuffer = await file.arrayBuffer();
        const base64 = btoa(String.fromCharCode(...new Uint8Array(arrayBuffer)));
        
        await env.TELEGRAM_KV.put(`avatar:${userId}`, base64, { expirationTtl: 86400 * 30 });

        return new Response(JSON.stringify({ success: true, message: "عکس آپلود شد" }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      } catch (err) {
        return new Response(JSON.stringify({ success: false, message: "خطا در آپلود", error: err.message }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }
    }

    // ===== ۱۱. مسیر پیش‌فرض (NotFound) =====
    return new Response(JSON.stringify({ success: false, message: "مسیر یافت نشد" }), {
      status: 404,
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });

  } catch (err) {
    return new Response(JSON.stringify({ success: false, message: "خطای سرور", error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  }
}
