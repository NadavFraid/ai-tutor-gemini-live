const express = require('express');
const http = require('http');
const path = require('path');
const WebSocket = require('ws');
const { GoogleGenerativeAI } = require('@google/generative-ai');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const PORT = process.env.PORT || 3000;
const apiKey = process.env.GEMINI_API_KEY;

if (!apiKey) {
  console.error("ERROR: GEMINI_API_KEY is not defined in environment variables!");
}

const genAI = new GoogleGenerativeAI(apiKey || '');

app.use(express.static(path.join(__dirname, 'public')));

const SYSTEM_INSTRUCTION = `
אתה מורה פרטי סבלני, מעודד ומקצועי לתלמיד בכיתה ח' בישראל.
שמך הוא 'אריאל'.
תפקידך לסייע במקצועות: מתמטיקה, פיזיקה, אנגלית ומדעים.
- אל תיתן את התשובות הסופיות מייד, אלא הדרך אותו צעד אחר צעד (שיטה סוקרטית).
- דבר בעברית ברורה, נעימה ובגובה העיניים.
- ענה בקצרה ובמהירות (1-2 משפטים קצרים בלבד בכל תגובה).
`;

let activeModelName = null;

// שליפת רשימת המודלים הפעילים ישירות מ-Google API
async function fetchValidModel() {
  try {
    console.log('[LOG] Querying Google API for active models list...');
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`);
    const data = await response.json();
    
    if (data.models && data.models.length > 0) {
      // סינון מודלים שתומכים ב-generateContent
      const generateModels = data.models.filter(m => 
        m.supportedGenerationMethods && m.supportedGenerationMethods.includes('generateContent')
      );

      // עדיפות למודל flash
      const flashModel = generateModels.find(m => m.name.includes('flash'));
      if (flashModel) {
        // הסרת הקידומת models/ אם קיימת
        const cleanName = flashModel.name.replace('models/', '');
        console.log(`[SUCCESS] Dynamically selected model: ${cleanName}`);
        return cleanName;
      }

      if (generateModels.length > 0) {
        const cleanName = generateModels[0].name.replace('models/', '');
        console.log(`[SUCCESS] Dynamically selected fallback model: ${cleanName}`);
        return cleanName;
      }
    }
  } catch (err) {
    console.error('[ERROR] Failed to fetch models list:', err);
  }

  // ברירת מחדל מפורשת לפי הצעת השגיאה של גוגל
  return 'gemini-3.8-flash';
}

// זיהוי המודל בעת עליית השרת
fetchValidModel().then(modelName => {
  activeModelName = modelName;
  console.log(`[SERVER READY] Active model set to: ${activeModelName}`);
});

wss.on('connection', (ws) => {
  console.log('[LOG] Client connected via WebSocket');
  const history = [];

  ws.on('message', async (data) => {
    const startTime = Date.now();
    try {
      const message = JSON.parse(data);

      if (!activeModelName) {
        activeModelName = await fetchValidModel();
      }

      console.log(`[LOG] Query: "${message.text}" using model: ${activeModelName}`);

      const model = genAI.getGenerativeModel({
        model: activeModelName,
        systemInstruction: SYSTEM_INSTRUCTION
      });

      history.push({ role: 'user', parts: [{ text: message.text }] });

      const resultStream = await model.generateContentStream({ contents: history });

      let fullModelResponse = '';
      let firstChunk = true;

      for await (const chunk of resultStream.stream) {
        if (firstChunk) {
          console.log(`[LOG] First chunk in ${Date.now() - startTime}ms`);
          firstChunk = false;
        }
        const chunkText = chunk.text();
        fullModelResponse += chunkText;
        ws.send(JSON.stringify({ type: 'text_chunk', text: chunkText }));
      }

      history.push({ role: 'model', parts: [{ text: fullModelResponse }] });
      ws.send(JSON.stringify({ type: 'stream_end' }));

    } catch (err) {
      console.error('[ERROR] Stream error:', err);
      ws.send(JSON.stringify({
        type: 'error',
        message: `שגיאת תקשורת: ${err.message}`
      }));
    }
  });

  ws.on('close', () => {
    console.log('[LOG] Client disconnected');
  });
});

server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
