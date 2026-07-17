const express = require('express');
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ========== API Keys from Environment Variables ==========
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

// ========== Check which models are available ==========
app.get('/api/models', (req, res) => {
    const keys = getApiKeys();
    res.json({
        chatgpt: { available: !!keys.openai, model: getModels().openai },
        gemini: { available: !!keys.gemini, model: getModels().gemini },
        deepseek: { available: !!keys.deepseek, model: getModels().deepseek },
    });
});

// ========== Chat endpoint ==========
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

// ========== OpenAI-Compatible API (ChatGPT & DeepSeek) ==========
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

// ========== Gemini API ==========
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
            throw new Error('تم تجاوز حد الطلبات. يرجى المحاولة لاحقاً');
        } else {
            throw new Error(errorData.error?.message || `خطأ في الخادم (${response.status})`);
        }
    }

    const data = await response.json();
    return data.candidates[0].content.parts[0].text;
}

// ========== Fallback: Serve index.html ==========
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ========== Start Server ==========
app.listen(PORT, () => {
    const keys = getApiKeys();
    console.log(`\n🚀 AI Chat Hub server running on port ${PORT}`);
    console.log(`📡 Available models:`);
    console.log(`   ChatGPT:  ${keys.openai ? '✅ Ready' : '❌ No API key'}`);
    console.log(`   Gemini:   ${keys.gemini ? '✅ Ready' : '❌ No API key'}`);
    console.log(`   DeepSeek: ${keys.deepseek ? '✅ Ready' : '❌ No API key'}`);
    console.log('');
});
