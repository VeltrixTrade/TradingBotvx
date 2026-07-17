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

// ========== SMC / ICT / Liquidity Analysis Engine ==========

// Helper: fetch candles from OANDA
async function fetchCandles(instrument, granularity, count) {
    const url = `${OANDA_BASE_URL}/v3/instruments/${instrument}/candles?granularity=${granularity}&count=${count}&price=M`;
    const response = await fetch(url, { headers: getOandaHeaders() });
    if (!response.ok) return [];
    const data = await response.json();
    return (data.candles || []).filter(c => c.complete !== false).map(c => ({
        time: c.time,
        open: parseFloat(c.mid.o),
        high: parseFloat(c.mid.h),
        low: parseFloat(c.mid.l),
        close: parseFloat(c.mid.c),
        volume: c.volume || 0
    }));
}

// Identify swing highs and swing lows (lookback of 3 candles each side)
function findSwings(candles, lookback = 3) {
    const swingHighs = [];
    const swingLows = [];
    for (let i = lookback; i < candles.length - lookback; i++) {
        let isHigh = true, isLow = true;
        for (let j = 1; j <= lookback; j++) {
            if (candles[i].high <= candles[i - j].high || candles[i].high <= candles[i + j].high) isHigh = false;
            if (candles[i].low >= candles[i - j].low || candles[i].low >= candles[i + j].low) isLow = false;
        }
        if (isHigh) swingHighs.push({ index: i, price: candles[i].high, time: candles[i].time });
        if (isLow) swingLows.push({ index: i, price: candles[i].low, time: candles[i].time });
    }
    return { swingHighs, swingLows };
}

// Detect market structure: uptrend, downtrend, or ranging
function detectMarketStructure(swingHighs, swingLows) {
    if (swingHighs.length < 2 || swingLows.length < 2) return 'ranging';
    const lastHighs = swingHighs.slice(-3);
    const lastLows = swingLows.slice(-3);

    let hhCount = 0, llCount = 0;
    for (let i = 1; i < lastHighs.length; i++) {
        if (lastHighs[i].price > lastHighs[i - 1].price) hhCount++;
    }
    for (let i = 1; i < lastLows.length; i++) {
        if (lastLows[i].price < lastLows[i - 1].price) llCount++;
    }

    if (hhCount >= 1 && llCount === 0) return 'uptrend';
    if (llCount >= 1 && hhCount === 0) return 'downtrend';
    return 'ranging';
}

// Find Break of Structure (BOS) / Change of Character (CHoCH)
function findBOS(candles, swingHighs, swingLows) {
    const events = [];
    if (candles.length < 5) return events;

    const lastCandle = candles[candles.length - 1];
    const recentHighs = swingHighs.slice(-4);
    const recentLows = swingLows.slice(-4);

    // Check if price broke above the last swing high (bullish BOS)
    for (let i = recentHighs.length - 1; i >= 0; i--) {
        if (lastCandle.close > recentHighs[i].price) {
            events.push({ type: 'bullish_bos', level: recentHighs[i].price, time: recentHighs[i].time });
            break;
        }
    }
    // Check if price broke below the last swing low (bearish BOS)
    for (let i = recentLows.length - 1; i >= 0; i--) {
        if (lastCandle.close < recentLows[i].price) {
            events.push({ type: 'bearish_bos', level: recentLows[i].price, time: recentLows[i].time });
            break;
        }
    }
    return events;
}

// Find Order Blocks (OB)
function findOrderBlocks(candles) {
    const orderBlocks = [];
    if (candles.length < 10) return orderBlocks;

    for (let i = 3; i < candles.length - 1; i++) {
        const prev = candles[i - 1];
        const curr = candles[i];
        const next = candles[i + 1];

        // Bullish OB: Last bearish candle before strong bullish move
        if (prev.close < prev.open && curr.close > curr.open && next.close > next.open) {
            const bodySize = Math.abs(curr.close - curr.open);
            const prevBodySize = Math.abs(prev.close - prev.open);
            if (bodySize > prevBodySize * 1.2) {
                orderBlocks.push({
                    type: 'bullish_ob',
                    high: prev.high,
                    low: prev.low,
                    mid: (prev.high + prev.low) / 2,
                    index: i - 1,
                    time: prev.time
                });
            }
        }
        // Bearish OB: Last bullish candle before strong bearish move
        if (prev.close > prev.open && curr.close < curr.open && next.close < next.open) {
            const bodySize = Math.abs(curr.close - curr.open);
            const prevBodySize = Math.abs(prev.close - prev.open);
            if (bodySize > prevBodySize * 1.2) {
                orderBlocks.push({
                    type: 'bearish_ob',
                    high: prev.high,
                    low: prev.low,
                    mid: (prev.high + prev.low) / 2,
                    index: i - 1,
                    time: prev.time
                });
            }
        }
    }
    return orderBlocks.slice(-6); // Return last 6 OBs
}

// Find Fair Value Gaps (FVG / Imbalances)
function findFVGs(candles) {
    const fvgs = [];
    for (let i = 2; i < candles.length; i++) {
        const c1 = candles[i - 2];
        const c3 = candles[i];

        // Bullish FVG: gap between candle 1 high and candle 3 low
        if (c3.low > c1.high) {
            fvgs.push({
                type: 'bullish_fvg',
                top: c3.low,
                bottom: c1.high,
                mid: (c3.low + c1.high) / 2,
                index: i - 1,
                time: candles[i - 1].time
            });
        }
        // Bearish FVG: gap between candle 3 high and candle 1 low
        if (c3.high < c1.low) {
            fvgs.push({
                type: 'bearish_fvg',
                top: c1.low,
                bottom: c3.high,
                mid: (c1.low + c3.high) / 2,
                index: i - 1,
                time: candles[i - 1].time
            });
        }
    }
    return fvgs.slice(-6);
}

// Detect Liquidity Pools (equal highs/lows = resting liquidity)
function findLiquidityPools(swingHighs, swingLows, tolerance = 0.0003) {
    const pools = [];

    // Equal highs (sell-side liquidity above)
    for (let i = 0; i < swingHighs.length - 1; i++) {
        for (let j = i + 1; j < swingHighs.length; j++) {
            const diff = Math.abs(swingHighs[i].price - swingHighs[j].price);
            if (diff / swingHighs[i].price < tolerance) {
                pools.push({
                    type: 'sell_side_liquidity',
                    level: Math.max(swingHighs[i].price, swingHighs[j].price),
                    description: 'سيولة بيعية فوق القمم المتساوية (Equal Highs)'
                });
            }
        }
    }

    // Equal lows (buy-side liquidity below)
    for (let i = 0; i < swingLows.length - 1; i++) {
        for (let j = i + 1; j < swingLows.length; j++) {
            const diff = Math.abs(swingLows[i].price - swingLows[j].price);
            if (diff / swingLows[i].price < tolerance) {
                pools.push({
                    type: 'buy_side_liquidity',
                    level: Math.min(swingLows[i].price, swingLows[j].price),
                    description: 'سيولة شرائية تحت القيعان المتساوية (Equal Lows)'
                });
            }
        }
    }
    return pools.slice(-4);
}

// Detect liquidity sweep (price swept beyond a level and reversed)
function detectLiquiditySweeps(candles, swingHighs, swingLows) {
    const sweeps = [];
    if (candles.length < 5) return sweeps;

    const recent = candles.slice(-10);

    for (const sh of swingHighs.slice(-3)) {
        for (const c of recent) {
            if (c.high > sh.price && c.close < sh.price) {
                sweeps.push({
                    type: 'sell_side_sweep',
                    level: sh.price,
                    candleTime: c.time,
                    description: 'تم كسح السيولة البيعية فوق القمة ثم الإغلاق تحتها (Liquidity Sweep)'
                });
            }
        }
    }

    for (const sl of swingLows.slice(-3)) {
        for (const c of recent) {
            if (c.low < sl.price && c.close > sl.price) {
                sweeps.push({
                    type: 'buy_side_sweep',
                    level: sl.price,
                    candleTime: c.time,
                    description: 'تم كسح السيولة الشرائية تحت القاع ثم الإغلاق فوقه (Liquidity Sweep)'
                });
            }
        }
    }
    return sweeps.slice(-3);
}

// Generate trading signal based on confluence
function generateSignal(instrument, candles, htfStructure) {
    if (candles.length < 30) return null;

    const { swingHighs, swingLows } = findSwings(candles);
    const structure = detectMarketStructure(swingHighs, swingLows);
    const bosEvents = findBOS(candles, swingHighs, swingLows);
    const orderBlocks = findOrderBlocks(candles);
    const fvgs = findFVGs(candles);
    const liquidityPools = findLiquidityPools(swingHighs, swingLows);
    const sweeps = detectLiquiditySweeps(candles, swingHighs, swingLows);

    const lastCandle = candles[candles.length - 1];
    const currentPrice = lastCandle.close;

    let signal = null;
    let confluence = [];
    let confluenceScore = 0;

    // ===== BULLISH SIGNAL LOGIC =====
    const bullishOBs = orderBlocks.filter(ob => ob.type === 'bullish_ob' && ob.high >= currentPrice * 0.995 && ob.low <= currentPrice * 1.005);
    const nearBullishOB = orderBlocks.filter(ob => ob.type === 'bullish_ob' && currentPrice <= ob.high * 1.002 && currentPrice >= ob.low * 0.998);
    const bullishFVGs = fvgs.filter(f => f.type === 'bullish_fvg' && currentPrice >= f.bottom * 0.999 && currentPrice <= f.top * 1.001);
    const bullishSweeps = sweeps.filter(s => s.type === 'buy_side_sweep');
    const bullishBOS = bosEvents.filter(b => b.type === 'bullish_bos');

    // Bullish confluence check
    if (htfStructure === 'uptrend' || structure === 'uptrend') confluenceScore += 2;
    if (nearBullishOB.length > 0 || bullishOBs.length > 0) { confluenceScore += 2; confluence.push('السعر عند منطقة Order Block شرائي'); }
    if (bullishFVGs.length > 0) { confluenceScore += 1; confluence.push('وجود فجوة قيمة عادلة صعودية (Bullish FVG)'); }
    if (bullishSweeps.length > 0) { confluenceScore += 2; confluence.push('تم كسح السيولة الشرائية (Buy-side Liquidity Sweep)'); }
    if (bullishBOS.length > 0) { confluenceScore += 1; confluence.push('كسر هيكل صعودي (Bullish BOS)'); }
    if (structure === 'uptrend') { confluence.push('الهيكل السوقي صاعد (Higher Highs & Higher Lows)'); }

    // ===== BEARISH SIGNAL LOGIC =====
    let bearishScore = 0;
    let bearishConfluence = [];
    const bearishOBs = orderBlocks.filter(ob => ob.type === 'bearish_ob');
    const nearBearishOB = bearishOBs.filter(ob => currentPrice >= ob.low * 0.998 && currentPrice <= ob.high * 1.002);
    const bearishFVGs = fvgs.filter(f => f.type === 'bearish_fvg' && currentPrice >= f.bottom * 0.999 && currentPrice <= f.top * 1.001);
    const bearishSweeps = sweeps.filter(s => s.type === 'sell_side_sweep');
    const bearishBOS = bosEvents.filter(b => b.type === 'bearish_bos');

    if (htfStructure === 'downtrend' || structure === 'downtrend') bearishScore += 2;
    if (nearBearishOB.length > 0) { bearishScore += 2; bearishConfluence.push('السعر عند منطقة Order Block بيعي'); }
    if (bearishFVGs.length > 0) { bearishScore += 1; bearishConfluence.push('وجود فجوة قيمة عادلة هبوطية (Bearish FVG)'); }
    if (bearishSweeps.length > 0) { bearishScore += 2; bearishConfluence.push('تم كسح السيولة البيعية (Sell-side Liquidity Sweep)'); }
    if (bearishBOS.length > 0) { bearishScore += 1; bearishConfluence.push('كسر هيكل هبوطي (Bearish BOS)'); }
    if (structure === 'downtrend') { bearishConfluence.push('الهيكل السوقي هابط (Lower Highs & Lower Lows)'); }

    // Determine pip size based on instrument
    const isJPY = instrument.includes('JPY');
    const isXAU = instrument.includes('XAU');
    let pipMultiplier = isJPY ? 100 : (isXAU ? 10 : 10000);
    let pipSize = 1 / pipMultiplier;

    // Determine the stronger direction
    const direction = confluenceScore >= bearishScore ? 'buy' : 'sell';
    const score = direction === 'buy' ? confluenceScore : bearishScore;
    const reasons = direction === 'buy' ? confluence : bearishConfluence;

    // We need at least a minimum confluence for a signal
    if (score < 3) return null;

    // Calculate SL and TP for 1:3 RR
    let entryPrice, stopLoss, takeProfit, orderType, entryReason;

    if (direction === 'buy') {
        // Find the best SL: below the most recent swing low or OB low
        const recentSwingLow = swingLows.length > 0 ? swingLows[swingLows.length - 1].price : currentPrice * 0.998;
        const obLow = nearBullishOB.length > 0 ? nearBullishOB[0].low : (bullishOBs.length > 0 ? bullishOBs[bullishOBs.length - 1].low : recentSwingLow);
        stopLoss = Math.min(recentSwingLow, obLow) - (pipSize * 5);
        
        const slDistance = currentPrice - stopLoss;
        takeProfit = currentPrice + (slDistance * 3); // 1:3 RR

        // If there's a nearby bullish OB below price, use pending order to enter at OB
        if (nearBullishOB.length > 0 && nearBullishOB[0].mid < currentPrice) {
            orderType = 'limit';
            entryPrice = nearBullishOB[0].mid;
            stopLoss = nearBullishOB[0].low - (pipSize * 5);
            const newSlDist = entryPrice - stopLoss;
            takeProfit = entryPrice + (newSlDist * 3);
            entryReason = 'أمر معلق (Limit) عند منتصف Order Block الشرائي';
        } else {
            orderType = 'market';
            entryPrice = currentPrice;
            entryReason = 'دخول فوري بسعر السوق الحالي';
        }
    } else {
        // Sell direction
        const recentSwingHigh = swingHighs.length > 0 ? swingHighs[swingHighs.length - 1].price : currentPrice * 1.002;
        const obHigh = nearBearishOB.length > 0 ? nearBearishOB[0].high : (bearishOBs.length > 0 ? bearishOBs[bearishOBs.length - 1].high : recentSwingHigh);
        stopLoss = Math.max(recentSwingHigh, obHigh) + (pipSize * 5);

        const slDistance = stopLoss - currentPrice;
        takeProfit = currentPrice - (slDistance * 3);

        if (nearBearishOB.length > 0 && nearBearishOB[0].mid > currentPrice) {
            orderType = 'limit';
            entryPrice = nearBearishOB[0].mid;
            stopLoss = nearBearishOB[0].high + (pipSize * 5);
            const newSlDist = stopLoss - entryPrice;
            takeProfit = entryPrice - (newSlDist * 3);
            entryReason = 'أمر معلق (Limit) عند منتصف Order Block البيعي';
        } else {
            orderType = 'market';
            entryPrice = currentPrice;
            entryReason = 'دخول فوري بسعر السوق الحالي';
        }
    }

    // Determine strength label
    let strength;
    if (score >= 6) strength = 'قوية جداً';
    else if (score >= 4) strength = 'قوية';
    else strength = 'متوسطة';

    const decimals = isJPY ? 3 : (isXAU ? 2 : 5);

    return {
        instrument: instrument,
        instrumentDisplay: instrument.replace('_', '/'),
        direction: direction,
        directionLabel: direction === 'buy' ? 'شراء (Buy)' : 'بيع (Sell)',
        orderType: orderType,
        orderTypeLabel: orderType === 'market' ? 'أمر فوري (Market)' : 'أمر معلق (Limit)',
        entryReason: entryReason,
        entryPrice: parseFloat(entryPrice.toFixed(decimals)),
        stopLoss: parseFloat(stopLoss.toFixed(decimals)),
        takeProfit: parseFloat(takeProfit.toFixed(decimals)),
        currentPrice: parseFloat(currentPrice.toFixed(decimals)),
        riskReward: '1:3',
        slPips: parseFloat((Math.abs(entryPrice - stopLoss) * pipMultiplier).toFixed(1)),
        tpPips: parseFloat((Math.abs(takeProfit - entryPrice) * pipMultiplier).toFixed(1)),
        structure: structure,
        structureLabel: structure === 'uptrend' ? 'صاعد ↑' : (structure === 'downtrend' ? 'هابط ↓' : 'عرضي ↔'),
        htfStructure: htfStructure,
        htfStructureLabel: htfStructure === 'uptrend' ? 'صاعد ↑' : (htfStructure === 'downtrend' ? 'هابط ↓' : 'عرضي ↔'),
        strength: strength,
        confluenceScore: score,
        reasons: reasons,
        liquidityPools: liquidityPools,
        sweeps: sweeps.map(s => s.description),
        timestamp: new Date().toISOString()
    };
}

// ========== API: Generate SMC/ICT Signals ==========
app.get('/api/signals', async (req, res) => {
    if (!OANDA_API_KEY || !OANDA_ACCOUNT_ID) {
        return res.status(400).json({ error: 'لم يتم إعداد حساب OANDA على الخادم' });
    }

    const instruments = (req.query.instruments || 'EUR_USD,GBP_USD,USD_JPY,XAU_USD').split(',');

    try {
        const signals = [];

        for (const instrument of instruments) {
            const trimmed = instrument.trim();

            // Multi-timeframe: H4 for structure (HTF), H1 for entry (LTF)
            const htfCandles = await fetchCandles(trimmed, 'H4', 100);
            const ltfCandles = await fetchCandles(trimmed, 'H1', 100);

            if (htfCandles.length < 30 || ltfCandles.length < 30) continue;

            // Determine HTF structure
            const htfSwings = findSwings(htfCandles);
            const htfStructure = detectMarketStructure(htfSwings.swingHighs, htfSwings.swingLows);

            // Generate signal on LTF with HTF context
            const signal = generateSignal(trimmed, ltfCandles, htfStructure);
            if (signal) {
                signals.push(signal);
            }
        }

        res.json({
            signals: signals,
            analysisTime: new Date().toISOString(),
            method: 'SMC + ICT + Liquidity Analysis',
            count: signals.length
        });

    } catch (error) {
        console.error('Signal generation error:', error);
        res.status(500).json({ error: 'حدث خطأ أثناء تحليل السوق وتوليد التوصيات' });
    }
});

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
