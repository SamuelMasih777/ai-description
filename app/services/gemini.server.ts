import { GoogleGenerativeAI } from "@google/generative-ai";

export async function generateProductDescription(
  context: {
    title: string;
    productType?: string;
    vendor?: string;
    tags?: string;
    existingDescription?: string;
  },
  settings: {
    tone: string;
    length: string;
    keywords?: string;
  }
) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY is not set in environment variables.");
  }

  const genAI = new GoogleGenerativeAI(apiKey);
  // Using a fast model for text generation
  const model = genAI.getGenerativeModel({ model: "gemini-flash-latest" });

  const prompt = `
You are an expert copywriter for e-commerce. Write a product description based on the following context.
Product Title: ${context.title}
${context.productType ? `Product Type: ${context.productType}` : ""}
${context.vendor ? `Vendor: ${context.vendor}` : ""}
${context.tags ? `Tags: ${context.tags}` : ""}
${context.existingDescription ? `Existing Description Context: ${context.existingDescription}` : ""}

Requirements:
- Tone: ${settings.tone}
- Target Length: ${settings.length}
${settings.keywords ? `- Ensure the following keywords are naturally included: ${settings.keywords}` : ""}
- Provide only the description text. Do not include any extra chatter or markdown unless it's basic HTML if requested. Keep it clean and ready to publish.

Write the description:
  `;

  const result = await model.generateContent(prompt);
  const response = await result.response;
  return response.text();
}
