const express = require('express');
const OpenAI = require('openai');
const app = express();
const cors = require("cors");
const fs = require("fs");
const path = require("path");
const multer = require("multer");
const { v4: uuidv4 } = require("uuid");
require("dotenv").config();



app.use(express.json());


const openai = new OpenAI();
const assistantId = "asst_EiFzLsXf7wHQGh20yZvqbHSx"; // Use your predefined assistant

app.use(cors());
app.use(express.json());
app.use("/", express.static(__dirname + "/client")); // Serves resources from client folder

const threadsCache = {}; // Store thread IDs per user



// Route to handle prompt submissions
app.post("/get-prompt-result", async (req, res) => {
    const { prompt, userId } = req.body;

    if (!prompt || !userId) {
        return res.status(400).send({ error: "Prompt or userId is missing in the request" });
    }

    try {
        // Check if there's an existing thread for the user
        if (!threadsCache[userId]) {
            const thread = await openai.beta.threads.create({
                messages: [{ role: 'user', content: "Starting a conversation." }],
            });
            threadsCache[userId] = thread.id;
        }

        const threadId = threadsCache[userId];

        // Send user message to the thread
        await openai.beta.threads.messages.create(threadId, { role: "user", content: prompt });

        // Stream response to client
        const run = openai.beta.threads.runs
            .stream(threadId, { assistant_id: assistantId })
            .on('textDelta', (textDelta) => res.write(textDelta.value))
            .on('end', () => res.end());

    } catch (error) {
        console.error("Error:", error);
        res.status(500).send({ error: error.message });
    }
});

app.listen(3000, () => {
    console.log('Server is running on port 3000');
});
