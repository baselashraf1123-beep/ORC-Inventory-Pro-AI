import { GoogleGenAI } from "@google/genai";

export interface OCRResult {
  itemNo: string;
  colorNo: string;
  length: string;
  unit?: string;
  notes?: string;
  confidence: "high" | "low";
}

export class OCRService {
  private ai: GoogleGenAI;

  constructor() {
    this.ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || "" });
  }

  async processImage(base64Image: string, retries = 3, delay = 1000): Promise<OCRResult> {
    const MAX_DELAY = 10000;
    const model = "gemini-3-flash-preview";
    
    const prompt = `
      You are a professional inventory auditor expert in OCR and label analysis. 
      Analyze the provided image of an inventory label and extract data with 100% accuracy.

      ### ADVANCED EXTRACTION RULES (THE GOLDEN RULES):
      1. **THE DOT SPLITTER (CRITICAL):** 
         - If you see a code formatted like "XXXX.YYY" (e.g., "ON001127.801"), you MUST split it:
           - "itemNo" = The part BEFORE the dot ("ON001127").
           - "colorNo" = The part AFTER the dot ("801").
      
      2. **TABLE & GRID MAPPING:**
         - Map headers to values accurately even if the image is tilted.
         - Arabic Headers Mapping: 
           - "الماركة" or "ITEM" -> itemNo.
           - "اللون" or "COLOR" -> colorNo.
           - "الطول" or "LENGTH" -> length.
         - If a value is in a cell next to or below a header, that is the correct value.

      3. **PROMINENT TEXT PRIORITY:**
         - If no explicit "ITEM NO" label exists, the largest, boldest text at the top or top-left is usually the "itemNo" (e.g., "Alba +", "LAZURDE").

      4. **CLEANING & FORMATTING:**
         - "colorNo": Remove any "#", "*", or non-alphanumeric symbols. Extract ONLY the code.
         - "length": Extract ONLY the numeric value (e.g., "52.70"). Remove "M", "MT", or "YARD" from this field.
         - "unit": If "M", "MT", "MTR" is found, set unit to "M". If "YARD" is found, set to "Yard".

      ### FIELDS TO EXTRACT (JSON FORMAT):
      - itemNo: Product code/style.
      - colorNo: Color code/number.
      - length: Numeric quantity only.
      - unit: "M", "Yard", "Roll", or "Piece".
      - notes: Extra info like "LOT", "MARK", "WIDTH", or "Made in Egypt".

      ### OUTPUT INSTRUCTIONS:
      - Return ONLY a valid JSON object.
      - If a field is absolutely not found, return an empty string "".
      - Be extremely precise with alphanumeric characters (e.g., '0' vs 'O').
    `;

    try {
      const response = await this.ai.models.generateContent({
        model,
        contents: [
          {
            parts: [
              { text: prompt },
              {
                inlineData: {
                  mimeType: "image/jpeg",
                  data: base64Image.split(",")[1] || base64Image,
                },
              },
            ],
          },
        ],
        config: {
          responseMimeType: "application/json",
          temperature: 0.1,
        }
      });

      const textResponse = response.text;
      if (!textResponse) {
        if (retries > 0) {
          const nextDelay = Math.min(delay * 2, MAX_DELAY);
          await new Promise(r => setTimeout(r, delay));
          return this.processImage(base64Image, retries - 1, nextDelay);
        }
        throw new Error("Empty response from AI");
      }

      let result;
      try {
        const cleanedJson = textResponse.replace(/```json|```/g, "").trim();
        result = JSON.parse(cleanedJson);
      } catch (parseError) {
        const jsonMatch = textResponse.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          result = JSON.parse(jsonMatch[0]);
        } else {
          if (retries > 0) {
            const nextDelay = Math.min(delay * 2, MAX_DELAY);
            await new Promise(r => setTimeout(r, delay));
            return this.processImage(base64Image, retries - 1, nextDelay);
          }
          throw new Error("Failed to parse AI response as JSON");
        }
      }

      return {
        itemNo: String(result.itemNo || "").trim().toUpperCase(),
        colorNo: String(result.colorNo || "").trim().toUpperCase(),
        length: String(result.length || "").trim(),
        unit: String(result.unit || "M").trim(),
        notes: String(result.notes || "").trim(),
        confidence: (result.itemNo && result.length) ? "high" : "low"
      };
    } catch (error: any) {
      console.error("OCR Error:", error);
      if (retries > 0) {
        const nextDelay = Math.min(delay * 2, MAX_DELAY);
        await new Promise(r => setTimeout(r, delay));
        return this.processImage(base64Image, retries - 1, nextDelay);
      }
      throw error;
    }
  }
}
