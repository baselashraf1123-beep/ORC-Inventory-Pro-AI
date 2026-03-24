import { GoogleGenAI } from "@google/genai";

export interface OCRResult {
  itemNo: string;
  colorNo: string;
  length: string;
  unit?: string;
  notes?: string;
  confidence: "high" | "low";
  needsReview?: boolean;
  errorDetail?: string;
}

export class OCRService {
  private ai: GoogleGenAI;

  constructor() {
    this.ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || "" });
  }

  async processImage(base64Image: string, retries = 3, delay = 1500): Promise<OCRResult> {
    const MAX_DELAY = 12000;
    const model = "gemini-3-flash-preview";
    
    const prompt = `
      You are a professional inventory auditor expert in OCR and label analysis. 
      Analyze the provided image of an inventory label and extract data with 100% accuracy.

      ### ADVANCED EXTRACTION RULES (THE GOLDEN RULES):
      1. **THE DOT SPLITTER (CRITICAL):** 
         - If you see a code formatted like "XXXX.YYY" (e.g., "ON001127.801"), you MUST split it:
           - "itemNo" = The part BEFORE the dot ("ON001127").
           - "colorNo" = The part AFTER the dot ("801").
      
      2. **DEEP DETAIL CAPTURE (NO DATA LOSS):**
         - Scan for technical specifications: "LOT", "BATCH", "WIDTH", "GSM", "G.W", "N.W", "GRADE".
         - Format these into the "notes" field as a clean string (e.g., "LOT: 123, WIDTH: 280cm, GSM: 180").
         - If "Made in Egypt" or any origin is found, include it in notes.

      3. **TABLE & GRID MAPPING:**
         - Arabic/English Headers: "الماركة/ITEM", "اللون/COLOR", "الطول/LENGTH", "الوزن/WEIGHT".
         - Map values accurately based on their position relative to headers.

      4. **CLEANING & FORMATTING:**
         - "colorNo": Remove "#", "*", or symbols.
         - "length": Numeric only. Remove "M", "MT", "YARD".
         - "unit": Normalize to "M", "Yard", "Roll", or "Piece".

      ### PATTERN RECOGNITION (CROSS-REFERENCE):
      - "itemNo" usually starts with letters followed by numbers (e.g., ON, AB, XY).
      - "colorNo" is typically a 3 to 5 digit number.
      - If you find multiple numbers, the one near "LENGTH" or "M" is the quantity.

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
      if (!base64Image || base64Image.length < 100) {
        throw new Error("Invalid image data provided");
      }

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
          throw new Error("Failed to parse AI response as JSON");
        }
      }

      // Pattern Cross-Referencing & Validation Logic
      let itemNo = String(result.itemNo || "").trim().toUpperCase();
      let colorNo = String(result.colorNo || "").trim().toUpperCase();
      const length = String(result.length || "").trim();
      
      // Post-processing: Standardize common OCR mistakes
      itemNo = itemNo.replace(/[^A-Z0-9.-]/g, ""); // Remove invalid chars
      colorNo = colorNo.replace(/[^0-9A-Z]/g, ""); // Color is usually alphanumeric

      let needsReview = false;
      let confidence: "high" | "low" = "high";

      // Check for common patterns
      const itemPattern = /^[A-Z]{1,4}\d+/; // Starts with letters then numbers
      const colorPattern = /^\d{2,6}$/; // 2-6 digits

      if (!itemPattern.test(itemNo) && itemNo !== "") {
        needsReview = true;
        confidence = "low";
      }

      if (!colorPattern.test(colorNo) && colorNo !== "") {
        // Some colors might have letters, but usually they are numeric
        if (!/^[A-Z0-9]{2,8}$/.test(colorNo)) {
          needsReview = true;
          confidence = "low";
        }
      }

      if (!length || isNaN(parseFloat(length)) || parseFloat(length) <= 0) {
        needsReview = true;
        confidence = "low";
      }

      // If both itemNo and colorNo are missing, it's a definite low confidence
      if (!itemNo && !colorNo) {
        confidence = "low";
        needsReview = true;
      }

      return {
        itemNo,
        colorNo,
        length,
        unit: String(result.unit || "M").trim(),
        notes: String(result.notes || "").trim(),
        confidence,
        needsReview
      };
    } catch (error: any) {
      // Detailed logging for debugging as requested
      console.error("OCR Process Failure - Deep Debug Info:", {
        errorMessage: error.message,
        errorStack: error.stack,
        fullError: error,
        imageMetadata: {
          length: base64Image.length,
          type: base64Image.substring(0, 30),
          preview: base64Image.substring(0, 200) + "..."
        },
        timestamp: new Date().toISOString(),
        retryCount: retries
      });

      if (retries > 0) {
        const nextDelay = Math.min(delay * 2, MAX_DELAY);
        console.log(`[OCR Retry] Attempting recovery in ${delay}ms... (${retries} remaining)`);
        await new Promise(r => setTimeout(r, delay));
        return this.processImage(base64Image, retries - 1, nextDelay);
      }

      // User-friendly error message for persistent failures
      const userFriendlyError = this.getUserFriendlyErrorMessage(error);
      throw new Error(userFriendlyError);
    }
  }

  async processBatch(images: string[], retries = 2): Promise<OCRResult[]> {
    if (images.length === 0) return [];
    if (images.length === 1) return [await this.processImage(images[0], retries)];

    const model = "gemini-3-flash-preview";
    const batchPrompt = `
      You are a professional inventory auditor. Analyze the provided ${images.length} images of inventory labels.
      Extract data for EACH image accurately.

      ### EXTRACTION RULES FOR EACH IMAGE:
      1. **THE DOT SPLITTER:** Split "XXXX.YYY" into itemNo (XXXX) and colorNo (YYY).
      2. **DEEP DETAIL:** Capture LOT, BATCH, WIDTH, GSM, GRADE into "notes".
      3. **CLEANING:** length must be numeric. unit must be M, Yard, Roll, or Piece.
      
      ### OUTPUT FORMAT:
      Return a JSON ARRAY of objects. Each object corresponds to an image in the order provided.
      [
        { "itemNo": "...", "colorNo": "...", "length": "...", "unit": "...", "notes": "..." },
        ...
      ]
      
      If an image is unreadable, return empty strings for its fields.
    `;

    try {
      const imageParts = images.map(img => ({
        inlineData: {
          mimeType: "image/jpeg",
          data: img.split(",")[1] || img,
        },
      }));

      const response = await this.ai.models.generateContent({
        model,
        contents: [
          {
            parts: [
              { text: batchPrompt },
              ...imageParts
            ],
          },
        ],
        config: {
          responseMimeType: "application/json",
          temperature: 0.1,
        }
      });

      const textResponse = response.text;
      if (!textResponse) throw new Error("Empty response from AI");

      let results: any[];
      try {
        const cleanedJson = textResponse.replace(/```json|```/g, "").trim();
        results = JSON.parse(cleanedJson);
      } catch (e) {
        const jsonMatch = textResponse.match(/\[[\s\S]*\]/);
        if (jsonMatch) {
          results = JSON.parse(jsonMatch[0]);
        } else {
          throw new Error("Failed to parse batch response");
        }
      }

      // Ensure we have a result for each image
      return images.map((_, index) => {
        const res = results[index] || {};
        return {
          itemNo: String(res.itemNo || "").trim().toUpperCase(),
          colorNo: String(res.colorNo || "").trim().toUpperCase(),
          length: String(res.length || "").trim(),
          unit: String(res.unit || "M").trim(),
          notes: String(res.notes || "").trim(),
          confidence: (res.itemNo && res.length) ? "high" : "low",
          needsReview: !(res.itemNo && res.length)
        };
      });

    } catch (error: any) {
      console.error("Batch OCR Failure:", error);
      if (retries > 0) {
        await new Promise(r => setTimeout(r, 2000));
        return this.processBatch(images, retries - 1);
      }
      // Fallback to single processing if batch fails completely
      console.log("Falling back to single processing for batch...");
      const individualResults: OCRResult[] = [];
      for (const img of images) {
        try {
          individualResults.push(await this.processImage(img, 1));
        } catch (e) {
          individualResults.push({
            itemNo: "", colorNo: "", length: "", confidence: "low", needsReview: true,
            errorDetail: "فشلت المعالجة الفردية"
          });
        }
      }
      return individualResults;
    }
  }

  private getUserFriendlyErrorMessage(error: any): string {
    const msg = error.message.toLowerCase();
    if (msg.includes("api key")) return "خطأ في مفتاح الوصول (API Key). يرجى التحقق من الإعدادات.";
    if (msg.includes("network") || msg.includes("fetch")) return "فشل الاتصال بالإنترنت. يرجى التحقق من الشبكة والمحاولة مرة أخرى.";
    if (msg.includes("quota") || msg.includes("limit")) return "تم تجاوز حد الاستخدام المسموح به. يرجى المحاولة لاحقاً.";
    if (msg.includes("safety")) return "تم حجب الصورة لأسباب تتعلق بسياسة الأمان. يرجى التأكد من محتوى الصورة.";
    return "فشلت عملية قراءة الصورة بشكل متكرر. يرجى التأكد من وضوح الإضاءة وجودة الصورة.";
  }
}
