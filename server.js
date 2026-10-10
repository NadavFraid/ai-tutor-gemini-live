
const express = require('express');
const http = require('http');
const path = require('path');
const WebSocket = require('ws');
const { GoogleGenAI } = require('@google/genai');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const PORT = process.env.PORT || 3000;
const apiKey = process.env.GEMINI_API_KEY;

if (!apiKey) {
  console.error("ERROR: GEMINI_API_KEY is not defined in environment variables!");
}

const ai = new GoogleGenAI({ apiKey });

// הגשת קבצים סטטיים מתיקיית public
app.use(express.static(path.join(__dirname, 'public')));

// הגדרות המורה הפרטי
const SYSTEM_INSTRUCTION = `
אתה מורה פרטי סבלני, מעודד ומקצועי לתלמיד בכיתה ח' בישראל.
שמך הוא 'אריאל'.
תפקידך לסייע במקצועות: מתמטיקה, פיזיקה, אנגלית ומדעים.
- אל תיתן את התשובות הסופיות מייד, אלא הדרך אותו צעד אחר צעד (שיטה סוקרטית).
- דבר בעברית ברורה, נעימה ובגובה העיניים. במצב אנגלית, שלב שיחה קלה באנגלית.
- שמור על תשובות ממוקדות וקצרות כדי לאפשר שיחה קולית זורמת.
`;

wss.on('connection', (ws) => {
  console.log('Client connected via WebSocket');

  // טיפול בהודעות מהדפדפן
  ws.on('message', async (data) => {
    try {
      const message = JSON.parse(data);

      if (message.type === 'text_query') {
        // שליחת שאילתת טקסט ל-Gemini
        const response = await ai.models.generateContent({
          model: 'gemini-2.5-flash',
          contents: message.text,
          config: {
            systemInstruction: SYSTEM_INSTRUCTION
          }
        });

        ws.send(JSON.stringify({
          type: 'text_response',
          text: response.text
        }));
      }
    } catch (err) {
      console.error('Error processing message:', err);
      ws.send(JSON.stringify({
        type: 'error',
        message: 'שגיאה בעיבוד הבקשה'
      }));
    }
  });

  ws.on('close', () => {
    console.log('Client disconnected');
  });
});

server.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
