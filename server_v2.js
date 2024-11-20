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

    if (!prompt || !userId) {
        return res.status(400).send({ error: "Prompt or userId is missing in the request" });
    }

    try {
        // Check if there's an existing thread for the user; create if none exists
        if (!threadsCache[userId]) {
            const thread = await openai.beta.threads.create({
                messages: [{ role: 'user', content: "Hi, I am interested in your properties" }],
            });
            threadsCache[userId] = thread.id;
        }

        const threadId = threadsCache[userId];
        await openai.beta.threads.messages.create(threadId, { role: "user", content: prompt });

        let accumulatedJson = "";        // To store the JSON data
        let braceCounter = 0;            // To track opening and closing braces
        let isJsonAccumulating = false;  // Flag to track if we're accumulating JSON

        const run = openai.beta.threads.runs
            .stream(threadId, { assistant_id: assistantId })
            .on('textDelta', async (textDelta) => {
                const responseText = textDelta.value;

                // Start accumulating JSON when the first `{` is detected
                if (responseText.includes("{") && !isJsonAccumulating) {
                    isJsonAccumulating = true;
                    braceCounter = 0;  // Reset the brace counter for new JSON block
                }

                if (isJsonAccumulating) {
                    // Add the responseText to the accumulated JSON string
                    accumulatedJson += responseText;

                    // Update the braceCounter
                    for (const char of responseText) {
                        if (char === "{") braceCounter++;
                        if (char === "}") braceCounter--;
                    }

                    // Check if we've closed all braces (braceCounter returns to zero)
                    if (braceCounter === 0 && accumulatedJson) {
                        isJsonAccumulating = false;  // Stop accumulating JSON

                        try {
                            const data = JSON.parse(accumulatedJson);
                            console.log("Parsed Data:", data);

                            // Save data to MongoDB using the save tool
                            

                            res.write(`\nAssistant: Data saved successfully.\n`);
                        } catch (parseError) {
                            console.error("Error parsing JSON:", parseError);
                        } finally {
                            accumulatedJson = "";  // Clear the accumulated JSON for the next block
                        }
                        return;  // Skip sending JSON data to the client
                    }
                } else {
                    res.write(responseText);  // Send non-JSON text to the client
                }
            })
            .on('end', () => res.end());

    } catch (error) {
        console.error("Error:", error);
        res.status(500).send({ error: error.message });
    }
});



app.listen(3000, () => {
    console.log('Server is running on port 3000');
});
