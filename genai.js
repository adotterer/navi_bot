import { GoogleGenAI } from "@google/genai";
import dotenv from 'dotenv';
dotenv.config();
function getClient() {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
        throw new Error("GEMINI_API_KEY is not set in environment variables.");
    }

    return new GoogleGenAI({
        apiKey: apiKey,
        defaultModel: process.env.GEMINI_MODEL || "gemini_2.5-flash",
    });
}

async function testGenAI() {
    const ai = getClient();
    const response = await ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: "Explain how AI works in a few words",
    });
    console.log(response.text);
}

testGenAI().catch(console.error);