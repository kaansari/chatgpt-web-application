const express = require('express');
const {Configuration, OpenAIApi} = require("openai");
const app = express();
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const multer  = require('multer');
const { v4: uuidv4 } = require('uuid');
require("dotenv").config();
const configuration = new Configuration({
    apiKey: process.env.OPENAI_API_KEY,
});
const openai = new OpenAIApi(configuration);

app.use(cors());
app.use(express.json());
app.use('/', express.static(__dirname + '/client')); // Serves resources from client folder

// Set up Multer to handle file uploads
const upload = multer({
    storage: multer.diskStorage({
        destination: function (req, file, cb) {
            cb(null, 'uploads/')
        },
        filename: function (req, file, cb) {
            const extension = path.extname(file.originalname);
            const filename = uuidv4() + extension;
            cb(null, filename);
        }
    }),
    limits: { fileSize: 1024 * 1024 * 10 }, // 10 MB
    fileFilter: function (req, file, cb) {
        const allowedExtensions = ['.mp3', '.mp4', '.mpeg', '.mpga', '.m4a', '.wav', '.webm'];
        const extension = path.extname(file.originalname);
        if (allowedExtensions.includes(extension)) {
            cb(null, true);
        } else {
            cb(new Error('Invalid file type.'));
        }
    }
});

app.post('/transcribe', upload.single('audio'), async (req, res) => {
    try {
        const resp = await openai.createTranscription(
            fs.createReadStream(req.file.path),
            "whisper-1",
            'text'
        );
        return res.send(resp.data.text);
    } catch (error) {
        const errorMsg = error.response ? error.response.data.error : `${error}`;
        console.log(errorMsg)
        return res.status(500).send(errorMsg);
    } finally {
        fs.unlinkSync(req.file.path);
    }
});

// In-memory storage for user sessions (you can replace this with a database)
let conversationHistory = {};

app.post('/get-prompt-result', async (req, res) => {
    const { prompt, model = 'chatgpt', userId } = req.body;

    // Check if prompt and userId are present
    if (!prompt || !userId) {
        return res.status(400).send({ error: 'Prompt or userId is missing in the request' });
    }

    try {
        // Check if the user has an ongoing conversation
        if (!conversationHistory[userId]) {
            // Initialize conversation history for the user and add the system message on the first call
            conversationHistory[userId] = [
                {
                    "role": "system",
                    "content": `You are a helpful assistant who is going to ask the customer data and help fill out each step and return the value in JSON in the end.  Your only job is to collect the data.  You cannot answer anything else.  You will not suggest or answer anythiing outside the realm of collecting and facilitating the process.
{
  "process_status": {
    "current_step": 1,
    "is_complete": false
  },
  "customer_data": {
    "name": null,
    "address": null,
    "phone": null,
    "email": null,
    "is_complete": false
  },

  "product_name": null,
  "pre_approval_status": false,
  "add_on_data": {
    "selected_add_ons": [],
    "add_ons_list":["Title Search", "Inspection", "Real Estate Attorney", "Appraisal"]
  }
}`
                }
            ];
        }

        // Add the new user message to the conversation history
        conversationHistory[userId].push({ role: 'user', content: prompt });

        // Prepare the messages array for the API call (including the conversation history)
        const messages = conversationHistory[userId];

        // Make the request to OpenAI API
        const result = await openai.createChatCompletion({
            model: "gpt-4o-mini", // or 'gpt-4o-mini'
            messages: messages // Send the entire conversation history
        });

        // Extract the assistant's response
        const assistantResponse = result.data.choices[0]?.message?.content;

        // Add the assistant's response to the conversation history
        conversationHistory[userId].push({ role: 'assistant', content: assistantResponse });

        // Send the assistant's response back to the user
        return res.send(assistantResponse);

    } catch (error) {
        const errorMsg = error.response ? error.response.data.error : `${error}`;
        console.error(errorMsg);
        return res.status(500).send(errorMsg);
    }
});

// Truncate conversation history if it exceeds token limits
function truncateHistory(history, maxTokens = 4000) {
    let tokenCount = 0;
    const truncatedHistory = [];

    for (let i = history.length - 1; i >= 0; i--) {
        const message = history[i];
        const messageTokens = message.content.length / 4; // Approximation: 1 token per 4 characters
        if (tokenCount + messageTokens > maxTokens) break;
        truncatedHistory.unshift(message);
        tokenCount += messageTokens;
    }

    return truncatedHistory;
}

const port = process.env.PORT || 3001;
app.listen(port, () => console.log(`Listening on port ${port}`));
