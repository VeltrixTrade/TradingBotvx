const express = require('express');
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ========== Simulated Database ==========
let balance = 10000.00;
let openTrades = [];
let pendingOrders = [];
let closedTrades = [];
let tradeIdCounter = 1001;
let orderIdCounter = 5001;

const LEVERAGE = 30; // 1:30 leverage

// ========== Yahoo Finance Configuration & Mapping ==========
const YAHOO_MAPPING = {
    'EUR_USD': 'EURUSD=X',
    'GBP_USD': 'GBPUSD=X',
    'USD_JPY': 'USDJPY=X',
    'AUD_USD': 'AUDUSD=X',
    'USD_CAD': 'USDCAD=X',
    'USD_CHF': 'USDCHF=X',
    'XAU_USD': 'GC=F'
};

async function fetchYahooPrice(instrument) {
    const yahooSymbol = YAHOO_MAPPING[instrument] || `${instrument.replace('_', '')}=X`;
    const url = `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${yahooSymbol}`;
    const response = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' } });
    if (!response.ok) throw new Error('Yahoo Finance price fetch failed');
    const data = await response.json();
    const result = data.quoteResponse?.result?.[0];
    if (!result) throw new Error('No price data found');
    
    const mid = result.regularMarketPrice;
    const isJPY = instrument.includes('JPY');
    const isXAU = instrument.includes('XAU');
    const decimals = isJPY ? 3 : (isXAU ? 2 : 5);
    const spreadVal = isJPY ? 0.02 : (isXAU ? 0.3 : 0.00015);

    const bid = mid - (spreadVal / 2);
    const ask = mid + (spreadVal / 2);
    
    return {
        instrument,
        bids: [{ price: bid.toFixed(decimals) }],
        asks: [{ price: ask.toFixed(decimals) }],
        closeoutBid: bid.toFixed(decimals),
        closeoutAsk: ask.toFixed(decimals)
    };
}

async function fetchYahooCandles(instrument, granularity, count) {
    const yahooSymbol = YAHOO_MAPPING[instrument] || `${instrument.replace('_', '')}=X`;
    let interval = '1h';
    if (granularity.startsWith('M')) interval = '15m';
    if (granularity === 'M1') interval = '1m';
    if (granularity === 'M5') interval = '5m';
    if (granularity === 'M15') interval = '15m';
    if (granularity === 'M30') interval = '30m';
    if (granularity === 'H1') interval = '1h';
    if (granularity === 'H4') interval = '1h';
    if (granularity === 'D') interval = '1d';
    if (granularity === 'W') interval = '1wk';
    
    let range = '5d';
    if (interval === '1d' || interval === '1wk') range = '1mo';
    if (interval === '1m') range = '1d';

    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${yahooSymbol}?interval=${interval}&range=${range}`;
    const response = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' } });
    if (!response.ok) return [];
    const data = await response.json();
    const result = data.chart?.result?.[0];
    if (!result) return [];
    
    const timestamps = result.timestamp || [];
    const indicators = result.indicators?.quote?.[0] || {};
    const opens = indicators.open || [];
    const highs = indicators.high || [];
    const lows = indicators.low || [];
    const closes = indicators.close || [];
    
    const candles = [];
    for (let i = 0; i < timestamps.length; i++) {
        if (opens[i] !== null && highs[i] !== null && lows[i] !== null && closes[i] !== null) {
            candles.push({
                time: new Date(timestamps[i] * 1000).toISOString(),
                open: opens[i],
                high: highs[i],
                low: lows[i],
                close: closes[i],
                volume: indicators.volume?.[i] || 0
            });
        }
    }
    return candles.slice(-count);
}

// ========== Check Pending Orders & Trigger Sim Trades ==========
async function updateSimulatedTradesAndOrders() {
    try {
        if (openTrades.length === 0 && pendingOrders.length === 0) return;

        // Fetch prices for all unique instruments
        const uniqueInstruments = [...new Set([
            ...openTrades.map(t => t.instrument),
            ...pendingOrders.map(o => o.instrument)
        ])];

        const prices = {};
        for (const inst of uniqueInstruments) {
            const p = await fetchYahooPrice(inst);
            prices[inst] = {
                bid: parseFloat(p.closeoutBid),
                ask: parseFloat(p.closeoutAsk)
            };
        }

        // 1. Process Pending Orders (Limit / Stop)
        for (let i = pendingOrders.length - 1; i >= 0; i--) {
            const o = pendingOrders[i];
            const p = prices[o.instrument];
            if (!p) continue;

            const targetPrice = parseFloat(o.price);
            const units = parseInt(o.units);
            const isBuy = units > 0;
            const currentPrice = isBuy ? p.ask : p.bid;

            let trigger = false;

            if (o.type === 'LIMIT') {
                if (isBuy && currentPrice <= targetPrice) trigger = true;
                if (!isBuy && currentPrice >= targetPrice) trigger = true;
            } else if (o.type === 'STOP') {
                if (isBuy && currentPrice >= targetPrice) trigger = true;
                if (!isBuy && currentPrice <= targetPrice) trigger = true;
            }

            if (trigger) {
                // Remove from pending
                pendingOrders.splice(i, 1);
                // Create open trade
                const trade = {
                    id: o.id.toString(),
                    instrument: o.instrument,
                    price: currentPrice.toString(),
                    initialUnits: o.units.toString(),
                    currentUnits: o.units.toString(),
                    state: 'OPEN',
                    openTime: new Date().toISOString(),
                    stopLossOnFill: o.stopLossOnFill,
                    takeProfitOnFill: o.takeProfitOnFill,
                    unrealizedPL: '0.00'
                };
                openTrades.push(trade);
            }
        }

        // 2. Update Unrealized PL & check SL/TP for open trades
        for (let i = openTrades.length - 1; i >= 0; i--) {
            const t = openTrades[i];
            const p = prices[t.instrument];
            if (!p) continue;

            const entry = parseFloat(t.price);
            const units = parseInt(t.currentUnits);
            const isBuy = units > 0;
            const currentPrice = isBuy ? p.bid : p.ask;

            // Calculate profit
            const diff = isBuy ? (currentPrice - entry) : (entry - currentPrice);
            const pl = diff * Math.abs(units);
            t.unrealizedPL = pl.toFixed(2);

            // Check Stop Loss & Take Profit
            let closeTrade = false;
            let closeReason = 'NORMAL';
            let closePrice = currentPrice;

            if (t.stopLossOnFill && t.stopLossOnFill.price) {
                const sl = parseFloat(t.stopLossOnFill.price);
                if (isBuy && currentPrice <= sl) { closeTrade = true; closeReason = 'SL'; closePrice = sl; }
                if (!isBuy && currentPrice >= sl) { closeTrade = true; closeReason = 'SL'; closePrice = sl; }
            }

            if (t.takeProfitOnFill && t.takeProfitOnFill.price) {
                const tp = parseFloat(t.takeProfitOnFill.price);
                if (isBuy && currentPrice >= tp) { closeTrade = true; closeReason = 'TP'; closePrice = tp; }
                if (!isBuy && currentPrice <= tp) { closeTrade = true; closeReason = 'TP'; closePrice = tp; }
            }

            if (closeTrade) {
                openTrades.splice(i, 1);
                const finalDiff = isBuy ? (closePrice - entry) : (entry - closePrice);
                const finalPL = finalDiff * Math.abs(units);
                balance += finalPL;

                closedTrades.push({
                    id: t.id,
                    instrument: t.instrument,
                    initialUnits: t.initialUnits,
                    price: t.price,
                    averageClosePrice: closePrice.toString(),
                    realizedPL: finalPL.toFixed(2),
                    closeTime: new Date().toISOString(),
                    reason: closeReason
                });
            }
        }

    } catch (err) {
        console.error('Error updating simulated database:', err);
    }
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

// ========== API: Connection Status (Static simulator) ==========
app.get('/api/oanda/status', (req, res) => {
    res.json({
        configured: true,
        environment: 'simulation',
        accountId: 'Veltrix-Sim-100'
    });
});

// ========== API: Account Info (Simulated) ==========
app.get('/api/account', async (req, res) => {
    await updateSimulatedTradesAndOrders();

    let unrealizedPL = 0;
    let marginUsed = 0;

    openTrades.forEach(t => {
        unrealizedPL += parseFloat(t.unrealizedPL);
        // Estimate Margin requirement (1:30 leverage)
        const size = Math.abs(parseInt(t.currentUnits)) * parseFloat(t.price);
        marginUsed += size / LEVERAGE;
    });

    const nav = balance + unrealizedPL;
    const marginAvailable = Math.max(0, nav - marginUsed);

    res.json({
        balance: balance.toFixed(2),
        NAV: nav.toFixed(2),
        unrealizedPL: unrealizedPL.toFixed(2),
        marginUsed: marginUsed.toFixed(2),
        marginAvailable: marginAvailable.toFixed(2)
    });
});

// ========== API: Instruments List (Static supported pairs) ==========
app.get('/api/instruments', (req, res) => {
    const list = Object.keys(YAHOO_MAPPING).map(key => ({
        name: key,
        displayName: key.replace('_', '/')
    }));
    res.json(list);
});

// ========== API: Pricing (Yahoo Finance Feed) ==========
app.get('/api/pricing', async (req, res) => {
    const { instruments } = req.query;
    if (!instruments) {
        return res.status(400).json({ error: 'يرجى تحديد أزواج العملات المطلوبة' });
    }

    try {
        const list = instruments.split(',');
        const prices = [];
        for (const inst of list) {
            const price = await fetchYahooPrice(inst.trim());
            prices.push(price);
        }
        
        // Asynchronously execute order matching on new ticks
        updateSimulatedTradesAndOrders();

        res.json(prices);
    } catch (err) {
        res.status(500).json({ error: 'حدث خطأ أثناء جلب الأسعار الفورية من TradingView/Yahoo' });
    }
});

// ========== API: Candles (Yahoo Finance Feed) ==========
app.get('/api/candles', async (req, res) => {
    const { instrument, granularity, count } = req.query;
    if (!instrument) {
        return res.status(400).json({ error: 'يرجى تحديد زوج العملة' });
    }

    try {
        const g = granularity || 'H1';
        const c = count || '100';
        const candles = await fetchYahooCandles(instrument, g, parseInt(c));
        res.json(candles);
    } catch (err) {
        res.status(500).json({ error: 'حدث خطأ أثناء جلب بيانات الشموع' });
    }
});

// ========== API: Place Order (Simulated) ==========
app.post('/api/orders', async (req, res) => {
    const { type, instrument, units, price, stopLoss, takeProfit } = req.body;

    if (!type || !instrument || !units) {
        return res.status(400).json({ error: 'البيانات المرسلة غير مكتملة' });
    }

    try {
        const pData = await fetchYahooPrice(instrument);
        const bid = parseFloat(pData.closeoutBid);
        const ask = parseFloat(pData.closeoutAsk);

        const isBuy = parseInt(units) > 0;
        const currentPrice = isBuy ? ask : bid;

        const orderType = type.toUpperCase();

        if (orderType === 'MARKET') {
            // Immediately fill market order
            const trade = {
                id: (tradeIdCounter++).toString(),
                instrument: instrument,
                price: currentPrice.toFixed(5),
                initialUnits: units.toString(),
                currentUnits: units.toString(),
                state: 'OPEN',
                openTime: new Date().toISOString(),
                unrealizedPL: '0.00'
            };

            if (stopLoss) trade.stopLossOnFill = { price: stopLoss.toString() };
            if (takeProfit) trade.takeProfitOnFill = { price: takeProfit.toString() };

            openTrades.push(trade);
            res.json({ orderFillTransaction: { id: trade.id } });
        } else {
            // Limit or Stop Order (Pending)
            if (!price) {
                return res.status(400).json({ error: 'السعر المطلوب غير محدد للأمر المعلق' });
            }

            const order = {
                id: (orderIdCounter++).toString(),
                instrument: instrument,
                type: orderType,
                units: units.toString(),
                price: price.toString(),
                state: 'PENDING'
            };

            if (stopLoss) order.stopLossOnFill = { price: stopLoss.toString() };
            if (takeProfit) order.takeProfitOnFill = { price: takeProfit.toString() };

            pendingOrders.push(order);
            res.json({ orderCreateTransaction: { id: order.id } });
        }

    } catch (err) {
        res.status(500).json({ error: 'حدث خطأ أثناء إدراج الصفقة' });
    }
});

// ========== API: Get Open Trades (Simulated) ==========
app.get('/api/trades', async (req, res) => {
    await updateSimulatedTradesAndOrders();
    res.json(openTrades);
});

// ========== API: Close Trade (Simulated) ==========
app.put('/api/trades/:id/close', async (req, res) => {
    const { id } = req.params;
    const index = openTrades.findIndex(t => t.id === id);
    if (index === -1) {
        return res.status(404).json({ error: 'الصفقة غير موجودة' });
    }

    try {
        const t = openTrades[index];
        const pData = await fetchYahooPrice(t.instrument);
        const bid = parseFloat(pData.closeoutBid);
        const ask = parseFloat(pData.closeoutAsk);

        const isBuy = parseInt(t.currentUnits) > 0;
        const closePrice = isBuy ? bid : ask;

        openTrades.splice(index, 1);

        const diff = isBuy ? (closePrice - parseFloat(t.price)) : (parseFloat(t.price) - closePrice);
        const pl = diff * Math.abs(parseInt(t.currentUnits));
        balance += pl;

        closedTrades.push({
            id: t.id,
            instrument: t.instrument,
            initialUnits: t.initialUnits,
            price: t.price,
            averageClosePrice: closePrice.toFixed(5),
            realizedPL: pl.toFixed(2),
            closeTime: new Date().toISOString(),
            reason: 'NORMAL'
        });

        res.json({ closed: true });
    } catch (err) {
        res.status(500).json({ error: 'حدث خطأ أثناء إغلاق الصفقة' });
    }
});

// ========== API: Get Pending Orders (Simulated) ==========
app.get('/api/orders', (req, res) => {
    res.json(pendingOrders);
});

// ========== API: Cancel Order (Simulated) ==========
app.put('/api/orders/:id/cancel', (req, res) => {
    const { id } = req.params;
    const index = pendingOrders.findIndex(o => o.id === id);
    if (index === -1) {
        return res.status(404).json({ error: 'الأمر المعلق غير موجود' });
    }

    pendingOrders.splice(index, 1);
    res.json({ cancelled: true });
});

// ========== API: Get Positions (Simulated) ==========
app.get('/api/positions', (req, res) => {
    // Return positions grouped by instrument
    const positionsMap = {};
    openTrades.forEach(t => {
        if (!positionsMap[t.instrument]) {
            positionsMap[t.instrument] = {
                instrument: t.instrument,
                long: { units: '0', averagePrice: '0.00000', unrealizedPL: '0.00' },
                short: { units: '0', averagePrice: '0.00000', unrealizedPL: '0.00' },
                unrealizedPL: '0.00'
            };
        }

        const p = positionsMap[t.instrument];
        const units = parseInt(t.currentUnits);
        const pl = parseFloat(t.unrealizedPL);

        if (units > 0) {
            const currentLongUnits = parseInt(p.long.units);
            const newUnits = currentLongUnits + units;
            const avgPrice = ((parseFloat(p.long.averagePrice) * currentLongUnits) + (parseFloat(t.price) * units)) / newUnits;
            p.long.units = newUnits.toString();
            p.long.averagePrice = avgPrice.toFixed(5);
            p.long.unrealizedPL = (parseFloat(p.long.unrealizedPL) + pl).toFixed(2);
        } else {
            const currentShortUnits = parseInt(p.short.units);
            const newUnits = currentShortUnits + Math.abs(units);
            const avgPrice = ((parseFloat(p.short.averagePrice) * currentShortUnits) + (parseFloat(t.price) * Math.abs(units))) / newUnits;
            p.short.units = newUnits.toString();
            p.short.averagePrice = avgPrice.toFixed(5);
            p.short.unrealizedPL = (parseFloat(p.short.unrealizedPL) + pl).toFixed(2);
        }
        p.unrealizedPL = (parseFloat(p.unrealizedPL) + pl).toFixed(2);
    });

    res.json(Object.values(positionsMap));
});

// ========== API: History ==========
app.get('/api/history', (req, res) => {
    res.json(closedTrades.slice(-50)); // Last 50 closed trades
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
    return orderBlocks.slice(-6);
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

    const isJPY = instrument.includes('JPY');
    const isXAU = instrument.includes('XAU');
    let pipMultiplier = isJPY ? 100 : (isXAU ? 10 : 10000);
    let pipSize = 1 / pipMultiplier;

    const direction = confluenceScore >= bearishScore ? 'buy' : 'sell';
    const score = direction === 'buy' ? confluenceScore : bearishScore;
    const reasons = direction === 'buy' ? confluence : bearishConfluence;

    if (score < 3) return null;

    let entryPrice, stopLoss, takeProfit, orderType, entryReason;

    if (direction === 'buy') {
        const recentSwingLow = swingLows.length > 0 ? swingLows[swingLows.length - 1].price : currentPrice * 0.998;
        const obLow = nearBullishOB.length > 0 ? nearBullishOB[0].low : (bullishOBs.length > 0 ? bullishOBs[bullishOBs.length - 1].low : recentSwingLow);
        stopLoss = Math.min(recentSwingLow, obLow) - (pipSize * 5);
        
        const slDistance = currentPrice - stopLoss;
        takeProfit = currentPrice + (slDistance * 3); // 1:3 RR

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
    const instruments = (req.query.instruments || 'EUR_USD,GBP_USD,USD_JPY,XAU_USD').split(',');

    try {
        const signals = [];

        for (const instrument of instruments) {
            const trimmed = instrument.trim();
            const htfCandles = await fetchYahooCandles(trimmed, 'H4', 100);
            const ltfCandles = await fetchYahooCandles(trimmed, 'H1', 100);

            if (htfCandles.length < 30 || ltfCandles.length < 30) continue;

            const htfSwings = findSwings(htfCandles);
            const htfStructure = detectMarketStructure(htfSwings.swingHighs, htfSwings.swingLows);

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
    console.log(`📡 Status: ✅ Trading Simulation Engine Activated (Keyless Mode)`);
    console.log(`🤖 AI Models Status:`);
    const keys = getApiKeys();
    console.log(`   ChatGPT:  ${keys.openai ? '✅ Ready' : '❌ No API key'}`);
    console.log(`   Gemini:   ${keys.gemini ? '✅ Ready' : '❌ No API key'}`);
    console.log(`   DeepSeek: ${keys.deepseek ? '✅ Ready' : '❌ No API key'}`);
    console.log('');
});
