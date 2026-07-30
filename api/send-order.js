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
    // 1. قراءة البيانات الجاية من الموقع
    const chunks = [];
    for await (const chunk of req) {
      chunks.push(chunk);
    }
    const buffer = Buffer.concat(chunks);
    const contentType = req.headers['content-type'] || '';
    const boundary = `--${contentType.split('boundary=')[1]}`;
    const parts = buffer.toString('binary').split(boundary);

    let customerData = {};
    let cartItems = []; // هتخزن مصفوفة المنتجات (الاسم، الكمية، اللون)
    let receiptFileBuffer = null;
    let receiptFileName = 'receipt.jpg';
    let productImagesLinks = [];

    parts.forEach(part => {
      if (part.includes('Content-Disposition: form-data; name="customerData"')) {
        const raw = part.split('\r\n\r\n')[1];
        if (raw) {
          const cleanRaw = raw.replace(/\r\n$/, '').trim();
          customerData = JSON.parse(decodeURIComponent(cleanRaw));
        }
      }
      if (part.includes('Content-Disposition: form-data; name="cartItems"')) {
        const raw = part.split('\r\n\r\n')[1];
        if (raw) {
          const cleanRaw = raw.replace(/\r\n$/, '').trim();
          cartItems = JSON.parse(decodeURIComponent(cleanRaw));
        }
      }
      if (part.includes('Content-Disposition: form-data; name="photo"')) {
        const rawData = part.split('\r\n\r\n')[1];
        if (rawData) {
          receiptFileBuffer = Buffer.from(rawData, 'binary');
          const nameMatch = part.match(/filename="(.+?)"/);
          if (nameMatch) receiptFileName = nameMatch[1];
        }
      }
      if (part.includes('Content-Disposition: form-data; name="productImagesLinks"')) {
        const raw = part.split('\r\n\r\n')[1];
        if (raw) {
          const cleanRaw = raw.replace(/\r\n$/, '').trim();
          productImagesLinks = JSON.parse(cleanRaw);
        }
      }
    });

    // 2. السيرفر يروح يجيب الأسعار الحقيقية من جوجل شيت
    const SHEET_ID = '1B9EnRkQt-C0cjSiKasBR8KN47UPpoEhaANAU-EJiHfc';
    const API_URL = `https://opensheet.elk.sh/${SHEET_ID}/Sheet1`;
    const response = await fetch(API_URL);
    const data = await response.json();

    // إنشاء خريطة للأسعار (اسم المنتج -> السعر الحقيقي)
    const priceMap = {};
    data.forEach(row => {
      if (row.name && row.real_price) {
        priceMap[row.name] = parseInt(row.real_price);
      }
    });

    // 3. حساب الإجمالي بناءً على الكمية الحقيقية
    let productList = '';
    let totalPrice = 0;
    
    cartItems.forEach(item => {
      const realPrice = priceMap[item.name] || 0; // لو السعر مش موجود يبقي 0
      const itemTotal = realPrice * item.quantity;
      totalPrice += itemTotal;
      
      const colorText = item.color ? ` (اللون: ${item.color})` : '';
      productList += `📦 ${item.name}${colorText} × ${item.quantity} = ${itemTotal} ج.م\n`;
    });

    const shipping = parseInt(customerData.shipping) || 0;
    const finalTotal = totalPrice + shipping;

    // 4. تكوين رسالة التلجرام
    let msg = `🛍️ **طلب جديد من Little Library** 💖\n\n`;
    msg += `👤 **الاسم:** ${customerData.fullName}\n`;
    msg += `📞 **التليفون:** ${customerData.phone}\n`;
    if(customerData.altPhone) msg += `📞 **بديل:** ${customerData.altPhone}\n`;
    msg += `📍 **المحافظة:** ${customerData.governorate}\n`;
    msg += `🏠 **العنوان:** ${customerData.address}\n`;
    if(customerData.email) msg += `📧 **الإيميل:** ${customerData.email}\n\n`;
    msg += `📦 **المنتجات:**\n${productList}\n`;
    msg += `🚚 **الشحن:** ${shipping} ج.م\n`;
    msg += `💰 **الإجمالي النهائي (من السيرفر):** ${finalTotal} ج.م\n\n`;
    msg += `💳 **رقم المرسل:** ${customerData.senderNumber}`;

    // 5. إرسال ألبوم صور المنتجات
    if (productImagesLinks && productImagesLinks.length > 0) {
      const mediaGroup = productImagesLinks.map((url, index) => ({
        type: 'photo',
        media: url,
        caption: index === 0 ? `🖼️ صور منتجات الطلب (${productImagesLinks.length})` : ''
      }));

      const albumUrl = `https://api.telegram.org/bot${BOT_TOKEN}/sendMediaGroup`;
      await fetch(albumUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: CHAT_ID,
          media: mediaGroup
        })
      });
    }

    // 6. إرسال التفاصيل
    if (msg) {
      const textUrl = `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`;
      await fetch(textUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: CHAT_ID,
          text: msg,
          parse_mode: 'Markdown'
        })
      });
    }

    // 7. إرسال صورة الإيصال
    if (receiptFileBuffer) {
      const formData = new FormData();
      const blob = new Blob([receiptFileBuffer], { type: 'image/jpeg' });
      formData.append('chat_id', CHAT_ID);
      formData.append('photo', blob, receiptFileName);
      formData.append('caption', '📎 إيصال التحويل');

      const photoUrl = `https://api.telegram.org/bot${BOT_TOKEN}/sendPhoto`;
      await fetch(photoUrl, { method: 'POST', body: formData });
    }

    return res.status(200).json({ success: true });

  } catch (error) {
    console.error("Server Error:", error);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
}
