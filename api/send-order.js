// api/send-order.js
import { Readable } from 'stream';

export const config = {
  api: {
    bodyParser: false, // مهم عشان نقدر نقرا الـ FormData
  },
};

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // جيب التوكن من البيئة الآمنة
  const BOT_TOKEN = process.env.TELEGRAM_TOKEN;
  const CHAT_ID = process.env.CHAT_ID;

  if (!BOT_TOKEN || !CHAT_ID) {
    return res.status(500).json({ error: 'Bot Token or Chat ID missing' });
  }

  try {
    // 1. قراءة الـ FormData اللي جاي من الموقع
    const chunks = [];
    for await (const chunk of req) {
      chunks.push(chunk);
    }
    const buffer = Buffer.concat(chunks);
    
    // 2. تحويل الـ Buffer لـ String عشان نستخرج الـ Boundary
    const boundary = `--${req.headers['content-type'].split('boundary=')[1]}`;
    const parts = buffer.toString('binary').split(boundary);
    
    let textMessage = '';
    let receiptFileBuffer = null;
    let receiptFileName = 'receipt.jpg';

    // 3. استخراج البيانات من الأجزاء
    parts.forEach(part => {
      if (part.includes('Content-Disposition: form-data; name="message"')) {
        const match = part.match(/\r\n\r\n(.*?)(\r\n|$)/s);
        if (match) textMessage = match[1].trim();
      }
      if (part.includes('Content-Disposition: form-data; name="photo"')) {
        // استخراج الصورة
        const rawData = part.split('\r\n\r\n')[1];
        if (rawData) {
          receiptFileBuffer = Buffer.from(rawData, 'binary');
          // حاول ناخد اسم الملف
          const nameMatch = part.match(/filename="(.+?)"/);
          if (nameMatch) receiptFileName = nameMatch[1];
        }
      }
    });

    // 4. إرسال الرسالة النصية أولاً
    const textUrl = `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`;
    const textResponse = await fetch(textUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: CHAT_ID,
        text: textMessage || "طلب جديد (بدون تفاصيل)",
        parse_mode: 'Markdown'
      })
    });
    
    if (!textResponse.ok) {
        console.error("فشل إرسال النص:", await textResponse.text());
    }

    // 5. إرسال صورة الإيصال لو موجودة
    if (receiptFileBuffer) {
      const formData = new FormData();
      const blob = new Blob([receiptFileBuffer], { type: 'image/jpeg' });
      formData.append('chat_id', CHAT_ID);
      formData.append('photo', blob, receiptFileName);
      formData.append('caption', '📎 إيصال التحويل المرفق');

      const photoUrl = `https://api.telegram.org/bot${BOT_TOKEN}/sendPhoto`;
      const photoResponse = await fetch(photoUrl, {
        method: 'POST',
        body: formData
      });
      
      if (!photoResponse.ok) {
          console.error("فشل إرسال الصورة:", await photoResponse.text());
      }
    }

    return res.status(200).json({ success: true, message: "Order sent securely!" });

  } catch (error) {
    console.error("Server Error:", error);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
}