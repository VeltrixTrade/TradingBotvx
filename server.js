const express = require('express');
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ========== OANDA API Configuration ==========
const OANDA_API_KEY = process.env.OANDA_API_KEY || '';
const OANDA_ACCOUNT_ID = process.env.OANDA_ACCOUNT_ID || '';
const OANDA_ENVIRONMENT = process.env.OANDA_ENVIRONMENT || 'practice';

const OANDA_BASE_URL = OANDA_ENVIRONMENT === 'live' 
    ? 'https://api-fxtrade.oanda.com' 
    : 'https://api-fxpractice.oanda.com';

function getOandaHeaders() {
    return {
        'Authorization': `Bearer ${OANDA_API_KEY}`,
        'Content-Type': 'application/json'
    };
}

// ========== OANDA Helpers & Error Handling ==========
function handleOandaError(response, errorData) {
    const status = response.status;
    const errorCode = errorData?.errorCode;
    const errorMessage = errorData?.errorMessage || '';

    console.error(`OANDA API Error [${status}]: ${errorCode} - ${errorMessage}`);

    if (status === 401) {
        return 'مفتاح OANDA API غير صالح أو غير مفعّل.';
    }
    if (status === 404) {
        return 'رقم حساب OANDA غير موجود.';
    }
    if (status === 400 && (errorCode === 'INSUFFICIENT_MARGIN' || errorMessage.includes('margin') || errorMessage.includes('balance'))) {
        return 'الهامش المتاح في حسابك غير كافٍ لفتح هذه الصفقة.';
    }
    return errorMessage || `خطأ في الاتصال بـ OANDA (${status})`;
}

// ========== AI Keys from Environment Variables ==========
function getApiKeys() {
    return {
        openai: process.env.OPENAI_API_KEY || '',
        gemini: process.env.GEMINI_API_KEY || '',
        deepseek: process.env.DEEPSEEK_API_KEY || '',
    };
}

function getModels() {
    return {
        openai: process.env.OPENAI_MODEL || 'gpt-4o-mini',
        gemini: process.env.GEMINI_MODEL || 'gemini-2.0-flash',
        deepseek: process.env.DEEPSEEK_MODEL || 'deepseek-chat',
    };
}

// ========== API: OANDA Status ==========
app.get('/api/oanda/status', (req, res) => {
    res.json({
        configured: !!(OANDA_API_KEY && OANDA_ACCOUNT_ID),
        environment: OANDA_ENVIRONMENT,
        accountId: OANDA_ACCOUNT_ID ? `***-${OANDA_ACCOUNT_ID.split('-').pop()}` : ''
    });
});

// ========== API: OANDA Account Info ==========
app.get('/api/account', async (req, res) => {
    if (!OANDA_API_KEY || !OANDA_ACCOUNT_ID) {
        return res.status(400).json({ error: 'لم يتم إعداد حساب OANDA على الخادم' });
    }

    try {
        const url = `${OANDA_BASE_URL}/v3/accounts/${OANDA_ACCOUNT_ID}/summary`;
        const response = await fetch(url, { headers: getOandaHeaders() });
        const data = await response.json();

        if (!response.ok) {
            return res.status(response.status).json({ error: handleOandaError(response, data) });
        }

        res.json(data.account);
    } catch (error) {
        res.status(500).json({ error: 'حدث خطأ أثناء الاتصال بحساب OANDA' });
    }
});

// ========== API: OANDA Instruments ==========
app.get('/api/instruments', async (req, res) => {
    if (!OANDA_API_KEY || !OANDA_ACCOUNT_ID) {
        return res.status(400).json({ error: 'لم يتم إعداد حساب OANDA على الخادم' });
    }

    try {
        const url = `${OANDA_BASE_URL}/v3/accounts/${OANDA_ACCOUNT_ID}/instruments`;
        const response = await fetch(url, { headers: getOandaHeaders() });
        const data = await response.json();

        if (!response.ok) {
            return res.status(response.status).json({ error: handleOandaError(response, data) });
        }

        res.json(data.instruments);
    } catch (error) {
        res.status(500).json({ error: 'حدث خطأ أثناء جلب قائمة أزواج العملات' });
    }
});

// ========== API: OANDA Pricing ==========
app.get('/api/pricing', async (req, res) => {
    if (!OANDA_API_KEY || !OANDA_ACCOUNT_ID) {
        return res.status(400).json({ error: 'لم يتم إعداد حساب OANDA على الخادم' });
    }

    const { instruments } = req.query;
    if (!instruments) {
        return res.status(400).json({ error: 'يرجى تحديد أزواج العملات المطلوبة' });
    }

    try {
        const url = `${OANDA_BASE_URL}/v3/accounts/${OANDA_ACCOUNT_ID}/pricing?instruments=${encodeURIComponent(instruments)}`;
        const response = await fetch(url, { headers: getOandaHeaders() });
        const data = await response.json();

        if (!response.ok) {
            return res.status(response.status).json({ error: handleOandaError(response, data) });
        }

        res.json(data.prices);
    } catch (error) {
        res.status(500).json({ error: 'حدث خطأ أثناء جلب الأسعار الحالية' });
    }
});

// ========== API: OANDA Candles (OHLC) ==========
app.get('/api/candles', async (req, res) => {
    const { instrument, granularity, count } = req.query;
    if (!instrument) {
        return res.status(400).json({ error: 'يرجى تحديد زوج العملة' });
    }

    try {
        const g = granularity || 'H1';
        const c = count || '100';
        const url = `${OANDA_BASE_URL}/v3/instruments/${instrument}/candles?granularity=${g}&count=${c}&price=M`;
        const response = await fetch(url, { headers: getOandaHeaders() });
        const data = await response.json();

        if (!response.ok) {
            return res.status(response.status).json({ error: handleOandaError(response, data) });
        }

        res.json(data.candles);
    } catch (error) {
        res.status(500).json({ error: 'حدث خطأ أثناء جلب بيانات الشموع' });
    }
});

// ========== API: Place Order ==========
app.post('/api/orders', async (req, res) => {
    if (!OANDA_API_KEY || !OANDA_ACCOUNT_ID) {
        return res.status(400).json({ error: 'لم يتم إعداد حساب OANDA على الخادم' });
    }

    const { type, instrument, units, price, stopLoss, takeProfit } = req.body;

    if (!type || !instrument || !units) {
        return res.status(400).json({ error: 'البيانات المرسلة غير مكتملة' });
    }

    try {
        const orderRequest = {
            type: type.toUpperCase(),
            instrument: instrument,
            units: units.toString(),
            timeInForce: type.toUpperCase() === 'MARKET' ? 'FOK' : 'GTC',
            positionFill: 'DEFAULT'
        };

        if (price && type.toUpperCase() !== 'MARKET') {
            orderRequest.price = price.toString();
        }

        if (stopLoss) {
            orderRequest.stopLossOnFill = { price: stopLoss.toString(), timeInForce: 'GTC' };
        }

        if (takeProfit) {
            orderRequest.takeProfitOnFill = { price: takeProfit.toString() };
        }

        const url = `${OANDA_BASE_URL}/v3/accounts/${OANDA_ACCOUNT_ID}/orders`;
        const response = await fetch(url, {
            method: 'POST',
            headers: getOandaHeaders(),
            body: JSON.stringify({ order: orderRequest })
        });
        const data = await response.json();

        if (!response.ok) {
            return res.status(response.status).json({ error: handleOandaError(response, data) });
        }

        res.json(data);
    } catch (error) {
        res.status(500).json({ error: 'حدث خطأ أثناء تنفيذ الصفقة' });
    }
});

// ========== API: Get Open Trades ==========
app.get('/api/trades', async (req, res) => {
    if (!OANDA_API_KEY || !OANDA_ACCOUNT_ID) {
        return res.status(400).json({ error: 'لم يتم إعداد حساب OANDA على الخادم' });
    }

    try {
        const url = `${OANDA_BASE_URL}/v3/accounts/${OANDA_ACCOUNT_ID}/trades?state=OPEN`;
        const response = await fetch(url, { headers: getOandaHeaders() });
        const data = await response.json();

        if (!response.ok) {
            return res.status(response.status).json({ error: handleOandaError(response, data) });
        }

        res.json(data.trades);
    } catch (error) {
        res.status(500).json({ error: 'حدث خطأ أثناء جلب الصفقات المفتوحة' });
    }
});

// ========== API: Close Trade ==========
app.put('/api/trades/:id/close', async (req, res) => {
    if (!OANDA_API_KEY || !OANDA_ACCOUNT_ID) {
        return res.status(400).json({ error: 'لم يتم إعداد حساب OANDA على الخادم' });
    }

    const { id } = req.params;

    try {
        const url = `${OANDA_BASE_URL}/v3/accounts/${OANDA_ACCOUNT_ID}/trades/${id}/close`;
        const response = await fetch(url, {
            method: 'PUT',
            headers: getOandaHeaders(),
            body: JSON.stringify({ units: 'ALL' })
        });
        const data = await response.json();

        if (!response.ok) {
            return res.status(response.status).json({ error: handleOandaError(response, data) });
        }

        res.json(data);
    } catch (error) {
        res.status(500).json({ error: 'حدث خطأ أثناء إغلاق الصفقة' });
    }
});

// ========== API: Get Pending Orders ==========
app.get('/api/orders', async (req, res) => {
    if (!OANDA_API_KEY || !OANDA_ACCOUNT_ID) {
        return res.status(400).json({ error: 'لم يتم إعداد حساب OANDA على الخادم' });
    }

    try {
        const url = `${OANDA_BASE_URL}/v3/accounts/${OANDA_ACCOUNT_ID}/orders`;
        const response = await fetch(url, { headers: getOandaHeaders() });
        const data = await response.json();

        if (!response.ok) {
            return res.status(response.status).json({ error: handleOandaError(response, data) });
        }

        // Filter out trade filled/cancelled orders, only show pending ones (LIMIT, STOP, etc.)
        const pendingOrders = data.orders.filter(o => o.state === 'PENDING');
        res.json(pendingOrders);
    } catch (error) {
        res.status(500).json({ error: 'حدث خطأ أثناء جلب الأوامر المعلقة' });
    }
});

// ========== API: Cancel Order ==========
app.put('/api/orders/:id/cancel', async (req, res) => {
    if (!OANDA_API_KEY || !OANDA_ACCOUNT_ID) {
        return res.status(400).json({ error: 'لم يتم إعداد حساب OANDA على الخادم' });
    }

    const { id } = req.params;

    try {
        const url = `${OANDA_BASE_URL}/v3/accounts/${OANDA_ACCOUNT_ID}/orders/${id}/cancel`;
        const response = await fetch(url, {
            method: 'PUT',
            headers: getOandaHeaders()
        });
        const data = await response.json();

        if (!response.ok) {
            return res.status(response.status).json({ error: handleOandaError(response, data) });
        }

        res.json(data);
    } catch (error) {
        res.status(500).json({ error: 'حدث خطأ أثناء إلغاء الأمر' });
    }
});

// ========== API: Get Positions ==========
app.get('/api/positions', async (req, res) => {
    if (!OANDA_API_KEY || !OANDA_ACCOUNT_ID) {
        return res.status(400).json({ error: 'لم يتم إعداد حساب OANDA على الخادم' });
    }

    try {
        const url = `${OANDA_BASE_URL}/v3/accounts/${OANDA_ACCOUNT_ID}/positions`;
        const response = await fetch(url, { headers: getOandaHeaders() });
        const data = await response.json();

        if (!response.ok) {
            return res.status(response.status).json({ error: handleOandaError(response, data) });
        }

        res.json(data.positions);
    } catch (error) {
        res.status(500).json({ error: 'حدث خطأ أثناء جلب المراكز' });
    }
});

// ========== API: Close Position ==========
app.post('/api/positions/:instrument/close', async (req, res) => {
    if (!OANDA_API_KEY || !OANDA_ACCOUNT_ID) {
        return res.status(400).json({ error: 'لم يتم إعداد حساب OANDA على الخادم' });
    }

    const { instrument } = req.params;
    const { longUnits, shortUnits } = req.body;

    try {
        const url = `${OANDA_BASE_URL}/v3/accounts/${OANDA_ACCOUNT_ID}/positions/${instrument}/close`;
        const body = {};
        if (longUnits) body.longUnits = longUnits;
        if (shortUnits) body.shortUnits = shortUnits;

        const response = await fetch(url, {
            method: 'PUT',
            headers: getOandaHeaders(),
            body: JSON.stringify(body)
        });
        const data = await response.json();

        if (!response.ok) {
            return res.status(response.status).json({ error: handleOandaError(response, data) });
        }

        res.json(data);
    } catch (error) {
        res.status(500).json({ error: 'حدث خطأ أثناء إغلاق المركز' });
    }
});

// ========== API: Trade History (Closed Trades) ==========
app.get('/api/history', async (req, res) => {
    if (!OANDA_API_KEY || !OANDA_ACCOUNT_ID) {
        return res.status(400).json({ error: 'لم يتم إعداد حساب OANDA على الخادم' });
    }

    try {
        const url = `${OANDA_BASE_URL}/v3/accounts/${OANDA_ACCOUNT_ID}/trades?state=CLOSED&count=50`;
        const response = await fetch(url, { headers: getOandaHeaders() });
        const data = await response.json();

        if (!response.ok) {
            return res.status(response.status).json({ error: handleOandaError(response, data) });
        }

        res.json(data.trades);
    } catch (error) {
        res.status(500).json({ error: 'حدث خطأ أثناء جلب تاريخ الصفقات' });
    }
});

// ========== API: Check Available AI Models ==========
app.get('/api/models', (req, res) => {
    const keys = getApiKeys();
    res.json({
        chatgpt: { available: !!keys.openai, model: getModels().openai },
        gemini: { available: !!keys.gemini, model: getModels().gemini },
        deepseek: { available: !!keys.deepseek, model: getModels().deepseek },
    });
});

// ========== API: AI Chat Handler ==========
app.post('/api/chat', async (req, res) => {
    const { model, messages } = req.body;

    if (!model || !messages || !Array.isArray(messages)) {
        return res.status(400).json({ error: 'يرجى إرسال النموذج والرسائل بشكل صحيح' });
    }

    const keys = getApiKeys();
    const models = getModels();

    try {
        let result;

        switch (model) {
            case 'chatgpt':
                if (!keys.openai) return res.status(400).json({ error: 'مفتاح OpenAI API غير مُعد على الخادم' });
                result = await callOpenAICompatible(
                    'https://api.openai.com/v1/chat/completions',
                    keys.openai,
                    models.openai,
                    messages
                );
                break;

            case 'gemini':
                if (!keys.gemini) return res.status(400).json({ error: 'مفتاح Gemini API غير مُعد على الخادم' });
                result = await callGemini(keys.gemini, models.gemini, messages);
                break;

            case 'deepseek':
                if (!keys.deepseek) return res.status(400).json({ error: 'مفتاح DeepSeek API غير مُعد على الخادم' });
                result = await callOpenAICompatible(
                    'https://api.deepseek.com/chat/completions',
                    keys.deepseek,
                    models.deepseek,
                    messages
                );
                break;

            default:
                return res.status(400).json({ error: 'نموذج غير معروف' });
        }

        res.json({ response: result });

    } catch (error) {
        console.error(`[${model}] Error:`, error.message);
        res.status(500).json({ error: error.message || 'حدث خطأ أثناء الاتصال بالنموذج' });
    }
});

// ========== AI Helper Call Functions ==========
async function callOpenAICompatible(apiUrl, apiKey, model, chatMessages) {
    const response = await fetch(apiUrl, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`
        },
        body: JSON.stringify({
            model: model,
            messages: chatMessages.map(m => ({
                role: m.role,
                content: m.content
            })),
            max_tokens: 2048,
            temperature: 0.7
        })
    });

    if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        const errMsg = errorData.error?.message || '';
        
        if (response.status === 401) {
            throw new Error('مفتاح API غير صالح. يرجى التحقق من المتغيرات البيئية');
        } else if (response.status === 402 || errMsg.toLowerCase().includes('insufficient') || errMsg.toLowerCase().includes('balance') || errMsg.toLowerCase().includes('quota')) {
            throw new Error('رصيد الحساب غير كافٍ. يرجى شحن رصيد حساب API الخاص بهذا النموذج');
        } else if (response.status === 429) {
            throw new Error('تم تجاوز حد الطلبات. يرجى المحاولة بعد قليل');
        } else {
            throw new Error(errMsg || `خطأ في الخادم (${response.status})`);
        }
    }

    const data = await response.json();
    return data.choices[0].message.content;
}

async function callGemini(apiKey, model, chatMessages) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

    const contents = chatMessages.map(m => ({
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: m.content }]
    }));

    const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            contents: contents,
            generationConfig: {
                temperature: 0.7,
                maxOutputTokens: 2048
            }
        })
    });

    if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        if (response.status === 400 || response.status === 403) {
            throw new Error('مفتاح Gemini API غير صالح أو غير مفعّل');
        } else if (response.status === 429) {
            throw new Error('تم تجاوز حد الطلبات. يرجى المحاولة بعد قليل');
        } else {
            throw new Error(errorData.error?.message || `خطأ في الخادم (${response.status})`);
        }
    }

    const data = await response.json();
    return data.candidates[0].content.parts[0].text;
}

// ========== Fallback Route ==========
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ========== Start Server ==========
app.listen(PORT, () => {
    console.log(`\n🚀 AI Trading Platform running on port ${PORT}`);
    console.log(`📡 OANDA Status: ${OANDA_API_KEY && OANDA_ACCOUNT_ID ? `✅ Connected (${OANDA_ENVIRONMENT})` : '❌ Disconnected'}`);
    console.log(`🤖 AI Models Status:`);
    const keys = getApiKeys();
    console.log(`   ChatGPT:  ${keys.openai ? '✅ Ready' : '❌ No API key'}`);
    console.log(`   Gemini:   ${keys.gemini ? '✅ Ready' : '❌ No API key'}`);
    console.log(`   DeepSeek: ${keys.deepseek ? '✅ Ready' : '❌ No API key'}`);
    console.log('');
});
