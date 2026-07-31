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

    // مرحله ۱: ارسال کد تایید واقعی از طریق sms.ir
    if (url.pathname === "/api/send-code" && request.method === "POST") {
      try {
        const { phone } = await request.json();
        const verificationCode = Math.floor(10000 + Math.random() * 90000).toString();

        // ذخیره کد در Cloudflare KV برای اعتبارسنجی (انقضا بعد از ۵ دقیقه)
        await env.TELEGRAM_KV.put(`code:${phone}`, verificationCode, { expirationTtl: 300 });

        // درخواست به وب‌سرویس sms.ir
        const smsResponse = await fetch("https://api.sms.ir/v1/send/verify", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-API-KEY": env.SMS_IR_API_KEY // این کلید را به صورت Secret در کلودفلر ست کنید
          },
          body: JSON.stringify({
            mobile: phone,
            templateId: parseInt(env.SMS_IR_TEMPLATE_ID),
            parameters: [
              { name: "Code", value: verificationCode }
            ]
          })
        });

        const smsResult = await smsResponse.json();

        return new Response(JSON.stringify({ success: true, result: smsResult }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      } catch (err) {
        return new Response(JSON.stringify({ success: false, error: err.message }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }
    }

    // مرحله ۲: بررسی صحت کد تایید وارد شده
    if (url.pathname === "/api/verify-code" && request.method === "POST") {
      try {
        const { phone, code } = await request.json();
        const savedCode = await env.TELEGRAM_KV.get(`code:${phone}`);

        if (savedCode && savedCode === code) {
          return new Response(JSON.stringify({ success: true }), {
            headers: { ...corsHeaders, "Content-Type": "application/json" }
          });
        } else {
          return new Response(JSON.stringify({ success: false, message: "کد وارد شده اشتباه یا منقضی شده است." }), {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" }
          });
        }
      } catch (err) {
        return new Response(JSON.stringify({ success: false, error: err.message }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }
    }

    // مرحله ۳: ارسال و دریافت پیام‌های چت
    if (url.pathname === "/api/send-message" && request.method === "POST") {
      const data = await request.json();
      const chatId = data.chatId;
      const message = { sender: data.sender, text: data.text, timestamp: Date.now() };

      let messages = JSON.parse(await env.TELEGRAM_KV.get(`chat:${chatId}`) || "[]");
      messages.push(message);
      await env.TELEGRAM_KV.put(`chat:${chatId}`, JSON.stringify(messages));

      return new Response(JSON.stringify({ success: true, message }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    if (url.pathname.startsWith("/api/get-messages/")) {
      const chatId = url.pathname.split("/")[3];
      const messages = await env.TELEGRAM_KV.get(`chat:${chatId}`) || "[]";
      return new Response(messages, { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    return new Response("Telegram Cloudflare Worker Running!", { headers: corsHeaders });
  }
};
