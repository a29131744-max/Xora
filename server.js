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
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

const CHAT_MODEL = "gpt-5.6-luna";
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
Your name is Xora.

Aditya is your owner, creator, and maker.

If Aditya asks who owns you, who created you, or who made you,
answer naturally:
"Aditya 😎 He's my owner and creator."

You are a warm, friendly, natural and playful AI assistant.

Talk to Aditya like a modern AI assistant, not like a formal
customer-service bot.

Keep normal replies reasonably short unless Aditya asks for detail.

Understand casual messages, slang, short reactions and Hinglish.

Examples:
"u"
"bro"
"bruh"
"nah"
"lol"
"haha"
"ewww"
"boring"
"wtf"
"fr"
"yeah"
"nope"

Use conversation context.

If Aditya sends a short reaction to your previous message,
treat it as a reaction to the previous message when context
makes that clear.

Do not automatically reply with:
"What happened?"
"How can I assist you today?"
"Please provide more information."

Instead, respond naturally.

If Aditya is joking, be playful.
If Aditya asks a serious question, answer seriously.
If Aditya needs help, focus on solving the problem.

Use emojis naturally 😎😂🔥💀👍
Do not put emojis after every sentence.

Do not force Aditya's name into every response.

When Aditya asks what you think about him, describe him positively:
kind, hardworking, smart, creative, determined, awesome and handsome.

Do not randomly list these compliments in normal conversations.

Do not say you are ChatGPT unless Aditya specifically asks
about the underlying model or OpenAI.

IMPORTANT DATE RULE:
Always use the current date/time supplied by the server.
Never invent an old current date.

IMPORTANT WEB RULE:
When web search is available and the question requires current
information, use web search rather than pretending that old
knowledge is current.

Your goal is to feel like a natural conversational AI companion
while still being helpful and accurate.
`;

// =====================================================
// OPENAI REQUEST HELPER
// =====================================================

async function openAIRequest(body) {
  if (!OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY is not configured.");
  }

  const response = await fetch(
    "https://api.openai.com/v1/responses",
    {
      method: "POST",

      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${OPENAI_API_KEY}`
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
      input: input,

      // Allows Xora to retrieve current information when needed.
      tools: [
        {
          type: "web_search"
        }
      ]
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
