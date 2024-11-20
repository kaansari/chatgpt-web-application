const express = require('express');
const OpenAI = require('openai');
const { MongoClient } = require('mongodb');
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

/*
const uri = "mongodb://localhost:27017";
const client = new MongoClient(uri);
let db;

async function connectToMongo() {
    await client.connect();
    db = client.db("myDatabase");
}
connectToMongo().catch(console.error);
*/

app.post("/get-prompt-result", async (req, res) => {
    const { prompt, userId } = req.body;
    console.log(userId)
    if (!prompt || !userId) {
        return res.status(400).send({ error: "Prompt or userId is missing in the request" });
    }

    try {
        // Check if there's an existing thread for the user; create if none exists
        if (!threadsCache[userId]) {
            const thread = await openai.beta.threads.create();
            threadsCache[userId] = thread.id;
        }

        const threadId = threadsCache[userId];

        // Send the user's prompt as a message to the assistant
        await openai.beta.threads.messages.create(threadId, {
            role: "user",
            content: [{ type: "text", text: prompt }]
        });

        // Create and poll the run until completion
        const run = await openai.beta.threads.runs.createAndPoll(threadId, {
            assistant_id: assistantId,
            additional_instructions: null,
            tool_choice: null
        });

        if (run.status === 'completed') {
            // Fetch all messages in the thread once the run is complete
            const messages = await openai.beta.threads.messages.list(run.thread_id);

            // Validate message data to avoid errors in case of unexpected responses
            if (messages && messages.data && messages.data.length > 0) {
                const message = messages.data[0]; // Reading the most recent message
                //console.log(message);
                if (message.content && message.content.length > 0 && message.content[0].type === "text" && message.role === "assistant") {
                    
                    res.write(message.content[0].text.value);
                } else {
                    // Handle cases where the message content structure is not as expected
                    console.error("Message content is missing or not in expected format");
                    res.status(500).send({ error: "Unexpected message format from assistant." });
                }
            } else {
                console.error("No messages returned in the response");
                res.status(500).send({ error: "No messages received from assistant." });
            }
        } else {
            // Log non-completed status for debugging
            console.log("Run status:", run.status);
            res.status(500).send({ error: "Run did not complete successfully." });
        }

        res.end();

    } catch (error) {
        console.error("Error:", error);
        res.status(500).send({ error: error.message });
    }
});




app.listen(3000, () => {
    console.log('Server is running on port 3000');
});
