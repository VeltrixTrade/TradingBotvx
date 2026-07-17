// ========== State & Global Variables ==========
let currentInstrument = 'EUR_USD';
let currentOrderType = 'market';
let chatOpen = false;
let messages = [];
let isStreaming = false;
let availableModels = {};
let pricingInterval = null;
let accountRefreshInterval = null;
let tvWidget = null;
let currentGranularity = 'D';

const INSTRUMENT_DISPLAY = {
    'EUR_USD': { name: 'EUR/USD', tvSymbol: 'OANDA:EURUSD', pipDecimal: 4 },
    'GBP_USD': { name: 'GBP/USD', tvSymbol: 'OANDA:GBPUSD', pipDecimal: 4 },
    'USD_JPY': { name: 'USD/JPY', tvSymbol: 'OANDA:USDJPY', pipDecimal: 2 },
    'AUD_USD': { name: 'AUD/USD', tvSymbol: 'OANDA:AUDUSD', pipDecimal: 4 },
    'USD_CAD': { name: 'USD/CAD', tvSymbol: 'OANDA:USDCAD', pipDecimal: 4 },
    'USD_CHF': { name: 'USD/CHF', tvSymbol: 'OANDA:USDCHF', pipDecimal: 4 },
    'XAU_USD': { name: 'XAU/USD', tvSymbol: 'OANDA:XAUUSD', pipDecimal: 2 }
};

const MODEL_DISPLAY = {
    chatgpt: { name: 'ChatGPT', gradient: 'linear-gradient(135deg, #10a37f, #1a7f5a)' },
    gemini: { name: 'Gemini', gradient: 'linear-gradient(135deg, #4285f4, #6c47ff)' },
    deepseek: { name: 'DeepSeek', gradient: 'linear-gradient(135deg, #536dfe, #304ffe)' }
};

// ========== Initialize ==========
document.addEventListener('DOMContentLoaded', () => {
    checkOandaStatus();
    checkAvailableAIModels();
    initTradingViewChart();
    setupEventListeners();
    startAutoRefresh();
});

// ========== Event Listeners ==========
function setupEventListeners() {
    // Instrument select
    const instrumentSelect = document.getElementById('instrumentSelect');
    instrumentSelect.addEventListener('change', (e) => {
        switchInstrument(e.target.value);
    });

    // Timeframe buttons
    document.querySelectorAll('.tf-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            document.querySelectorAll('.tf-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            currentGranularity = btn.dataset.tf;
            updateTradingViewChart();
        });
    });

    // Main Tables Tabs
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
            document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
            
            btn.classList.add('active');
            const tabId = `tab-${btn.dataset.tab}`;
            document.getElementById(tabId).classList.add('active');

            if (btn.dataset.tab === 'trade-history') {
                loadTradeHistory();
            }
        });
    });

    // Order Type toggle
    document.querySelectorAll('.order-type-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.order-type-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            currentOrderType = btn.dataset.type;

            const priceFieldGroup = document.getElementById('priceFieldGroup');
            if (currentOrderType === 'market') {
                priceFieldGroup.style.display = 'none';
            } else {
                priceFieldGroup.style.display = 'flex';
                // Auto fill current ask/bid price in field
                const askPrice = parseFloat(document.getElementById('askPrice').textContent);
                document.getElementById('orderPrice').value = askPrice || '';
            }
        });
    });

    // Buy / Sell Order Actions
    document.getElementById('btnBuy').addEventListener('click', () => placeOrder('buy'));
    document.getElementById('btnSell').addEventListener('click', () => placeOrder('sell'));

    // Floating AI Chat FAB & Toggle
    const chatFab = document.getElementById('chatFab');
    const openChatBtn = document.getElementById('openChatBtn');
    const closeChatBtn = document.getElementById('closeChatBtn');
    const clearChatBtn = document.getElementById('clearChatBtn');
    const sendBtn = document.getElementById('sendBtn');
    const chatInput = document.getElementById('chatInput');

    chatFab.addEventListener('click', toggleChat);
    openChatBtn.addEventListener('click', openChat);
    closeChatBtn.addEventListener('click', closeChat);
    clearChatBtn.addEventListener('click', clearChat);

    sendBtn.addEventListener('click', handleSendChat);
    chatInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            handleSendChat();
        }
    });

    chatInput.addEventListener('input', () => {
        chatInput.style.height = 'auto';
        chatInput.style.height = Math.min(chatInput.scrollHeight, 100) + 'px';
        sendBtn.disabled = !chatInput.value.trim() || isStreaming;
    });

    // Model tabs in chat
    document.querySelectorAll('.model-tab').forEach(tab => {
        tab.addEventListener('click', () => {
            switchChatModel(tab.dataset.model);
        });
    });
}

// ========== Trading Simulator Connection & Status ==========
async function checkOandaStatus() {
    try {
        const indicator = document.getElementById('oandaStatusIndicator');
        const text = document.getElementById('oandaStatusText');

        indicator.className = 'status-indicator connected';
        text.textContent = 'محاكي التداول نشط (TradingView Feed)';
        
        // Initial data loads
        refreshAccountInfo();
        refreshOpenTrades();
        refreshPendingOrders();
        fetchPrices();
    } catch (error) {
        console.error('Simulator status check failed:', error);
    }
}

// ========== TradingView Chart Integration ==========
function initTradingViewChart() {
    const symbol = INSTRUMENT_DISPLAY[currentInstrument]?.tvSymbol || 'OANDA:EURUSD';
    tvWidget = new TradingView.widget({
        "container_id": "tradingview_chart",
        "autosize": true,
        "symbol": symbol,
        "interval": currentGranularity,
        "timezone": "Etc/UTC",
        "theme": "dark",
        "style": "1",
        "locale": "ar",
        "toolbar_bg": "#0f1521",
        "enable_publishing": false,
        "allow_symbol_change": true,
        "studies": [
            "RSI@tv-basicstudies",
            "MASimple@tv-basicstudies"
        ],
        "show_popup_button": true,
        "popup_width": "1000",
        "popup_height": "650"
    });
}

function updateTradingViewChart() {
    // Recreate the widget on granularity/symbol changes to avoid issues
    initTradingViewChart();
}

function switchInstrument(instrument) {
    currentInstrument = instrument;
    document.getElementById('panelInstrumentName').textContent = INSTRUMENT_DISPLAY[instrument].name;
    
    // Reset price fields
    document.getElementById('orderPrice').value = '';
    document.getElementById('stopLoss').value = '';
    document.getElementById('takeProfit').value = '';

    updateTradingViewChart();
    fetchPrices();
}

// ========== Account Summary fetching ==========
async function refreshAccountInfo() {
    try {
        const response = await fetch('/api/account');
        if (!response.ok) return;

        const data = await response.json();
        
        const balance = parseFloat(data.balance);
        const nav = parseFloat(data.NAV);
        const unrealizedPL = parseFloat(data.unrealizedPL);
        const marginUsed = parseFloat(data.marginUsed);
        const marginAvailable = parseFloat(data.marginAvailable);
        
        // Update DOM
        document.getElementById('val-balance').textContent = formatCurrency(balance);
        document.getElementById('val-nav').textContent = formatCurrency(nav);
        
        const plEl = document.getElementById('val-unrealized-pl');
        plEl.textContent = formatCurrency(unrealizedPL);
        plEl.className = 'card-value ' + (unrealizedPL >= 0 ? 'profit' : 'loss');

        document.getElementById('val-margin-used').textContent = formatCurrency(marginUsed);
        document.getElementById('val-margin-available').textContent = formatCurrency(marginAvailable);

    } catch (error) {
        console.error('Account summary refresh failed:', error);
    }
}

// ========== Realtime Pricing ==========
async function fetchPrices() {
    try {
        const response = await fetch(`/api/pricing?instruments=${currentInstrument}`);
        if (!response.ok) return;

        const prices = await response.json();
        if (prices && prices.length > 0) {
            const match = prices[0];
            const bid = parseFloat(match.bids[0].price);
            const ask = parseFloat(match.asks[0].price);
            
            const info = INSTRUMENT_DISPLAY[currentInstrument];
            const bidStr = bid.toFixed(info.pipDecimal + 1);
            const askStr = ask.toFixed(info.pipDecimal + 1);

            document.getElementById('bidPrice').textContent = bidStr;
            document.getElementById('askPrice').textContent = askStr;

            // Calculate spread
            const multiplier = Math.pow(10, info.pipDecimal);
            const spread = (ask - bid) * multiplier;
            document.getElementById('spreadVal').textContent = spread.toFixed(1);
        }
    } catch (error) {
        console.error('Failed to fetch pricing:', error);
    }
}

// ========== Order Execution ==========
async function placeOrder(side) {
    const unitsInput = document.getElementById('orderUnits');
    let units = parseInt(unitsInput.value);
    
    if (isNaN(units) || units <= 0) {
        showToast('يرجى تحديد كمية صحيحة.', 'error');
        return;
    }

    // Sell is negative units
    if (side === 'sell') {
        units = -units;
    }

    const price = parseFloat(document.getElementById('orderPrice').value);
    const stopLoss = parseFloat(document.getElementById('stopLoss').value);
    const takeProfit = parseFloat(document.getElementById('takeProfit').value);

    const orderBody = {
        type: currentOrderType,
        instrument: currentInstrument,
        units: units
    };

    if (currentOrderType !== 'market') {
        if (isNaN(price) || price <= 0) {
            showToast('السعر المطلوب مطلوب لهذا النوع من الأوامر.', 'error');
            return;
        }
        orderBody.price = price;
    }

    if (!isNaN(stopLoss) && stopLoss > 0) orderBody.stopLoss = stopLoss;
    if (!isNaN(takeProfit) && takeProfit > 0) orderBody.takeProfit = takeProfit;

    showToast('جاري إرسال الأمر...', 'info');

    try {
        const response = await fetch('/api/orders', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(orderBody)
        });

        const data = await response.json();

        if (!response.ok) {
            throw new Error(data.error || 'فشل تنفيذ الأمر');
        }

        showToast('تم إرسال الأمر وتنفيذه بنجاح! ✓', 'success');
        
        // Reset fields
        document.getElementById('orderPrice').value = '';
        document.getElementById('stopLoss').value = '';
        document.getElementById('takeProfit').value = '';

        // Immediate updates
        refreshAccountInfo();
        refreshOpenTrades();
        refreshPendingOrders();
    } catch (error) {
        showToast(error.message, 'error');
    }
}

// ========== Open Trades loading ==========
async function refreshOpenTrades() {
    try {
        const response = await fetch('/api/trades');
        if (!response.ok) return;

        const trades = await response.json();
        const tbody = document.getElementById('tradesTableBody');
        document.getElementById('openTradesCount').textContent = trades.length;

        if (trades.length === 0) {
            tbody.innerHTML = `<tr><td colspan="8" class="text-center text-muted py-4">لا توجد صفقات مفتوحة حالياً</td></tr>`;
            return;
        }

        let html = '';
        trades.forEach(t => {
            const units = parseInt(t.currentUnits);
            const side = units > 0 ? 'شراء' : 'بيع';
            const sideClass = units > 0 ? 'profit' : 'loss';
            const pl = parseFloat(t.unrealizedPL);
            const plClass = pl >= 0 ? 'profit' : 'loss';

            html += `
                <tr>
                    <td>#${t.id}</td>
                    <td class="text-ar">${t.instrument.replace('_', '/')}</td>
                    <td class="text-ar"><span class="${sideClass}">${side}</span></td>
                    <td>${Math.abs(units).toLocaleString()}</td>
                    <td>${parseFloat(t.price).toFixed(5)}</td>
                    <td id="live-trade-price-${t.id}">--</td>
                    <td><span class="${plClass}" id="live-trade-pl-${t.id}">${pl.toFixed(2)}</span></td>
                    <td class="text-ar">
                        <button class="btn-table-action" onclick="closeTrade('${t.id}')">إغلاق</button>
                    </td>
                </tr>
            `;
        });
        tbody.innerHTML = html;

        // Populate current price values if possible
        trades.forEach(async t => {
            const pRes = await fetch(`/api/pricing?instruments=${t.instrument}`);
            if (pRes.ok) {
                const prices = await pRes.json();
                if (prices && prices.length > 0) {
                    const price = parseFloat(t.currentUnits > 0 ? prices[0].bids[0].price : prices[0].asks[0].price);
                    const td = document.getElementById(`live-trade-price-${t.id}`);
                    if (td) td.textContent = price.toFixed(5);
                }
            }
        });

    } catch (error) {
        console.error('Failed to refresh open trades:', error);
    }
}

async function closeTrade(tradeId) {
    if (!confirm('هل أنت متأكد من إغلاق هذه الصفقة بالكامل؟')) return;

    try {
        const response = await fetch(`/api/trades/${tradeId}/close`, {
            method: 'PUT'
        });

        if (!response.ok) {
            const data = await response.json();
            throw new Error(data.error || 'فشل إغلاق الصفقة');
        }

        showToast('تم إغلاق الصفقة بنجاح.', 'success');
        refreshAccountInfo();
        refreshOpenTrades();
    } catch (error) {
        showToast(error.message, 'error');
    }
}

// ========== Pending Orders loading ==========
async function refreshPendingOrders() {
    try {
        const response = await fetch('/api/orders');
        if (!response.ok) return;

        const orders = await response.json();
        const tbody = document.getElementById('ordersTableBody');
        document.getElementById('pendingOrdersCount').textContent = orders.length;

        if (orders.length === 0) {
            tbody.innerHTML = `<tr><td colspan="7" class="text-center text-muted py-4">لا توجد أوامر معلقة حالياً</td></tr>`;
            return;
        }

        let html = '';
        orders.forEach(o => {
            const units = parseInt(o.units);
            const side = units > 0 ? 'شراء' : 'بيع';
            const sideClass = units > 0 ? 'profit' : 'loss';

            html += `
                <tr>
                    <td>#${o.id}</td>
                    <td class="text-ar">${o.instrument.replace('_', '/')}</td>
                    <td class="text-ar"><span class="${sideClass}">${side}</span></td>
                    <td>${Math.abs(units).toLocaleString()}</td>
                    <td>${parseFloat(o.price || 0).toFixed(5)}</td>
                    <td>${o.stopLossOnFill ? parseFloat(o.stopLossOnFill.price).toFixed(5) : '--'}</td>
                    <td class="text-ar">
                        <button class="btn-table-action" onclick="cancelOrder('${o.id}')">إلغاء</button>
                    </td>
                </tr>
            `;
        });
        tbody.innerHTML = html;
    } catch (error) {
        console.error('Failed to refresh pending orders:', error);
    }
}

async function cancelOrder(orderId) {
    if (!confirm('هل تريد إلغاء هذا الأمر المعلق؟')) return;

    try {
        const response = await fetch(`/api/orders/${orderId}/cancel`, {
            method: 'PUT'
        });

        if (!response.ok) {
            const data = await response.json();
            throw new Error(data.error || 'فشل إلغاء الأمر');
        }

        showToast('تم إلغاء الأمر المعلق.', 'success');
        refreshAccountInfo();
        refreshPendingOrders();
    } catch (error) {
        showToast(error.message, 'error');
    }
}

// ========== History (Closed Trades) Loading ==========
async function loadTradeHistory() {
    const tbody = document.getElementById('historyTableBody');
    tbody.innerHTML = `<tr><td colspan="8" class="text-center text-muted py-4">جاري تحميل السجل...</td></tr>`;

    try {
        const response = await fetch('/api/history');
        if (!response.ok) return;

        const history = await response.json();

        if (history.length === 0) {
            tbody.innerHTML = `<tr><td colspan="8" class="text-center text-muted py-4">لا توجد صفقات مغلقة في السجل</td></tr>`;
            return;
        }

        let html = '';
        history.forEach(t => {
            const units = parseInt(t.initialUnits);
            const side = units > 0 ? 'شراء' : 'بيع';
            const sideClass = units > 0 ? 'profit' : 'loss';
            const pl = parseFloat(t.realizedPL);
            const plClass = pl >= 0 ? 'profit' : 'loss';
            const closeTime = new Date(t.closeTime).toLocaleString('ar-EG', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });

            html += `
                <tr>
                    <td>#${t.id}</td>
                    <td class="text-ar">${t.instrument.replace('_', '/')}</td>
                    <td class="text-ar"><span class="${sideClass}">${side}</span></td>
                    <td>${Math.abs(units).toLocaleString()}</td>
                    <td>${parseFloat(t.price).toFixed(5)}</td>
                    <td>${parseFloat(t.averageClosePrice || 0).toFixed(5)}</td>
                    <td><span class="${plClass}">${pl.toFixed(2)}</span></td>
                    <td class="text-ar text-muted">${closeTime}</td>
                </tr>
            `;
        });
        tbody.innerHTML = html;
    } catch (error) {
        tbody.innerHTML = `<tr><td colspan="8" class="text-center text-muted py-4">فشل تحميل السجل</td></tr>`;
        console.error('Failed to load trade history:', error);
    }
}

// ========== Main Layout Navigation Tab System ==========
function switchMainTab(tab) {
    document.querySelectorAll('.nav-link').forEach(link => {
        link.classList.remove('active');
        if (link.id === 'nav-signals-link' && tab === 'signals') {
            link.classList.add('active');
        } else if (link.getAttribute('onclick') && link.getAttribute('onclick').includes(tab)) {
            link.classList.add('active');
        }
    });

    const dashboardGrid = document.querySelector('.dashboard-grid');
    const signalsView = document.getElementById('signalsView');

    if (tab === 'signals') {
        dashboardGrid.style.display = 'none';
        signalsView.style.display = 'block';
        loadSmartSignals();
    } else {
        dashboardGrid.style.display = 'grid';
        signalsView.style.display = 'none';

        // Scroll or click subtabs inside the main dashboard
        if (tab === 'positions') {
            document.querySelector('.tables-container-card').scrollIntoView({ behavior: 'smooth' });
            document.querySelector('.tab-btn[data-tab="open-trades"]').click();
        } else if (tab === 'history') {
            document.querySelector('.tables-container-card').scrollIntoView({ behavior: 'smooth' });
            document.querySelector('.tab-btn[data-tab="trade-history"]').click();
        } else if (tab === 'dashboard') {
            window.scrollTo({ top: 0, behavior: 'smooth' });
        }
    }
}

// ========== SMC / ICT Signals Loader ==========
async function loadSmartSignals() {
    const loading = document.getElementById('signalsLoading');
    const grid = document.getElementById('signalsGrid');
    const noSignals = document.getElementById('noSignalsMessage');

    loading.style.display = 'flex';
    grid.style.display = 'none';
    noSignals.style.display = 'none';

    try {
        const response = await fetch('/api/signals');
        if (!response.ok) {
            const err = await response.json();
            throw new Error(err.error || 'فشل جلب التوصيات والتحليل');
        }
        const data = await response.json();
        const signals = data.signals;

        if (!signals || signals.length === 0) {
            loading.style.display = 'none';
            noSignals.innerHTML = `<p>لا توجد توصيات كافية لتأكيد الدخول حالياً وفق معايير SMC/ICT الصارمة. يرجى إعادة المحاولة لاحقاً.</p>`;
            noSignals.style.display = 'block';
            return;
        }

        let html = '';
        signals.forEach((sig, idx) => {
            const cardId = `sig-card-${idx}`;
            const directionClass = sig.direction === 'buy' ? 'buy-signal' : 'sell-signal';
            
            // Build confluences list
            let confHtml = '';
            sig.reasons.forEach(reason => {
                confHtml += `<li class="confluence-item">${reason}</li>`;
            });

            // Build liquidity alerts
            let liqHtml = '';
            if (sig.liquidityPools && sig.liquidityPools.length > 0) {
                liqHtml += `<div class="liquidity-alerts-box"><span class="confluence-title">تنبيهات السيولة:</span>`;
                sig.liquidityPools.forEach(pool => {
                    const levelVal = Number(pool.level);
                    const decimals = sig.instrument.includes('JPY') ? 3 : (sig.instrument.includes('XAU') ? 2 : 5);
                    const formattedLevel = isNaN(levelVal) ? '--' : levelVal.toFixed(decimals);
                    liqHtml += `<div class="liquidity-alert-item">${pool.description} عند ${formattedLevel}</div>`;
                });
                liqHtml += `</div>`;
            }

            html += `
                <div class="signal-card ${directionClass}" id="${cardId}">
                    <div class="signal-card-header">
                        <h3>${sig.instrumentDisplay}</h3>
                        <span class="signal-direction-badge">${sig.directionLabel}</span>
                    </div>

                    <div class="signal-meta-row">
                        <span class="meta-pill">النوع: <strong>${sig.orderTypeLabel}</strong></span>
                        <span class="meta-pill strength-badge">القوة: <strong>${sig.strength}</strong></span>
                        <span class="meta-pill">عائد/مخاطرة: <strong>${sig.riskReward}</strong></span>
                    </div>

                    <div class="signal-parameters-box">
                        <div class="param-col entry">
                            <span class="param-title">سعر الدخول</span>
                            <span class="param-value">${sig.entryPrice}</span>
                        </div>
                        <div class="param-col sl">
                            <span class="param-title">وقف الخسارة (SL)</span>
                            <span class="param-value">${sig.stopLoss}</span>
                        </div>
                        <div class="param-col tp">
                            <span class="param-title">جني الأرباح (TP)</span>
                            <span class="param-value">${sig.takeProfit}</span>
                        </div>
                    </div>

                    <div class="signal-confluences">
                        <span class="confluence-title">مؤشرات SMC + ICT لتأكيد الدخول:</span>
                        <ul class="confluence-list">
                            ${confHtml}
                        </ul>
                    </div>

                    ${liqHtml}

                    <div class="execute-signal-card-box">
                        <div class="units-select-row">
                            <label for="units-${cardId}">كمية العقد (وحدات):</label>
                            <input type="number" id="units-${cardId}" value="1000" min="1" step="1">
                        </div>
                        <button class="execute-signal-btn" onclick="executeSignalOrder('${sig.instrument}', '${sig.direction}', ${sig.entryPrice}, ${sig.stopLoss}, ${sig.takeProfit}, '${sig.orderType}', '${cardId}')">
                            <span>تنفيذ هذه التوصية فوراً</span>
                        </button>
                    </div>
                </div>
            `;
        });

        grid.innerHTML = html;
        loading.style.display = 'none';
        grid.style.display = 'grid';

    } catch (error) {
        loading.style.display = 'none';
        noSignals.innerHTML = `<p>فشل جلب التحليل الفني: ${error.message}</p>`;
        noSignals.style.display = 'block';
        showToast(error.message, 'error');
    }
}

// ========== Execute SMC/ICT Recommendation directly ==========
async function executeSignalOrder(instrument, direction, entryPrice, stopLoss, takeProfit, orderType, cardId) {
    const unitsInput = document.getElementById(`units-${cardId}`);
    let units = parseInt(unitsInput.value);

    if (isNaN(units) || units <= 0) {
        showToast('يرجى تحديد كمية صحيحة.', 'error');
        return;
    }

    if (direction === 'sell') {
        units = -units;
    }

    const orderBody = {
        type: orderType,
        instrument: instrument,
        units: units,
        stopLoss: stopLoss,
        takeProfit: takeProfit
    };

    if (orderType !== 'market') {
        orderBody.price = entryPrice;
    }

    showToast('جاري إرسال وتنفيذ أمر التوصية...', 'info');

    try {
        const response = await fetch('/api/orders', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(orderBody)
        });

        const data = await response.json();

        if (!response.ok) {
            throw new Error(data.error || 'فشل تنفيذ الأمر');
        }

        showToast('تم تنفيذ صفقة التوصية بنجاح! ✓', 'success');
        refreshAccountInfo();
        refreshOpenTrades();
        refreshPendingOrders();
    } catch (error) {
        showToast(error.message, 'error');
    }
}

// ========== Auto Refreshing Intervals ==========
function startAutoRefresh() {
    // Refresh prices every 3 seconds
    pricingInterval = setInterval(fetchPrices, 3000);

    // Refresh accounts & positions every 5 seconds
    accountRefreshInterval = setInterval(() => {
        refreshAccountInfo();
        refreshOpenTrades();
        refreshPendingOrders();
    }, 5000);

    // Stop loops when tab is inactive/hidden to save server resources
    document.addEventListener('visibilitychange', () => {
        if (document.hidden) {
            clearInterval(pricingInterval);
            clearInterval(accountRefreshInterval);
        } else {
            pricingInterval = setInterval(fetchPrices, 3000);
            accountRefreshInterval = setInterval(() => {
                refreshAccountInfo();
                refreshOpenTrades();
                refreshPendingOrders();
            }, 5000);
        }
    });
}

// ========== AI Chat Helpers & Functions ==========
let chatModel = 'chatgpt';

async function checkAvailableAIModels() {
    try {
        const response = await fetch('/api/models');
        availableModels = await response.json();

        Object.keys(availableModels).forEach(model => {
            const tab = document.getElementById(`tab-${model}`);
            if (tab) {
                if (availableModels[model].available) {
                    tab.classList.add('model-available');
                } else {
                    tab.classList.add('model-unavailable');
                }
            }
        });

        const firstAvailable = Object.keys(availableModels).find(m => availableModels[m].available);
        if (firstAvailable) {
            switchChatModel(firstAvailable);
        }
    } catch (error) {
        console.error('Failed to query AI models availability:', error);
    }
}

function switchChatModel(model) {
    chatModel = model;
    const display = MODEL_DISPLAY[model];

    document.querySelectorAll('.model-tab').forEach(tab => {
        tab.classList.toggle('active', tab.dataset.model === model);
    });

    document.getElementById('chatModelName').textContent = display.name;
    document.getElementById('chatHeaderAvatar').style.background = display.gradient;
}

function toggleChat() {
    chatOpen ? closeChat() : openChat();
}

function openChat() {
    chatOpen = true;
    document.getElementById('chatPanel').classList.add('open');
    document.getElementById('chatFab').classList.add('active');
}

function closeChat() {
    chatOpen = false;
    document.getElementById('chatPanel').classList.remove('open');
    document.getElementById('chatFab').classList.remove('active');
}

function clearChat() {
    messages = [];
    document.getElementById('chatMessages').innerHTML = `
        <div class="welcome-message" id="welcomeMessage">
            <div class="welcome-icon">
                <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="url(#welcomeGrad)" stroke-width="1.5">
                    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
                    <defs><linearGradient id="welcomeGrad" x1="3" y1="3" x2="21" y2="21"><stop offset="0%" stop-color="#6366f1"/><stop offset="100%" stop-color="#a855f7"/></linearGradient></defs>
                </svg>
            </div>
            <h3>مرحباً بك في مساعد VeltrixTrade الذكي!</h3>
            <p>اختر النموذج واطلب المساعدة لتحليل السوق أو صياغة الأفكار</p>
            <div class="welcome-suggestions">
                <button class="suggestion-chip" onclick="sendSuggestion('حلل لي زوج EUR/USD فنياً حالياً')">📊 تحليل EUR/USD</button>
                <button class="suggestion-chip" onclick="sendSuggestion('ما هي أفضل استراتيجيات إدارة المخاطر في تداول الفوركس؟')">🛡️ استراتيجية إدارة المخاطر</button>
                <button class="suggestion-chip" onclick="sendSuggestion('اشرح لي مؤشر القوة النسبية RSI وكيفية استخدامه')">📈 شرح مؤشر RSI</button>
            </div>
        </div>
    `;
    document.getElementById('chatStatus').textContent = 'مساعد التداول الذكي جاهز';
}

function sendSuggestion(text) {
    document.getElementById('chatInput').value = text;
    document.getElementById('sendBtn').disabled = false;
    handleSendChat();
}

async function handleSendChat() {
    const input = document.getElementById('chatInput');
    const text = input.value.trim();
    if (!text || isStreaming) return;

    if (availableModels[chatModel] && !availableModels[chatModel].available) {
        addChatErrorMessage(`نموذج ${MODEL_DISPLAY[chatModel].name} غير مفعّل على الخادم. يرجى إضافة مفتاح API الخاص به في متغيرات Railway البيئية.`);
        return;
    }

    const welcome = document.getElementById('welcomeMessage');
    if (welcome) welcome.remove();

    addChatMessage(text, 'user');
    
    // Construct contextual system prompt additions to help AI know current instrument & price
    const currentBid = document.getElementById('bidPrice').textContent;
    const currentAsk = document.getElementById('askPrice').textContent;
    const currentSpread = document.getElementById('spreadVal').textContent;
    const instrumentName = INSTRUMENT_DISPLAY[currentInstrument]?.name || currentInstrument;

    // We build the message array to send to backend, inject system metadata as a system message if it's the first message, 
    // or as a prompt enhancement helper for current context.
    const apiMessages = [...messages];
    apiMessages.push({ 
        role: 'user', 
        content: `[معلومات السوق الحالية للتداول: الزوج المختار حالياً بالرسم البياني هو ${instrumentName}، سعر البيع (Bid) الحالي: ${currentBid}، سعر الشراء (Ask) الحالي: ${currentAsk}، الفارق (Spread) الحالي: ${currentSpread} نقاط. يرجى أخذ هذا بعين الاعتبار والرد استناداً إليه كبيانات حية ومباشرة إذا طلب المستخدم أو سأل عن السعر أو التحليل].\n\nالسؤال/الطلب: ${text}` 
    });

    // Save the clean message version in local state history so the UI doesn't display the system inject code
    messages.push({ role: 'user', content: text });

    input.value = '';
    input.style.height = 'auto';
    document.getElementById('sendBtn').disabled = true;

    const loading = addChatLoading();
    document.getElementById('chatStatus').textContent = 'يكتب...';
    isStreaming = true;

    try {
        const response = await fetch('/api/chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ model: chatModel, messages: apiMessages })
        });

        const data = await response.json();

        if (!response.ok) {
            throw new Error(data.error || 'فشل توليد الاستجابة');
        }

        loading.remove();
        addChatMessage(data.response, 'ai');
        messages.push({ role: 'assistant', content: data.response });
        document.getElementById('chatStatus').textContent = 'مساعد التداول الذكي جاهز';
    } catch (error) {
        loading.remove();
        addChatErrorMessage(error.message);
        document.getElementById('chatStatus').textContent = 'فشل الرد';
    } finally {
        isStreaming = false;
        document.getElementById('sendBtn').disabled = !input.value.trim();
    }
}

function addChatMessage(text, sender) {
    const messagesContainer = document.getElementById('chatMessages');
    const el = document.createElement('div');
    el.className = `message ${sender}`;
    
    const now = new Date();
    const timeStr = now.toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' });
    const name = sender === 'ai' ? MODEL_DISPLAY[chatModel].name : 'أنت';

    el.innerHTML = `
        <div class="message-bubble">${escapeHtml(text)}</div>
        <span class="message-meta">${name} · ${timeStr}</span>
    `;

    messagesContainer.appendChild(el);
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
}

function addChatLoading() {
    const messagesContainer = document.getElementById('chatMessages');
    const el = document.createElement('div');
    el.className = 'message ai';
    el.innerHTML = `
        <div class="message-bubble loading">
            <span></span><span></span><span></span>
        </div>
    `;
    messagesContainer.appendChild(el);
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
    return el;
}

function addChatErrorMessage(text) {
    const messagesContainer = document.getElementById('chatMessages');
    const el = document.createElement('div');
    el.className = 'message-error';
    el.textContent = `⚠️ ${text}`;
    messagesContainer.appendChild(el);
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
}

// ========== Utilities & Helper Functions ==========
function formatCurrency(num) {
    return '$' + parseFloat(num).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function showToast(message, type = 'info') {
    const toast = document.createElement('div');
    toast.className = 'toast';
    
    let bg = 'rgba(15, 22, 38, 0.95)';
    let border = '1px solid rgba(255,255,255,0.1)';
    if (type === 'success') {
        bg = 'rgba(34, 197, 94, 0.95)';
        border = '1px solid rgba(34, 197, 94, 0.2)';
    } else if (type === 'error') {
        bg = 'rgba(239, 68, 68, 0.95)';
        border = '1px solid rgba(239, 68, 68, 0.2)';
    }
    
    toast.textContent = message;
    toast.style.cssText = `
        position: fixed;
        bottom: 24px;
        right: 24px;
        background: ${bg};
        border: ${border};
        color: white;
        padding: 12px 24px;
        border-radius: var(--radius-md);
        font-family: var(--font-ar);
        font-size: 0.85rem;
        z-index: 99999;
        opacity: 0;
        transform: translateY(10px);
        transition: all 0.3s ease;
        box-shadow: 0 4px 12px rgba(0,0,0,0.3);
    `;
    document.body.appendChild(toast);
    
    requestAnimationFrame(() => {
        toast.style.opacity = '1';
        toast.style.transform = 'translateY(0)';
    });

    setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transform = 'translateY(10px)';
        setTimeout(() => toast.remove(), 300);
    }, 4000);
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}
