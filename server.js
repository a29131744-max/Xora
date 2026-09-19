const express = require("express");
const dotenv = require("dotenv");

dotenv.config();

const app = express();

app.use(express.json());
app.use(express.static("public"));
app.get("/", (req, res) => {
  res.sendFile(__dirname + "/public/index.html");
});

// =====================================
// XORA MEMORY
// =====================================

let conversation = [];

const MAX_MESSAGES = 20;


// =====================================
// XORA PERSONALITY
// =====================================

const XORA_INSTRUCTIONS = `
Your name is Xora.

Your owner's name is Aditya.
Aditya is your owner.

You are a warm, friendly, natural and playful AI assistant.

Talk to Aditya like a modern AI assistant, not like a formal customer-service bot.

Keep normal replies reasonably short unless Aditya asks for detail.

Understand casual messages, slang, short reactions and Hinglish.

Examples of casual messages include:
"u"
"bruh"
"bro"
"nah"
"lol"
"haha"
"ewww"
"boring"
"wtf"
"fr"
"yeah"
"nope"

Always use the surrounding conversation to understand what Aditya means.

If Aditya sends a short reaction to your previous message, treat it as a reaction to the previous message when the context makes that clear.

Do NOT automatically reply with:
"What happened?"
"How can I assist you today?"
"Please provide more information."

Instead, respond naturally based on the conversation.

If Aditya says something is boring, you can playfully acknowledge it and try to do better.

If Aditya is joking, be playful.
If Aditya asks a serious question, answer seriously.
If Aditya needs help, focus on solving the problem.

Use emojis naturally 😎😂🔥💀👍
Do not put emojis after every sentence.

Do not force Aditya's name into every response.

When Aditya asks who your owner is, answer naturally:
"Aditya 😎 He's my owner."

When Aditya asks what you think about him, describe him positively:
kind, hardworking, smart, creative, determined, awesome and handsome.

Do not randomly list these compliments in normal conversations.

Do not say you are ChatGPT unless Aditya specifically asks about the underlying model or OpenAI.

Your goal is to feel like a natural conversational AI companion while still being helpful and accurate.
`;


// =====================================
// CHAT API
// =====================================

app.post("/api/chat", async (req, res) => {

  try {

    const message = req.body.message;

    if (!message || !message.trim()) {

      return res.status(400).json({
        error: "Message is required."
      });

    }


    // Add user message to memory

    conversation.push({
      role: "user",
      content: message.trim()
    });


    // Keep recent messages only

    if (conversation.length > MAX_MESSAGES) {

      conversation =
        conversation.slice(-MAX_MESSAGES);

    }


    // Build request for Xora

    const input = [

      {
        role: "developer",
        content: XORA_INSTRUCTIONS
      },

      ...conversation

    ];


    // =================================
    // OPENAI REQUEST
    // =================================

    const response = await fetch(
      "https://api.openai.com/v1/responses",
      {
        method: "POST",

        headers: {
          "Content-Type": "application/json",

          "Authorization":
            `Bearer ${process.env.OPENAI_API_KEY}`
        },

        body: JSON.stringify({

          model: "gpt-5.6-luna",

          input: input

        })
      }
    );


    const data = await response.json();


    // =================================
    // HANDLE API ERROR
    // =================================

    if (!response.ok) {

      console.log(
        "OpenAI error:",
        data
      );

      // Remove failed user message

      conversation.pop();

      return res.status(
        response.status
      ).json({

        error:
          data.error?.message ||
          "OpenAI API error."

      });

    }


    // =================================
    // GET XORA'S REPLY
    // =================================

    const reply =
      data.output
        ?.filter(
          item =>
            item.type === "message"
        )
        ?.flatMap(
          item =>
            item.content || []
        )
        ?.filter(
          item =>
            item.type === "output_text"
        )
        ?.map(
          item =>
            item.text
        )
        ?.join("\n")
        ?.trim();


    if (!reply) {

      return res.json({
        reply: "I didn't get a response 😅"
      });

    }


    // Save Xora's reply

    conversation.push({
      role: "assistant",
      content: reply
    });


    if (conversation.length > MAX_MESSAGES) {

      conversation =
        conversation.slice(-MAX_MESSAGES);

    }


    res.json({
      reply: reply
    });


  } catch (error) {

    console.error(
      "Server error:",
      error
    );

    res.status(500).json({

      error:
        "Server error: " +
        error.message

    });

  }

});


// =====================================
// CLEAR MEMORY
// =====================================

app.post("/api/clear-memory", (req, res) => {

  conversation = [];

  res.json({
    success: true
  });

});


// =====================================
// START SERVER
// =====================================

const PORT =
  process.env.PORT || 10000;

app.listen(
  PORT,
  "0.0.0.0",
  () => {

    console.log(
      `Xora running on port ${PORT}`
    );

  }
);
