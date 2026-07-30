export const config = {
  api: {
    bodyParser: false, // مهم جداً عشان يقرا الملفات والصور
  },
};

export default async function handler(req, res) {
  // السماح بـ CORS عشان لو جاب أخطار
  res.setHeader('Access-Control-Allow-Origin', '*');

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const BOT_TOKEN = process.env.TELEGRAM_TOKEN;
  const CHAT_ID = process.env.CHAT_ID;

  if (!BOT_TOKEN || !CHAT_ID) {
    return res.status(500).json({ error: 'Bot Token or Chat ID missing in environment' });
  }

  try {
    // 1. قراءة البيانات كـ Buffer
    const chunks = [];
    for await (const chunk of req) {
      chunks.push(chunk);
    }
    const buffer = Buffer.concat(chunks);

    // 2. استخراج الـ Boundary من الـ headers
    const contentType = req.headers['content-type'] || '';
    const boundary = `--${contentType.split('boundary=')[1]}`;
    const parts = buffer.toString('binary').split(boundary);

    let textMessage = '';
    let receiptFileBuffer = null;
    let receiptFileName = 'receipt.jpg';

    // 3. فك البيانات ومعالجة النص العربي
    parts.forEach(part => {
      // استخراج النص (message)
      if (part.includes('Content-Disposition: form-data; name="message"')) {
        // هنا التعديل السحري: نستخدم TextDecoder عشان يقرا العربي صح
        const raw = part.split('\r\n\r\n')[1];
        if (raw) {
          // بنشيل الـ \r\n اللي في الآخر
          const cleanRaw = raw.replace(/\r\n$/, '').trim();
          // بنحول الـ Binary Buffer لـ نص UTF-8 (عربي)
          const bufferData = Buffer.from(cleanRaw, 'binary');
          textMessage = new TextDecoder('utf-8').decode(bufferData);
        }
      }

      // استخراج الصورة (photo)
      if (part.includes('Content-Disposition: form-data; name="photo"')) {
        const rawData = part.split('\r\n\r\n')[1];
        if (rawData) {
          receiptFileBuffer = Buffer.from(rawData, 'binary');
          const nameMatch = part.match(/filename="(.+?)"/);
          if (nameMatch) receiptFileName = nameMatch[1];
        }
      }
    });

    // 4. إرسال الرسالة النصية (التفاصيل) للتلجرام
    if (textMessage) {
      const textUrl = `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`;
      await fetch(textUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: CHAT_ID,
          text: textMessage,
          parse_mode: 'Markdown'
        })
      });
    } else {
      // لو مفيش تفاصيل انبعثت، نبعث رسالة تأكيد عادية
      const textUrl = `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`;
      await fetch(textUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: CHAT_ID,
          text: "✅ تم استلام طلب جديد (التفاصيل غير متوفرة)."
        })
      });
    }

    // 5. إرسال صورة الإيصال (لو موجودة)
    if (receiptFileBuffer) {
      const formData = new FormData();
      const blob = new Blob([receiptFileBuffer], { type: 'image/jpeg' });
      formData.append('chat_id', CHAT_ID);
      formData.append('photo', blob, receiptFileName);
      formData.append('caption', '📎 صورة إيصال التحويل');

      const photoUrl = `https://api.telegram.org/bot${BOT_TOKEN}/sendPhoto`;
      await fetch(photoUrl, {
        method: 'POST',
        body: formData
      });
    }

    return res.status(200).json({ success: true, message: "Order received and sent!" });

  } catch (error) {
    console.error("Server Error:", error);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
}
