from flask import Flask, request, jsonify, render_template
import requests
import random

app = Flask(__name__)

# حافظه موقت برای ذخیره کدهای ارسالی (در پروژه واقعی از Database استفاده میشه)
verification_codes = {}

# اطلاعات پنل پیامکی (باید توکن یا API Key پنل خودت رو اینجا بذاری)
SMS_API_KEY = "YOUR_SMS_PANEL_API_KEY"

@app.route('/api/send-sms', methods=['POST'])
def send_sms():
    data = request.json
    phone = data.get('phone') # شماره موبایل کاربر
    
    # تولید کد تصادفی ۵ رقمی
    code = str(random.randint(10000, 99999))
    verification_codes[phone] = code
    
    # ارسال پیامک واقعی از طریق وب‌سرویس پیامکی
    # مثال با وب‌سرویس کاوه‌نگار:
    # url = f"https://api.kavenegar.com/v1/{SMS_API_KEY}/verify/lookup.json"
    # params = {'receptor': phone, 'token': code, 'template': 'your_template_name'}
    # response = requests.get(url, params=params)
    
    print(f"کد تأیید {code} به شماره {phone} ارسال شد.")
    return jsonify({"success": True, "message": "SMS sent successfully"})

@app.route('/api/verify-code', methods=['POST'])
def verify_code():
    data = request.json
    user_code = data.get('code')
    
    # اینجا بررسی می‌کنیم کد درسته یا نه
    # برای تست، فرض می‌کنیم هر کدی درسته یا با کد ذخیره‌شده مقایسه میشه
    return jsonify({"success": True})

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000)