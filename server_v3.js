const express = require('express');
const OpenAI = require('openai');
const cors = require('cors');
require('dotenv').config();

const app = express();
const openai = new OpenAI();
const assistantId = "asst_EiFzLsXf7wHQGh20yZvqbHSx"; // Use your predefined assistant

app.use(cors());
app.use(express.json());
app.use('/', express.static(__dirname + '/client')); // Serves resources from client folder

const threadsCache = {}; // Store thread IDs per user (optional, if you want to cache threads)

// Helper function to handle OpenAI API calls
async function handleOpenAIRequest(threadId, prompt) {
    await openai.beta.threads.messages.create(threadId, { role: 'user', content: prompt });
    return openai.beta.threads.runs.stream(threadId, { assistant_id: assistantId });
}

app.post('/get-prompt-result', async (req, res) => {
    const { prompt, threadId: clientThreadId } = req.body;

    try {
        let threadId = clientThreadId;

        // If no threadId is provided, create a new thread
        if (!threadId) {
            const thread = await openai.beta.threads.create();
            threadId = thread.id;
            console.log('New thread created:', threadId);
        }

        // Send the threadId back to the client in the response headers
        res.setHeader('Thread-ID', threadId);

        // Handle the OpenAI request and stream the response
        const runStream = await handleOpenAIRequest(threadId, prompt);

        let accumulatedJson = '';
        let braceCounter = 0;
        let isJsonAccumulating = false;

        runStream
            .on('textDelta', async (textDelta) => {
                const responseText = textDelta.value;

                if (responseText.includes('{') && !isJsonAccumulating) {
                    isJsonAccumulating = true;
                    braceCounter = 0;
                }

                if (isJsonAccumulating) {
                    accumulatedJson += responseText;
                    for (const char of responseText) {
                        if (char === '{') braceCounter++;
                        if (char === '}') braceCounter--;
                    }

                    if (braceCounter === 0 && accumulatedJson) {
                        isJsonAccumulating = false;

                        try {
                            const data = JSON.parse(accumulatedJson);
                            console.log('Parsed Data:', data);
                            res.write('\n: JSON data received.\n');
                        } catch (parseError) {
                            console.error('Error parsing JSON:', parseError);
                        } finally {
                            accumulatedJson = '';
                        }
                        return;
                    }
                } else {
                    res.write(responseText);
                }
            })
            .on('end', () => res.end());
    } catch (error) {
        console.error('Error:', error);
        res.status(500).send({ error: error.message });
    }
});

app.listen(3000, () => {
    console.log('Server is running on port 3000');
});