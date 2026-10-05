import dotenv from "dotenv";
import { GoogleGenAI } from "@google/genai";

dotenv.config({ path: "./server/.env" });

const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY,
});

try {
  console.log("Checking Gemini models...\n");

  const models = await ai.models.list();

  for await (const model of models) {
    console.log(model.name);
  }
} catch (error) {
  console.error("MODEL CHECK FAILED:");
  console.error(error);
}
