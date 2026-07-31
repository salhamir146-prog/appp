export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // ۱. مدیریت درخواست‌های API (ارسال و بررسی کد پیامک)
    if (url.pathname.startsWith('/api/')) {
      return handleApi(request, env, url);
    }

    // ۲. نمایش فایل‌های استاتیک فرنت‌اند (مثل index.html)
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

      const smsResponse = await fetch("https://api.sms.ir/v1/send/verify", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-API-KEY": env.SMS_IR_API_KEY
        },
        body: JSON.stringify({
          Mobile: phone,
          TemplateId: Number(env.SMS_IR_TEMPLATE_ID),
          Parameters: [
            { Name: "OTP", Value: code }
          ]
        })
      });

      const smsResult = await smsResponse.json();

      if (smsResult.status === 1 || smsResult.success) {
        return new Response(JSON.stringify({ success: true, message: "کد تایید با موفقیت ارسال شد" }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      } else {
        return new Response(JSON.stringify({ success: false, message: "خطا در ارسال پیامک", error: smsResult }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }
    }

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

      return new Response(JSON.stringify({ success: true, message: "ورود با موفقیت انجام شد" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

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
