// ========== State ==========
let currentModel = 'chatgpt';
let chatOpen = false;
let messages = [];
let isStreaming = false;
let availableModels = {};

const MODEL_DISPLAY = {
    chatgpt: {
        name: 'ChatGPT',
        color: '#10a37f',
        gradient: 'linear-gradient(135deg, #10a37f, #1a7f5a)',
    },
    gemini: {
        name: 'Gemini',
        color: '#4285f4',
        gradient: 'linear-gradient(135deg, #4285f4, #6c47ff)',
    },
    deepseek: {
        name: 'DeepSeek',
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
    checkAvailableModels();
    setupEventListeners();
    setupNavScroll();
    setupIntersectionObserver();
});

// ========== Check Available Models from Server ==========
async function checkAvailableModels() {
    try {
        const response = await fetch('/api/models');
        availableModels = await response.json();

        // Update UI to show which models are available
        Object.keys(availableModels).forEach(model => {
            const tab = document.getElementById(`tab-${model}`);
            if (tab) {
                if (availableModels[model].available) {
                    tab.classList.add('model-available');
                    tab.title = `${MODEL_DISPLAY[model].name} - جاهز ✓`;
                } else {
                    tab.classList.add('model-unavailable');
                    tab.title = `${MODEL_DISPLAY[model].name} - غير مُعد`;
                }
            }

            // Update model cards status indicators
            const statusEl = document.getElementById(`status-${model}`);
            if (statusEl) {
                if (availableModels[model].available) {
                    statusEl.textContent = '✅ متصل وجاهز';
                    statusEl.className = 'model-status-badge available';
                } else {
                    statusEl.textContent = '⚠️ غير مُعد';
                    statusEl.className = 'model-status-badge unavailable';
                }
            }
        });

        // Auto-select first available model
        const firstAvailable = Object.keys(availableModels).find(m => availableModels[m].available);
        if (firstAvailable) {
            switchModel(firstAvailable);
        }

    } catch (error) {
        console.error('Failed to check models:', error);
    }
}

// ========== Event Listeners ==========
function setupEventListeners() {
    // Chat FAB
    chatFab.addEventListener('click', toggleChat);

    // Open chat buttons
    document.getElementById('openChatBtn').addEventListener('click', openChat);
    document.getElementById('heroStartChat').addEventListener('click', openChat);

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

    document.querySelectorAll('.feature-card, .model-card').forEach(card => {
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
    // Re-create welcome message
    chatMessages.innerHTML = `
        <div class="welcome-message" id="welcomeMessage">
            <div class="welcome-icon">
                <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="url(#welcomeGrad)" stroke-width="1.5">
                    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
                    <defs><linearGradient id="welcomeGrad" x1="3" y1="3" x2="21" y2="21"><stop offset="0%" stop-color="#6366f1"/><stop offset="100%" stop-color="#a855f7"/></linearGradient></defs>
                </svg>
            </div>
            <h3>مرحباً! كيف يمكنني مساعدتك؟</h3>
            <p>اختر نموذج الذكاء الاصطناعي وابدأ المحادثة</p>
            <div class="welcome-suggestions">
                <button class="suggestion-chip" onclick="sendSuggestion('اشرح لي الذكاء الاصطناعي بشكل مبسط')">🤖 اشرح لي الذكاء الاصطناعي</button>
                <button class="suggestion-chip" onclick="sendSuggestion('اكتب لي كود بايثون لترتيب قائمة')">💻 اكتب لي كود بايثون</button>
                <button class="suggestion-chip" onclick="sendSuggestion('ما هي أحدث التقنيات في 2026؟')">🚀 أحدث التقنيات</button>
            </div>
        </div>
    `;
    chatStatus.textContent = 'جاهز للمحادثة';
}

// ========== Model Switching ==========
function switchModel(model) {
    currentModel = model;
    const display = MODEL_DISPLAY[model];

    // Update tabs
    document.querySelectorAll('.model-tab').forEach(tab => {
        tab.classList.toggle('active', tab.dataset.model === model);
    });

    // Update header
    chatModelName.textContent = display.name;
    chatHeaderAvatar.style.background = display.gradient;

    // Check availability
    if (availableModels[model] && !availableModels[model].available) {
        chatStatus.textContent = '⚠️ هذا النموذج غير مُعد على الخادم';
        chatStatus.style.color = '#f59e0b';
    } else {
        chatStatus.textContent = 'جاهز للمحادثة';
        chatStatus.style.color = '';
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

    // Check if model is available
    if (availableModels[currentModel] && !availableModels[currentModel].available) {
        addErrorMessage(`نموذج ${MODEL_DISPLAY[currentModel].name} غير مُعد على الخادم. يرجى إضافة مفتاح API في المتغيرات البيئية.`);
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
    chatStatus.style.color = '';
    isStreaming = true;

    try {
        const response = await fetch('/api/chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                model: currentModel,
                messages: messages
            })
        });

        const data = await response.json();

        if (!response.ok) {
            throw new Error(data.error || 'حدث خطأ غير متوقع');
        }

        loadingEl.remove();
        addMessage(data.response, 'ai');
        messages.push({ role: 'assistant', content: data.response });
        chatStatus.textContent = 'جاهز للمحادثة';

    } catch (error) {
        loadingEl.remove();
        addErrorMessage(error.message || 'حدث خطأ أثناء الاتصال بالخادم');
        chatStatus.textContent = 'حدث خطأ';
    } finally {
        isStreaming = false;
        sendBtn.disabled = !chatInput.value.trim();
    }
}

// ========== UI Message Helpers ==========
function addMessage(text, sender) {
    const messageEl = document.createElement('div');
    messageEl.className = `message ${sender}`;

    const now = new Date();
    const time = now.toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' });
    const modelLabel = sender === 'ai' ? MODEL_DISPLAY[currentModel].name : 'أنت';

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
