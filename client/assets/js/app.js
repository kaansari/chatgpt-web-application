const API_URL = 'http://localhost:3000/';
const converter = new showdown.Converter();
let promptToRetry = null;
let uniqueIdToRetry = null;

const submitButton = document.getElementById('submit-button');
const regenerateResponseButton = document.getElementById('regenerate-response-button');
const promptInput = document.getElementById('prompt-input');

const responseList = document.getElementById('response-list');
const fileInput = document.getElementById("whisper-file");

let isGeneratingResponse = false;
let loadInterval = null;

// Retrieve threadId from localStorage or initialize as null
let threadId = localStorage.getItem('threadId') || null;

promptInput.addEventListener('keydown', function (event) {
    if (event.key === 'Enter') {
        event.preventDefault();
        if (event.ctrlKey || event.shiftKey) {
            document.execCommand('insertHTML', false, '<br/><br/>');
        } else {
            getGPTResult();
        }
    }
});

function generateUniqueId() {
    const timestamp = Date.now();
    const randomNumber = Math.random();
    const hexadecimalString = randomNumber.toString(16);

    return `id-${timestamp}-${hexadecimalString}`;
}

function addResponse(selfFlag, prompt) {
    const uniqueId = generateUniqueId();
    const html = `
            <div class="response-container ${selfFlag ? 'my-question' : 'chatgpt-response'}">
                <img class="avatar-image" src="assets/img/${selfFlag ? 'me' : 'chatgpt'}.png" alt="avatar"/>
                <div class="prompt-content" id="${uniqueId}">${prompt}</div>
            </div>
        `;
    responseList.insertAdjacentHTML('beforeend', html);
    responseList.scrollTop = responseList.scrollHeight;
    return uniqueId;
}

function loader(element) {
    element.textContent = '';

    loadInterval = setInterval(() => {
        // Update the text content of the loading indicator
        element.textContent += '.';

        // If the loading indicator has reached three dots, reset it
        if (element.textContent === '....') {
            element.textContent = '';
        }
    }, 300);
}

function setErrorForResponse(element, message) {
    element.innerHTML = message;
    element.style.color = 'rgb(200, 0, 0)';
}

function setRetryResponse(prompt, uniqueId) {
    promptToRetry = prompt;
    uniqueIdToRetry = uniqueId;
    regenerateResponseButton.style.display = 'flex';
}

async function regenerateGPTResult() {
    try {
        await getGPTResult(promptToRetry, uniqueIdToRetry);
        regenerateResponseButton.classList.add("loading");
    } finally {
        regenerateResponseButton.classList.remove("loading");
    }
}

async function getWhisperResult() {
    if (!fileInput.files?.length) {
        return;
    }
    const formData = new FormData();
    formData.append("audio", fileInput.files[0]);
    const uniqueId = addResponse(false);
    const responseElement = document.getElementById(uniqueId);
    isGeneratingResponse = true;
    loader(responseElement);

    try {
        submitButton.classList.add("loading");
        const response = await fetch("/transcribe", {
            method: "POST",
            body: formData
        });
        if (!response.ok) {
            setErrorForResponse(responseElement, `HTTP Error: ${await response.text()}`);
            return;
        }
        const responseText = await response.text();
        responseElement.innerHTML = `<div>${responseText}</div>`;
    } catch (e) {
        console.log(e);
        setErrorForResponse(responseElement, `Error: ${e.message}`);
    } finally {
        isGeneratingResponse = false;
        submitButton.classList.remove("loading");
        clearInterval(loadInterval);
    }
}

// Function to get GPT result with streaming updates
async function getGPTResult(_promptToRetry, _uniqueIdToRetry) {
    const prompt = _promptToRetry ?? promptInput.textContent;

    if (isGeneratingResponse || !prompt) {
        return;
    }

    submitButton.classList.add("loading");
    promptInput.textContent = '';

    if (!_uniqueIdToRetry) {
        addResponse(true, `<div>${prompt}</div>`);
    }

    const uniqueId = _uniqueIdToRetry ?? addResponse(false);
    const responseElement = document.getElementById(uniqueId);
    loader(responseElement);
    isGeneratingResponse = true;

    try {
        const response = await fetch("/get-prompt-result", {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ prompt, threadId }), // Send threadId with the prompt
        });

        if (!response.ok) {
            throw new Error(`HTTP Error: ${await response.text()}`);
        }

        // Save the threadId from the response headers
        const responseThreadId = response.headers.get('Thread-ID');
        if (responseThreadId && responseThreadId !== threadId) {
            threadId = responseThreadId;
            localStorage.setItem('threadId', threadId); // Save threadId to localStorage
        }

        // Stream response and update UI incrementally
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        responseElement.innerHTML = '';
        let readDone, chunk;

        while (!readDone) {
            ({ done: readDone, value: chunk } = await reader.read());
            if (chunk) responseElement.innerHTML += decoder.decode(chunk);
        }

        promptToRetry = null;
        uniqueIdToRetry = null;
        regenerateResponseButton.style.display = 'none';
        setTimeout(() => {
            responseList.scrollTop = responseList.scrollHeight;
            hljs.highlightAll();
        }, 10);
    } catch (err) {
        setRetryResponse(prompt, uniqueId);
        setErrorForResponse(responseElement, `Error: ${err.message}`);
    } finally {
        isGeneratingResponse = false;
        submitButton.classList.remove("loading");
        clearInterval(loadInterval);
    }
}

submitButton.addEventListener("click", () => {
    getGPTResult();
});

regenerateResponseButton.addEventListener("click", () => {
    regenerateGPTResult();
});

document.addEventListener("DOMContentLoaded", function () {
    promptInput.focus();
});

function formatMessage(message) {
    // Convert phone numbers to clickable links
    const phoneRegex = /(\+\d{1,2}\s?)?(\(?\d{3}\)?[-.\s]?){2,3}\d{4}/g;
    message = message.replace(phoneRegex, (phone) => `<a href="tel:${phone}" style="color: #10A37F;">${phone}</a>`);

    // Convert URLs to clickable links
    const urlRegex = /(https?:\/\/[^\s]+)/g; // For absolute URLs
    message = message.replace(urlRegex, (url) => `<a href="${url}" target="_blank" style="color: #10A37F;">${url}</a>`);

    const markdownUrlRegex = /\[([^\]]+)\]\((https?:\/\/[^\s]+)\)/g; // For markdown-style links
    message = message.replace(markdownUrlRegex, (match, text, url) => `<a href="${url}" target="_blank" style="color: #10A37F;">${text}</a>`);

    return message;
}