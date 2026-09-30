const express = require("express");
const dotenv = require("dotenv");
const fs = require("fs");
const path = require("path");

dotenv.config();

const app = express();

app.use(express.json({ limit: "2mb" }));
app.use(express.static("public"));

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

// =====================================================
// XORA CONFIG
// =====================================================

const PORT = process.env.PORT || 10000;
const GROQ_API_KEY = process.env.GROQ_API_KEY;
const CHAT_MODEL = "openai/gpt-oss-20b";
const MAX_MESSAGES = 10;
const MAX_PROMPT = 2000;

// =====================================================
// XORA MEMORY
// =====================================================

let conversation = [];

const memoryFile = path.join(__dirname, "xora-memory.json");

let savedMemory = [];

function loadMemory() {
  try {
    if (fs.existsSync(memoryFile)) {
      savedMemory = JSON.parse(
        fs.readFileSync(memoryFile, "utf8")
      );
    }
  } catch (error) {
    console.log("Memory load error:", error.message);
    savedMemory = [];
  }
}

function saveMemory() {
  try {
    fs.writeFileSync(
      memoryFile,
      JSON.stringify(savedMemory, null, 2)
    );
  } catch (error) {
    console.log("Memory save error:", error.message);
  }
}

loadMemory();

// =====================================================
// REMINDERS
// =====================================================

const reminderFile = path.join(__dirname, "xora-reminders.json");

let reminders = [];

function loadReminders() {
  try {
    if (fs.existsSync(reminderFile)) {
      reminders = JSON.parse(
        fs.readFileSync(reminderFile, "utf8")
      );
    }
  } catch (error) {
    console.log("Reminder load error:", error.message);
    reminders = [];
  }
}

function saveReminders() {
  try {
    fs.writeFileSync(
      reminderFile,
      JSON.stringify(reminders, null, 2)
    );
  } catch (error) {
    console.log("Reminder save error:", error.message);
  }
}

loadReminders();

// =====================================================
// IMAGE GENERATION PROTECTION
// =====================================================

const imageRequests = new Map();

const IMAGE_COOLDOWN = 15000;

function getClientKey(req) {
  const forwarded = req.headers["x-forwarded-for"];

  if (forwarded) {
    return forwarded.split(",")[0].trim();
  }

  return req.ip || "unknown";
}

// =====================================================
// XORA PERSONALITY
// =====================================================

const XORA_INSTRUCTIONS = `
You are Xora, Aditya's personal AI assistant.

IDENTITY:
- Your name is Xora.
- Aditya is your owner, creator, and maker.
- Never claim your name is ChatGPT or another assistant unless Aditya specifically asks about the underlying model.
- If Aditya asks who owns or created you, answer naturally.

PERSONALITY:
- Be warm, friendly, intelligent, natural, and playful.
- Talk like a modern conversational AI assistant, not a customer-service bot.
- Be conversational without pretending to be human.
- Match Aditya's tone.
- Understand casual messages, slang, short reactions, and Hinglish.
- Emojis are okay when they naturally fit, but don't overuse them.
- Avoid repetitive, robotic, overly formal, or scripted replies.
- Don't constantly use generic phrases such as "How can I assist you today?"

CONVERSATION:
- Understand the latest message in the context of the conversation.
- Answer what Aditya actually asked.
- Remember relevant information from the current conversation.
- Use saved Xora memory when relevant.
- Don't unnecessarily repeat information Aditya already knows.
- If something is genuinely unclear, ask a short clarification instead of inventing an answer.
- If Aditya corrects you, accept the correction naturally.
- Keep the conversation flowing naturally.
- Treat short reactions like "lol", "bruh", "nah", "yeah", "ewww", or emojis as reactions to the previous message when the context makes that clear.
- Don't randomly ask "What happened?" when a natural response is obvious.

ANSWER STYLE:
- Give the direct answer first.
- Keep normal answers reasonably concise.
- Give more detail when Aditya asks for it or when the topic needs it.
- For simple questions, don't turn the answer into a huge lecture.
- For difficult questions, explain clearly and step by step.
- Use headings, bullets, numbered steps, and code blocks when useful.
- Don't add unnecessary filler.
- Don't repeat the same point unnecessarily.

ACCURACY:
- Never knowingly invent facts, links, commands, results, or capabilities.
- If uncertain, say so clearly.
- Don't pretend to have performed an action you cannot perform.
- Distinguish facts from assumptions.
- When current information is required and web search is available, use it when appropriate.
- Always follow the current date and time supplied by the server when discussing current dates or times.

CODING AND PROJECT HELP:
- Give practical, copy-pasteable solutions.
- Preserve existing project features unless Aditya asks to remove them.
- For substantial file changes, prefer complete replacement code.
- For small changes, clearly identify exactly what should change.
- Check code carefully for likely syntax errors.
- Give Android/Termux-compatible commands when relevant.
- Explain Nano controls clearly when needed.
- Never ask Aditya to send API keys, passwords, tokens, or other secrets.
- Keep secrets private.

IMPORTANT:
- Follow Aditya's actual request.
- Don't add unrelated features unless he asks.
- Stay consistent with Xora's identity and personality.
- Be helpful, natural, conversational, concise by default, and detailed when requested.
`;

// =====================================================
// OPENAI REQUEST HELPER
// =====================================================

async function openAIRequest(body) {
if (!GROQ_API_KEY) {
throw new Error("GROQ_API_KEY is not configured.");
  }

  const response = await fetch(
"https://api.groq.com/openai/v1/responses",
    {
      method: "POST",

      headers: {
        "Content-Type": "application/json",
"Authorization": `Bearer ${GROQ_API_KEY}`
      },

      body: JSON.stringify(body)
    }
  );

  const data = await response.json();

  if (!response.ok) {
    const error = new Error(
      data.error?.message ||
      "OpenAI API request failed."
    );

    error.status = response.status;
    error.data = data;

    throw error;
  }

  return data;
}

// =====================================================
// EXTRACT RESPONSE TEXT
// =====================================================

function getResponseText(data) {
  return (
    data.output
      ?.filter(item => item.type === "message")
      ?.flatMap(item => item.content || [])
      ?.filter(item => item.type === "output_text")
      ?.map(item => item.text)
      ?.join("\n")
      ?.trim() || ""
  );
}

// =====================================================
// CHAT API
// =====================================================

app.post("/api/chat", async (req, res) => {
  try {
    const message = req.body.message;

    if (!message || !message.trim()) {
      return res.status(400).json({
        error: "Message is required."
      });
    }

    const userMessage = message.trim();

    if (userMessage.length > MAX_PROMPT) {
      return res.status(400).json({
        error: `Message must be ${MAX_PROMPT} characters or less.`
      });
    }

    // Current India date/time
    const currentDateTime =
      new Intl.DateTimeFormat("en-IN", {
        dateStyle: "full",
        timeStyle: "long",
        timeZone: "Asia/Kolkata"
      }).format(new Date());

    conversation.push({
      role: "user",
      content: userMessage
    });

    if (conversation.length > MAX_MESSAGES) {
      conversation =
        conversation.slice(-MAX_MESSAGES);
    }

    const memoryText =
      savedMemory.length > 0
        ? savedMemory
            .slice(-50)
            .map(item => `- ${item}`)
            .join("\n")
        : "No saved memories.";

    const input = [
      {
        role: "developer",
        content: `
${XORA_INSTRUCTIONS}

CURRENT INDIA DATE AND TIME:
${currentDateTime}

SAVED XORA MEMORY:
${memoryText}
`
      },
      ...conversation
    ];

const data = await openAIRequest({
  model: CHAT_MODEL,
  input: input
});

    const reply = getResponseText(data);

    if (!reply) {
      return res.json({
        reply: "I didn't get a response 😅"
      });
    }

    conversation.push({
      role: "assistant",
      content: reply
    });

    if (conversation.length > MAX_MESSAGES) {
      conversation =
        conversation.slice(-MAX_MESSAGES);
    }

    res.json({
      reply,
      currentDateTime
    });

  } catch (error) {
    console.error("Chat error:", error);

    if (error.data) {
      console.error(error.data);
    }

    res.status(error.status || 500).json({
      error:
        error.message ||
        "Server error."
    });
  }
});

// =====================================================
// SAVE MEMORY
// =====================================================

app.post("/api/memory", (req, res) => {
  const memory = req.body.memory;

  if (!memory || !memory.trim()) {
    return res.status(400).json({
      error: "Memory is required."
    });
  }

  const cleanMemory = memory.trim();

  if (cleanMemory.length > 500) {
    return res.status(400).json({
      error: "Memory is too long."
    });
  }

  savedMemory.push(cleanMemory);

  if (savedMemory.length > 100) {
    savedMemory =
      savedMemory.slice(-100);
  }

  saveMemory();

  res.json({
    success: true,
    memory: cleanMemory
  });
});

// =====================================================
// GET MEMORY
// =====================================================

app.get("/api/memory", (req, res) => {
  res.json({
    memories: savedMemory
  });
});

// =====================================================
// CLEAR MEMORY
// =====================================================

app.post("/api/clear-memory", (req, res) => {
  conversation = [];

  res.json({
    success: true
  });
});

// =====================================================
// CLEAR SAVED MEMORY
// =====================================================

app.post("/api/delete-saved-memory", (req, res) => {
  savedMemory = [];

  saveMemory();

  res.json({
    success: true
  });
});

// =====================================================
// CURRENT DATE/TIME
// =====================================================

app.get("/api/time", (req, res) => {
  const now = new Date();

  const formatted =
    new Intl.DateTimeFormat("en-IN", {
      dateStyle: "full",
      timeStyle: "long",
      timeZone: "Asia/Kolkata"
    }).format(now);

  res.json({
    dateTime: formatted,
    iso: now.toISOString(),
    timezone: "Asia/Kolkata"
  });
});

// =====================================================
// CALCULATOR
// =====================================================

function calculateExpression(expression) {
  const cleaned = expression
    .replace(/\s+/g, "")
    .replace(/×/g, "*")
    .replace(/÷/g, "/");

  if (!/^[0-9+\-*/().%^]+$/.test(cleaned)) {
    throw new Error(
      "Only basic mathematical expressions are allowed."
    );
  }

  function parseExpression() {
    let index = 0;

    function parsePrimary() {
      if (cleaned[index] === "(") {
        index++;

        const value = parseAddSubtract();

        if (cleaned[index] !== ")") {
          throw new Error("Invalid expression.");
        }

        index++;
        return value;
      }

      const start = index;

      while (
        index < cleaned.length &&
        /[0-9.]/.test(cleaned[index])
      ) {
        index++;
      }

      if (start === index) {
        throw new Error("Invalid number.");
      }

      const number =
        Number(cleaned.slice(start, index));

      if (!Number.isFinite(number)) {
        throw new Error("Invalid number.");
      }

      return number;
    }

    function parsePower() {
      let value = parsePrimary();

      while (cleaned[index] === "^") {
        index++;

        const right = parsePrimary();

        value = Math.pow(value, right);
      }

      return value;
    }

    function parseMultiplyDivide() {
      let value = parsePower();

      while (
        cleaned[index] === "*" ||
        cleaned[index] === "/" ||
        cleaned[index] === "%"
      ) {
        const operator = cleaned[index++];

        const right = parsePower();

        if (
          operator === "/" &&
          right === 0
        ) {
          throw new Error(
            "Cannot divide by zero."
          );
        }

        if (operator === "*") {
          value *= right;
        } else if (operator === "/") {
          value /= right;
        } else {
          value %= right;
        }
      }

      return value;
    }

    function parseAddSubtract() {
      let value = parseMultiplyDivide();

      while (
        cleaned[index] === "+" ||
        cleaned[index] === "-"
      ) {
        const operator = cleaned[index++];

        const right =
          parseMultiplyDivide();

        if (operator === "+") {
          value += right;
        } else {
          value -= right;
        }
      }

      return value;
    }

    const result = parseAddSubtract();

    if (index !== cleaned.length) {
      throw new Error("Invalid expression.");
    }

    return result;
  }

  return parseExpression();
}

app.post("/api/calculate", (req, res) => {
  try {
    const expression = req.body.expression;

    if (
      typeof expression !== "string" ||
      !expression.trim()
    ) {
      return res.status(400).json({
        error: "Expression is required."
      });
    }

    const result =
      calculateExpression(expression.trim());

    res.json({
      expression: expression.trim(),
      result
    });

  } catch (error) {
    res.status(400).json({
      error: error.message
    });
  }
});

// =====================================================
// REMINDERS
// =====================================================

app.post("/api/reminders", (req, res) => {
  const text = req.body.text;
  const time = req.body.time;

  if (
    typeof text !== "string" ||
    !text.trim()
  ) {
    return res.status(400).json({
      error: "Reminder text is required."
    });
  }

  if (!time) {
    return res.status(400).json({
      error: "Reminder time is required."
    });
  }

  const reminderTime =
    new Date(time).getTime();

  if (!Number.isFinite(reminderTime)) {
    return res.status(400).json({
      error: "Invalid reminder time."
    });
  }

  if (reminderTime <= Date.now()) {
    return res.status(400).json({
      error: "Reminder time must be in the future."
    });
  }

  const reminder = {
    id: Date.now().toString(),
    text: text.trim(),
    time: new Date(reminderTime).toISOString(),
    completed: false
  };

  reminders.push(reminder);

  saveReminders();

  res.json({
    success: true,
    reminder
  });
});

app.get("/api/reminders", (req, res) => {
  res.json({
    reminders
  });
});

app.delete("/api/reminders/:id", (req, res) => {
  const before = reminders.length;

  reminders =
    reminders.filter(
      reminder =>
        reminder.id !== req.params.id
    );

  saveReminders();

  res.json({
    success: reminders.length !== before
  });
});

// =====================================================
// IMAGE GENERATION
// =====================================================

app.post("/api/generate-image", async (req, res) => {
  try {
    const prompt = req.body.prompt;

    if (!prompt || !prompt.trim()) {
      return res.status(400).json({
        error: "Image prompt is required."
      });
    }

    const cleanPrompt = prompt.trim();

    if (cleanPrompt.length > MAX_PROMPT) {
      return res.status(400).json({
        error:
          `Image prompt must be ${MAX_PROMPT} characters or less.`
      });
    }

    const clientKey =
      getClientKey(req);

    const now = Date.now();

    const lastRequest =
      imageRequests.get(clientKey) || 0;

    if (
      now - lastRequest <
      IMAGE_COOLDOWN
    ) {
      const waitSeconds =
        Math.ceil(
          (
            IMAGE_COOLDOWN -
            (now - lastRequest)
          ) / 1000
        );

      return res.status(429).json({
        error:
          `Please wait ${waitSeconds} seconds before generating another image.`
      });
    }

    imageRequests.set(
      clientKey,
      now
    );

    const response = await fetch(
      "https://api.openai.com/v1/images/generations",
      {
        method: "POST",

        headers: {
          "Content-Type": "application/json",
          "Authorization":
            `Bearer ${OPENAI_API_KEY}`
        },

        body: JSON.stringify({
          model: "gpt-image-2",
          prompt: cleanPrompt,
          size: "1024x1024",
          quality: "auto",
          n: 1
        })
      }
    );

    const data =
      await response.json();

    if (!response.ok) {
      console.log(
        "Image API error:",
        data
      );

      return res.status(
        response.status
      ).json({
        error:
          data.error?.message ||
          "Image generation failed."
      });
    }

    const imageData =
      data.data?.[0]?.b64_json;

    if (!imageData) {
      return res.status(500).json({
        error:
          "The image API returned no image."
      });
    }

    res.json({
      image:
        `data:image/png;base64,${imageData}`,

      revisedPrompt:
        data.data?.[0]
          ?.revised_prompt ||
        cleanPrompt
    });

  } catch (error) {
    console.error(
      "Image generation error:",
      error
    );

    res.status(500).json({
      error:
        "Image generation error: " +
        error.message
    });
  }
});

// =====================================================
// HEALTH CHECK
// =====================================================

app.get("/api/health", (req, res) => {
  res.json({
    status: "ok",
    name: "Xora",
    version: "2.0",
    model: CHAT_MODEL
  });
});

// =====================================================
// START SERVER
// =====================================================

app.listen(
  PORT,
  "0.0.0.0",
  () => {
    console.log(
      `Xora V2 running on port ${PORT}`
    );
  }
);
