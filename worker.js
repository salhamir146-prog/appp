export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    };

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }

    // ارسال پیام جدید
    if (url.pathname === "/api/send-message" && request.method === "POST") {
      try {
        const data = await request.json();
        const chatId = data.chatId;
        const message = {
          sender: data.sender,
          text: data.text,
          timestamp: Date.now()
        };

        // گرفتن پیام‌های قبلی از KV
        let messages = JSON.parse(await env.TELEGRAM_KV.get(`chat:${chatId}`) || "[]");
        messages.push(message);

        // ذخیره مجدد در KV
        await env.TELEGRAM_KV.put(`chat:${chatId}`, JSON.stringify(messages));

        return new Response(JSON.stringify({ success: true, message }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      } catch (err) {
        return new Response(JSON.stringify({ success: false, error: err.message }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }
    }

    // دریافت پیام‌های یک چت
    if (url.pathname.startsWith("/api/get-messages/")) {
      const chatId = url.pathname.split("/")[3];
      const messages = await env.TELEGRAM_KV.get(`chat:${chatId}`) || "[]";
      
      return new Response(messages, {
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    return new Response("Telegram Cloudflare Backend Running!", { headers: corsHeaders });
  }
};