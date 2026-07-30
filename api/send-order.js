export const config = {
  api: {
    bodyParser: false,
  },
};

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const BOT_TOKEN = process.env.TELEGRAM_TOKEN;
  const CHAT_ID = process.env.CHAT_ID;

  if (!BOT_TOKEN || !CHAT_ID) {
    return res.status(500).json({ error: 'Bot Token or Chat ID missing' });
  }

  try {
    // 1. قراءة البيانات
    const chunks = [];
    for await (const chunk of req) {
      chunks.push(chunk);
    }
    const buffer = Buffer.concat(chunks);

    const contentType = req.headers['content-type'] || '';
    const boundary = `--${contentType.split('boundary=')[1]}`;
    const parts = buffer.toString('binary').split(boundary);

    let textMessage = '';
    let receiptFileBuffer = null;
    let receiptFileName = 'receipt.jpg';

    // 2. استخراج التفاصيل
    parts.forEach(part => {
      // استخراج النص (message)
      if (part.includes('Content-Disposition: form-data; name="message"')) {
        const raw = part.split('\r\n\r\n')[1];
        if (raw) {
          // إزالة الـ newlines الزيادة
          const cleanRaw = raw.replace(/\r\n$/, '').trim();
          // تحويل الباينري لعربي
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

    // 3. إرسال التفاصيل للتلجرام
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
      // لو التفاصيل ضايعة لأي سبب (طوارئ)
      await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: CHAT_ID, text: "✅ طلب جديد (التفاصيل غير متوفرة)." })
      });
    }

    // 4. إرسال صورة الإيصال
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

    return res.status(200).json({ success: true, message: "Order sent securely!" });

  } catch (error) {
    console.error("Server Error:", error);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
}
