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

  async processImage(base64Image: string, retries = 2): Promise<OCRResult> {
    const model = "gemini-3-flash-preview";
    
    const prompt = `
      Analyze this inventory label image. The image might be skewed, rotated, or low quality. Try your best to extract the following fields using context and common label patterns. The label might be formatted as a table with rows and columns.

      1. ITEM NO (The product code, style number, or article name. Often labeled as 'ITEM NO.', 'ITEM NO', 'ART NO', 'STYLE', 'REF', 'SKU', or 'PO NO:'. It might also be the first prominent text like 'Alba +'. IMPORTANT: ALWAYS extract the value explicitly labeled as 'ITEM NO' or 'ITEM NO.'. Do NOT extract 'MARK'. If you see 'ITEM NO: V.M', extract 'V.M'. If you see a format like 'ITEM.COLOR' e.g., '0N001127.801', extract the part before the dot as the ITEM NO, e.g., '0N001127'. If you see 'Alba +', extract 'Alba' or 'Alba +'. If 'ITEM NO:' is followed by a name like 'LAZURDE' or 'TEXTILE FABRIC', extract that name.)
      2. COLOR NO (The color code or color number. Often labeled as 'COLOR NO', 'COL', 'COLOR', 'Color:', 'RENK', 'SHADE', or 'ITEM NO:' in some specific tables. IMPORTANT: Extract ONLY the alphanumeric part. If it says 'Color: 21', extract '21'. If it includes symbols like '#' e.g., '3#' or '6 #' or '8 #', return just '3' or '6' or '8' without the '#'. If you see a format like 'ITEM.COLOR' e.g., '0N001127.801', extract the part after the dot as the COLOR NO, e.g., '801'. If you see 'ITEM NO: LAZURDE' and below it 'COLOR NO: 8 #', extract '8'. If you see 'ITEM NO: COLOR NO: 6 #', extract '6')
      3. LENGTH / QUANTITY (The numeric value for the length or quantity. Often labeled as 'LENGTH', 'QTY', 'QUANTITY', 'QTY(ROLL NO)', or next to 'MTR |'. Extract ONLY the number. If it says "53 M", "35 MT", "50.5M", "50.5 YDS", "MTR | 52.70", "47.2 M", "42.1 M", or "49.5", return "53", "35", "50.5", "52.70", "47.2", "42.1", or "49.5")
      4. UNIT (The unit of measurement: 'M' or 'MT' or 'MTR' for meters, 'Yard' for yards, 'Roll' for rolls, 'Piece' for pieces. Look for 'M', 'MT', 'MTR', 'YDS', 'YARD', 'ROLL', 'PCS')
      5. NOTES (Any additional information like 'MARK', 'GRADE A', 'DAMAGED', 'SAMPLE', 'WIDTH', 'G.W', 'N.W', 'SKU', 'LOT', 'MATERIAL', 'COUNTRY OF ORIGIN', 'MIXING RATIO', 'WEDTH', or dates like '3/13/2026'. You can put extra extracted info here if useful, e.g., 'MARK: LJI, LOT: 1003-12, G.W: 27.4 KGS, WIDTH: 142+-2cm')

      Guidelines for low quality and different formats:
      - If a character is unclear, use the most likely digit/letter based on standard inventory formats.
      - Look for labels nearby to identify which number is which. Read row by row or column by column if it's a table. Pay close attention to the alignment of headers and values in tables.
      - Return the result strictly as a JSON object with keys: itemNo, colorNo, length, unit, notes.
      - Ensure the length is returned as a string containing only the numeric value (decimals are okay).
      - Default unit to 'M' if not clearly specified.
      - If a value is absolutely not found, return an empty string for that key.
      - Only return the JSON.
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
        if (retries > 0) return this.processImage(base64Image, retries - 1);
        console.error("Empty response from Gemini");
        return { itemNo: "", colorNo: "", length: "", confidence: "low" };
      }

      console.log("Gemini Raw Response:", textResponse);
      
      let result;
      try {
        result = JSON.parse(textResponse.trim());
      } catch (parseError) {
        console.error("JSON Parse Error:", parseError, "Raw Text:", textResponse);
        // Fallback: try to extract JSON with regex if it's wrapped in markdown
        const jsonMatch = textResponse.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          result = JSON.parse(jsonMatch[0]);
        } else {
          if (retries > 0) return this.processImage(base64Image, retries - 1);
          throw parseError;
        }
      }

      return {
        itemNo: String(result.itemNo || "").trim(),
        colorNo: String(result.colorNo || "").trim(),
        length: String(result.length || "").trim(),
        unit: String(result.unit || "M").trim(),
        notes: String(result.notes || "").trim(),
        confidence: (result.itemNo && result.length) ? "high" : "low"
      };
    } catch (error) {
      console.error("OCR Error:", error);
      if (retries > 0) {
        await new Promise(r => setTimeout(r, 1000)); // Wait 1s before retry
        return this.processImage(base64Image, retries - 1);
      }
      return { itemNo: "", colorNo: "", length: "", confidence: "low" };
    }
  }
}
