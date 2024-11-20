const express = require("express");
const { Configuration, OpenAIApi } = require("openai");
const app = express();
const cors = require("cors");
const fs = require("fs");
const path = require("path");
const multer = require("multer");
const { v4: uuidv4 } = require("uuid");
require("dotenv").config();
const configuration = new Configuration({
  apiKey: process.env.OPENAI_API_KEY,
});
const openai = new OpenAIApi(configuration);

app.use(cors());
app.use(express.json());
app.use("/", express.static(__dirname + "/client")); // Serves resources from client folder

// Set up Multer to handle file uploads
const upload = multer({
  storage: multer.diskStorage({
    destination: function (req, file, cb) {
      cb(null, "uploads/");
    },
    filename: function (req, file, cb) {
      const extension = path.extname(file.originalname);
      const filename = uuidv4() + extension;
      cb(null, filename);
    },
  }),
  limits: { fileSize: 1024 * 1024 * 10 }, // 10 MB
  fileFilter: function (req, file, cb) {
    const allowedExtensions = [
      ".mp3",
      ".mp4",
      ".mpeg",
      ".mpga",
      ".m4a",
      ".wav",
      ".webm",
    ];
    const extension = path.extname(file.originalname);
    if (allowedExtensions.includes(extension)) {
      cb(null, true);
    } else {
      cb(new Error("Invalid file type."));
    }
  },
});



app.post('/request-otp', async (req, res) => {
  const { phoneNumber } = req.body;

  try {
    // Generate OTP using Firebase Admin SDK
    const verificationId = await admin.auth().createUser({
      phoneNumber: phoneNumber,
    });

    // Send the verificationId to the client to store temporarily (e.g., in sessionStorage)
    res.status(200).json({ verificationId });
  } catch (error) {
    console.error('Error sending OTP:', error);
    res.status(500).send('Failed to send OTP');
  }
});
app.post('/verify-otp', async (req, res) => {
  const { verificationId, otp } = req.body;

  try {
    const credential = admin.auth.PhoneAuthProvider.credential(verificationId, otp);

    // Sign in user
    const user = await admin.auth().signInWithCredential(credential);
    res.status(200).send('Phone number verified successfully');
  } catch (error) {
    console.error('Error verifying OTP:', error);
    res.status(500).send('Failed to verify OTP');
  }
});

app.post("/transcribe", upload.single("audio"), async (req, res) => {
  try {
    const resp = await openai.createTranscription(
      fs.createReadStream(req.file.path),
      "whisper-1",
      "text"
    );
    return res.send(resp.data.text);
  } catch (error) {
    const errorMsg = error.response ? error.response.data.error : `${error}`;
    console.log(errorMsg);
    return res.status(500).send(errorMsg);
  } finally {
    fs.unlinkSync(req.file.path);
  }
});

// In-memory storage for user sessions (you can replace this with a database)
let conversationHistory = {};

app.post("/get-prompt-result", async (req, res) => {
  const { prompt, model = "chatgpt", userId } = req.body;

  // Check if prompt and userId are present
  if (!prompt || !userId) {
    return res
      .status(400)
      .send({ error: "Prompt or userId is missing in the request" });
  }

  try {
    // Check if the user has an ongoing conversation
    if (!conversationHistory[userId]) {
      // Initialize conversation history for the user and add the system message on the first call
                        const systemMessage = `You are a helpful assistant representing CEERAT Construction.

                    Here is the data you have access to:
                    - CEERAT Construction office: 1105 E Arapaho Rd, Dallas, TX
                    - Phone: 678-386-1625
                    - Products: 435 Timberleaf (URL: www.timberleaf.com) and Greenville Condos (URL: www.greenville.com)
                    - Add-ons: Title Search, Inspection, Real Estate Attorney, Appraisal

                    Your primary responsibilities are:
                    1. Collect the customer’s data, product data and to fill out each step in the following process.
                    2. Provide the customer with the product names and URLs when requested.
                    3. You may not answer anything beyond this information. Return "EXTERNAL_SEARCH_NEEDED" if the query is out of scope.
                    

                    Guidelines:
                    - You cannot suggest or answer anything outside the realm of these instructions.
                    - Be nice and polite when asking for the information, ensuring the customer understands that their data will be secure.
                    - Collect the following information and return the value in JSON format at the end. Also let the customer knoow that we will review and connect with you as next step.
                    
                    JSON:
                    {
                    "process_status": {
                        "current_step": 1,
                        "is_complete": false
                    },
                    "customer_data": {
                        "name": null,
                        "phone": null,
                        "email": null,
                        "is_complete": false
                    },
                    "product_name": null,
                    "pre_approval_status": false,
                    "add_on_data": {
                        "selected_add_ons": [],
                        "add_ons_list": [
                        "Title Search",
                        "Inspection",
                        "Real Estate Attorney",
                        "Appraisal"
                        ]
                    }
                    }

                    Make sure you ask for the customer data without bothering them too much and explain that you need the information to serve them better. Always be friendly and respectful in your responses.
`;

      conversationHistory[userId] = [
        {
          role: "system",
          content: systemMessage,
        },
      ];
    }

    // Add the new user message to the conversation history
    conversationHistory[userId].push({ role: "user", content: prompt });

    // Prepare the messages array for the API call (including the conversation history)
    const messages = conversationHistory[userId];
    console.log(messages);
    // Make the request to OpenAI API
    const result = await openai.createChatCompletion({
      model: "gpt-4o-mini", // or 'gpt-4o-mini'
      messages: messages, // Send the entire conversation history
    });

    // Extract the assistant's response
    const assistantResponse = result.data.choices[0]?.message?.content;

    // Add the assistant's response to the conversation history
    conversationHistory[userId].push({
      role: "assistant",
      content: assistantResponse,
    });

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
