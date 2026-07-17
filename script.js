// ========== State ==========
let currentModel = 'chatgpt';
let chatOpen = false;
let messages = [];
let isStreaming = false;

const MODEL_CONFIG = {
    chatgpt: {
        name: 'ChatGPT',
        apiUrl: 'https://api.openai.com/v1/chat/completions',
        model: 'gpt-4o',
        keyId: 'openaiKey',
        color: '#10a37f',
        gradient: 'linear-gradient(135deg, #10a37f, #1a7f5a)',
    },
    gemini: {
        name: 'Gemini',
        apiUrl: 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent',
        model: 'gemini-2.0-flash',
        keyId: 'geminiKey',
        color: '#4285f4',
        gradient: 'linear-gradient(135deg, #4285f4, #6c47ff)',
    },
    deepseek: {
        name: 'DeepSeek',
        apiUrl: 'https://api.deepseek.com/chat/completions',
        model: 'deepseek-chat',
        keyId: 'deepseekKey',
        color: '#536dfe',
        gradient: 'linear-gradient(135deg, #536dfe, #304ffe)',
    }
};

// ========== DOM References ==========
const chatPanel = document.getElementById('chatPanel');
const chatFab = document.getElementById('chatFab');
const chatMessages = document.getElementById('chatMessages');
const chatInput = document.getElementById('chatInput');
const sendBtn = document.getElementById('sendBtn');
const chatModelName = document.getElementById('chatModelName');
const chatHeaderAvatar = document.getElementById('chatHeaderAvatar');
const chatStatus = document.getElementById('chatStatus');
const welcomeMessage = document.getElementById('welcomeMessage');

// ========== Initialize ==========
document.addEventListener('DOMContentLoaded', () => {
    loadApiKeys();
    setupEventListeners();
    setupNavScroll();
    setupIntersectionObserver();
});

// ========== Event Listeners ==========
function setupEventListeners() {
    // Chat FAB
    chatFab.addEventListener('click', toggleChat);

    // Open chat buttons
    document.getElementById('openChatBtn').addEventListener('click', openChat);
    document.getElementById('heroStartChat').addEventListener('click', openChat);
    document.getElementById('heroSettings').addEventListener('click', () => {
        document.getElementById('settings-section').scrollIntoView({ behavior: 'smooth' });
    });

    // Close chat
    document.getElementById('closeChatBtn').addEventListener('click', closeChat);

    // Clear chat
    document.getElementById('clearChatBtn').addEventListener('click', clearChat);

    // Model tabs
    document.querySelectorAll('.model-tab').forEach(tab => {
        tab.addEventListener('click', () => {
            switchModel(tab.dataset.model);
        });
    });

    // Send message
    sendBtn.addEventListener('click', handleSend);
    chatInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            handleSend();
        }
    });

    // Input auto-resize & button state
    chatInput.addEventListener('input', () => {
        chatInput.style.height = 'auto';
        chatInput.style.height = Math.min(chatInput.scrollHeight, 100) + 'px';
        sendBtn.disabled = !chatInput.value.trim() || isStreaming;
    });

    // Smooth scroll for nav links
    document.querySelectorAll('.nav-link').forEach(link => {
        link.addEventListener('click', (e) => {
            e.preventDefault();
            const target = document.querySelector(link.getAttribute('href'));
            if (target) target.scrollIntoView({ behavior: 'smooth' });
        });
    });
}

// ========== Navigation Scroll Effect ==========
function setupNavScroll() {
    const navbar = document.getElementById('navbar');
    window.addEventListener('scroll', () => {
        if (window.scrollY > 50) {
            navbar.classList.add('scrolled');
        } else {
            navbar.classList.remove('scrolled');
        }
    });
}

// ========== Intersection Observer for Animations ==========
function setupIntersectionObserver() {
    const observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                entry.target.style.animation = 'fadeInUp 0.6s ease forwards';
            }
        });
    }, { threshold: 0.1 });

    document.querySelectorAll('.feature-card, .model-card, .setting-card').forEach(card => {
        card.style.opacity = '0';
        card.style.transform = 'translateY(24px)';
        observer.observe(card);
    });
}

// ========== Chat Panel Controls ==========
function toggleChat() {
    chatOpen ? closeChat() : openChat();
}

function openChat() {
    chatOpen = true;
    chatPanel.classList.add('open');
    chatFab.classList.add('active');
    setTimeout(() => chatInput.focus(), 300);
}

function closeChat() {
    chatOpen = false;
    chatPanel.classList.remove('open');
    chatFab.classList.remove('active');
}

function clearChat() {
    messages = [];
    chatMessages.innerHTML = '';
    chatMessages.appendChild(welcomeMessage.cloneNode(true));
    document.getElementById('welcomeMessage')?.remove();
    chatStatus.textContent = 'جاهز للمحادثة';
}

// ========== Model Switching ==========
function switchModel(model) {
    currentModel = model;
    const config = MODEL_CONFIG[model];

    // Update tabs
    document.querySelectorAll('.model-tab').forEach(tab => {
        tab.classList.toggle('active', tab.dataset.model === model);
    });

    // Update header
    chatModelName.textContent = config.name;
    chatHeaderAvatar.style.background = config.gradient;
    chatStatus.textContent = 'جاهز للمحادثة';
}

// ========== API Key Management ==========
function loadApiKeys() {
    Object.keys(MODEL_CONFIG).forEach(model => {
        const key = localStorage.getItem(`ai_chat_${model}_key`);
        if (key) {
            document.getElementById(MODEL_CONFIG[model].keyId).value = key;
            updateKeyStatus(model, true);
        }
    });
}

function saveApiKeys() {
    let savedCount = 0;
    Object.keys(MODEL_CONFIG).forEach(model => {
        const input = document.getElementById(MODEL_CONFIG[model].keyId);
        const key = input.value.trim();
        if (key) {
            localStorage.setItem(`ai_chat_${model}_key`, key);
            updateKeyStatus(model, true);
            savedCount++;
        } else {
            localStorage.removeItem(`ai_chat_${model}_key`);
            updateKeyStatus(model, false);
        }
    });

    if (savedCount > 0) {
        showToast(`تم حفظ ${savedCount} مفتاح/مفاتيح بنجاح ✓`);
    }
}

function clearApiKeys() {
    Object.keys(MODEL_CONFIG).forEach(model => {
        localStorage.removeItem(`ai_chat_${model}_key`);
        document.getElementById(MODEL_CONFIG[model].keyId).value = '';
        updateKeyStatus(model, false);
    });
    showToast('تم مسح جميع المفاتيح');
}

function updateKeyStatus(model, saved) {
    const statusMap = {
        chatgpt: 'openaiStatus',
        gemini: 'geminiStatus',
        deepseek: 'deepseekStatus'
    };
    const statusEl = document.getElementById(statusMap[model]);
    if (saved) {
        statusEl.textContent = '✓ المفتاح محفوظ';
        statusEl.className = 'key-status saved';
    } else {
        statusEl.textContent = '';
        statusEl.className = 'key-status';
    }
}

function toggleKeyVisibility(inputId, btn) {
    const input = document.getElementById(inputId);
    if (input.type === 'password') {
        input.type = 'text';
        btn.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>';
    } else {
        input.type = 'password';
        btn.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>';
    }
}

// ========== Toast Notification ==========
function showToast(message) {
    const existing = document.querySelector('.toast');
    if (existing) existing.remove();

    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.textContent = message;
    toast.style.cssText = `
        position: fixed;
        bottom: 100px;
        left: 50%;
        transform: translateX(-50%) translateY(20px);
        background: rgba(22, 22, 34, 0.95);
        backdrop-filter: blur(12px);
        border: 1px solid rgba(255,255,255,0.1);
        color: #f0f0f5;
        padding: 12px 24px;
        border-radius: 12px;
        font-family: 'Cairo', sans-serif;
        font-size: 0.9rem;
        z-index: 9999;
        opacity: 0;
        transition: all 0.3s ease;
        box-shadow: 0 8px 32px rgba(0,0,0,0.4);
    `;
    document.body.appendChild(toast);
    requestAnimationFrame(() => {
        toast.style.opacity = '1';
        toast.style.transform = 'translateX(-50%) translateY(0)';
    });
    setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transform = 'translateX(-50%) translateY(20px)';
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}

// ========== Chat Messaging ==========
function sendSuggestion(text) {
    chatInput.value = text;
    sendBtn.disabled = false;
    handleSend();
}

async function handleSend() {
    const text = chatInput.value.trim();
    if (!text || isStreaming) return;

    // Check API key
    const config = MODEL_CONFIG[currentModel];
    const apiKey = localStorage.getItem(`ai_chat_${currentModel}_key`);

    if (!apiKey) {
        addErrorMessage(`يرجى إضافة مفتاح API الخاص بـ ${config.name} في قسم الإعدادات أولاً`);
        return;
    }

    // Remove welcome message
    const welcome = chatMessages.querySelector('.welcome-message');
    if (welcome) welcome.remove();

    // Add user message
    addMessage(text, 'user');
    messages.push({ role: 'user', content: text });

    // Clear input
    chatInput.value = '';
    chatInput.style.height = 'auto';
    sendBtn.disabled = true;

    // Show loading
    const loadingEl = addLoadingMessage();
    chatStatus.textContent = 'يكتب...';
    isStreaming = true;

    try {
        let response;
        if (currentModel === 'gemini') {
            response = await callGeminiAPI(apiKey, messages);
        } else {
            response = await callOpenAICompatibleAPI(config, apiKey, messages);
        }

        loadingEl.remove();
        addMessage(response, 'ai');
        messages.push({ role: 'assistant', content: response });
        chatStatus.textContent = 'جاهز للمحادثة';
    } catch (error) {
        loadingEl.remove();
        addErrorMessage(error.message || 'حدث خطأ أثناء الاتصال بالنموذج');
        chatStatus.textContent = 'حدث خطأ';
    } finally {
        isStreaming = false;
        sendBtn.disabled = !chatInput.value.trim();
    }
}

// ========== API Calls ==========
async function callOpenAICompatibleAPI(config, apiKey, chatMessages) {
    const response = await fetch(config.apiUrl, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`
        },
        body: JSON.stringify({
            model: config.model,
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
        if (response.status === 401) {
            throw new Error('مفتاح API غير صالح. يرجى التحقق من المفتاح في الإعدادات');
        } else if (response.status === 429) {
            throw new Error('تم تجاوز حد الطلبات. يرجى المحاولة لاحقاً');
        } else {
            throw new Error(errorData.error?.message || `خطأ في الخادم (${response.status})`);
        }
    }

    const data = await response.json();
    return data.choices[0].message.content;
}

async function callGeminiAPI(apiKey, chatMessages) {
    const url = `${MODEL_CONFIG.gemini.apiUrl}?key=${apiKey}`;

    // Convert messages to Gemini format
    const contents = chatMessages.map(m => ({
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: m.content }]
    }));

    const response = await fetch(url, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
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
        if (response.status === 400) {
            throw new Error('مفتاح API غير صالح أو طلب غير صحيح');
        } else if (response.status === 429) {
            throw new Error('تم تجاوز حد الطلبات. يرجى المحاولة لاحقاً');
        } else {
            throw new Error(errorData.error?.message || `خطأ في الخادم (${response.status})`);
        }
    }

    const data = await response.json();
    return data.candidates[0].content.parts[0].text;
}

// ========== UI Message Helpers ==========
function addMessage(text, sender) {
    const messageEl = document.createElement('div');
    messageEl.className = `message ${sender}`;

    const now = new Date();
    const time = now.toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' });
    const modelLabel = sender === 'ai' ? MODEL_CONFIG[currentModel].name : 'أنت';

    messageEl.innerHTML = `
        <div class="message-bubble">${escapeHtml(text)}</div>
        <span class="message-meta">${modelLabel} · ${time}</span>
    `;

    chatMessages.appendChild(messageEl);
    chatMessages.scrollTop = chatMessages.scrollHeight;
    return messageEl;
}

function addLoadingMessage() {
    const messageEl = document.createElement('div');
    messageEl.className = 'message ai';
    messageEl.innerHTML = `
        <div class="message-bubble loading">
            <span></span><span></span><span></span>
        </div>
    `;
    chatMessages.appendChild(messageEl);
    chatMessages.scrollTop = chatMessages.scrollHeight;
    return messageEl;
}

function addErrorMessage(text) {
    const errorEl = document.createElement('div');
    errorEl.className = 'message-error';
    errorEl.textContent = '⚠️ ' + text;
    chatMessages.appendChild(errorEl);
    chatMessages.scrollTop = chatMessages.scrollHeight;
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}
