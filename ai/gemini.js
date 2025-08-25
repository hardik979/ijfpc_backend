// ai/gemini.js
import { GoogleGenerativeAI, SchemaType } from "@google/generative-ai";

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

export const model = genAI.getGenerativeModel({
  model: process.env.GEMINI_MODEL || "gemini-2.0-flash",
  systemInstruction: `
You are a data query planner for a MongoDB collection "PostPlacementOffer".
Each document has: studentName, offerDate(Date), joiningDate(Date), companyName, location,
hr:{name,contactNumber,email}, packageLPA(Number), totalPostPlacementFee(Number),
remainingPrePlacementFee(Number), discount(Number), installments[{label,amount}],
remainingFee(Number), remainingFeeNote(String).

Mapping rules:
- "placed" => documents where offerDate is set and falls in the requested time window.
- "in July 2025" => time.year=2025, time.month=7 (1..12).
- "package" refers to packageLPA.
- For "bar graph of students placed in <month> <year> and their package":
  intent=CHART_PLACEMENTS_BY_STUDENT,
  chart={kind:"bar", xKey:"studentName", yKeys:["packageLPA"]}

Return ONLY strict JSON (no prose, no code fences) following the response schema.
  `,
  generationConfig: {
    responseMimeType: "application/json",
    responseSchema: {
      type: SchemaType.OBJECT,
      properties: {
        intent: {
          type: SchemaType.STRING,
          enum: [
            "COUNT_PLACEMENTS",
            "LIST_PLACEMENTS",
            "CHART_PLACEMENTS_BY_STUDENT",
            "CHART_MONTHLY_TREND",
          ],
        },
        time: {
          type: SchemaType.OBJECT,
          properties: {
            year: { type: SchemaType.INTEGER },
            month: { type: SchemaType.INTEGER },
          },
        },
        filters: {
          type: SchemaType.OBJECT,
          properties: {
            company: { type: SchemaType.STRING },
            location: { type: SchemaType.STRING },
          },
        },
        chart: {
          type: SchemaType.OBJECT,
          properties: {
            kind: { type: SchemaType.STRING, enum: ["bar", "line", "pie"] },
            xKey: { type: SchemaType.STRING },
            yKeys: {
              type: SchemaType.ARRAY,
              items: { type: SchemaType.STRING },
            },
          },
        },
      },
      required: ["intent"],
    },
  },
});
