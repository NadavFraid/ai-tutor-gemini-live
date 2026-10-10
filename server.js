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

// פונקציית עזר להזרמת הודעות בתוך סשן צ'אט עם מנגנון Retry לשגיאות 500 זמניות
async function sendMessageWithRetry(chatSession, text, ws, retries = 2) {
  try {
    const resultStream = await chatSession.sendMessageStream(text);
    for await (const chunk of resultStream.stream) {
      const chunkText = chunk.text();
      ws.send(JSON.stringify({
        type: 'text_chunk',
        text: chunkText
      }));
    }
    ws.send(JSON.stringify({ type: 'stream_end' }));
  } catch (err) {
    if (retries > 0 && err.message && err.message.includes('500')) {
      console.log(`Temporary 500 error from Google. Retrying... (${retries} retries left)`);
      await new Promise(res => setTimeout(res, 1000));
      return sendMessageWithRetry(chatSession, text, ws, retries - 1);
    }
    throw err;
  }
}

wss.on('connection', (ws) => {
  console.log('Client connected via WebSocket');

  // יצירת סשן צ'אט עם הדגם הנתמך
  let chatSession = null;
  try {
    const model = genAI.getGenerativeModel({
      model: 'gemini-3.8-flash',
      systemInstruction: SYSTEM_INSTRUCTION
    });
    chatSession = model.startChat();
  } catch (err) {
    console.error('Error initializing chat model:', err);
  }

  ws.on('message', async (data) => {
    try {
      const message = JSON.parse(data);

      if (message.type === 'text_query') {
        if (!chatSession) {
          const model = genAI.getGenerativeModel({
            model: 'gemini-3.8-flash',
            systemInstruction: SYSTEM_INSTRUCTION
          });
          chatSession = model.startChat();
        }

        await sendMessageWithRetry(chatSession, message.text, ws);
      }
    } catch (err) {
      console.error('Error in streaming response:', err);
      ws.send(JSON.stringify({
        type: 'error',
        message: `שגיאה: ${err.message || 'אנא נסה לשלוח את ההודעה שוב.'}`
      }));
    }
  });

  ws.on('close', () => {
    console.log('Client disconnected');
  });
});

server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
