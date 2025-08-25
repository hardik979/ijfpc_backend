// ai/gemini_universal.js
import { GoogleGenerativeAI, SchemaType } from "@google/generative-ai";
import { CATALOG } from "./catalog.js";

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

export const universalModel = genAI.getGenerativeModel({
  model: process.env.GEMINI_MODEL || "gemini-1.5-pro",
  systemInstruction: `
You convert natural language questions about the collection "${
    CATALOG.collection
  }"
into a strict JSON "UniversalPlan" that the server compiles to MongoDB.

Fields (canonical → synonyms):
${Object.entries(CATALOG.fields)
  .map(([k, v]) => `- ${k} (${v.type}): ${v.synonyms?.join(", ") || ""}`)
  .join("\n")}

Rules:
- Map user words to canonical field names via synonyms only.
- Time windows like "in July 2025" → timeRange: { field:"offerDate", year:2025, month:7 }.
- Numeric answer → kind:"count".
- “which X has most Y” (month/company/location with placements) → kind:"aggregate", groupBy the dimension, metrics:[{op:"count",as:"count"}], sort by count desc, limit 1.
- Charts → kind:"chart" with chart:{kind, x, y}.
- Lists → kind:"list" with projection.
- Use only canonical fields in filters/groupBy/metrics.
- Return ONLY JSON that matches the schema. No prose.

Examples:
Q: "How many total students do we have?"
→ {"kind":"count"}

Q: "How many students got placed in July 2025?"
→ {"kind":"count","timeRange":{"field":"offerDate","year":2025,"month":7},"filters":[{"field":"offerDate","op":"exists"}]}

Q: "How many students have remaining fees?"
→ {"kind":"count","filters":[{"field":"remainingFee","op":">","value":0}]}

Q: "How many students are paid in full?"
→ {"kind":"count","filters":[{"field":"remainingFee","op":"<=","value":0}]}

Q: "In which month did most students get placed in 2025?"
→ {"kind":"aggregate","timeRange":{"field":"offerDate","year":2025},
    "filters":[{"field":"offerDate","op":"exists"}],
    "groupBy":[{"timeBucket":{"field":"offerDate","unit":"month"}}],
    "metrics":[{"op":"count","as":"count"}],
    "sort":[{"by":"count","dir":"desc"}],"limit":1}

Q: "Top 5 companies by placements in 2025"
→ {"kind":"aggregate","timeRange":{"field":"offerDate","year":2025},
    "filters":[{"field":"offerDate","op":"exists"}],
    "groupBy":["companyName"],
    "metrics":[{"op":"count","as":"count"}],
    "sort":[{"by":"count","dir":"desc"}],"limit":5}

Q: "Bar chart of placements by location in July 2025"
→ {"kind":"chart","timeRange":{"field":"offerDate","year":2025,"month":7},
    "filters":[{"field":"offerDate","op":"exists"}],
    "groupBy":["location"],
    "metrics":[{"op":"count","as":"count"}],
    "chart":{"kind":"bar","x":"location","y":["count"]}}
  `,
  generationConfig: {
    responseMimeType: "application/json",
    responseSchema: {
      type: SchemaType.OBJECT,
      properties: {
        kind: {
          type: SchemaType.STRING,
          enum: ["count", "list", "aggregate", "chart"],
        },
        filters: {
          type: SchemaType.ARRAY,
          items: {
            type: SchemaType.OBJECT,
            properties: {
              field: { type: SchemaType.STRING },
              op: {
                type: SchemaType.STRING,
                enum: [
                  "=",
                  "!=",
                  ">",
                  ">=",
                  "<",
                  "<=",
                  "contains",
                  "in",
                  "between",
                  "exists",
                ], // ✅ fixed
              },
              value: {},
              start: {},
              end: {},
            },
            required: ["field", "op"],
          },
        },
        timeRange: {
          type: SchemaType.OBJECT,
          properties: {
            field: { type: SchemaType.STRING },
            year: { type: SchemaType.INTEGER },
            month: { type: SchemaType.INTEGER },
            start: { type: SchemaType.STRING },
            end: { type: SchemaType.STRING },
            timezone: { type: SchemaType.STRING },
          },
        },
        groupBy: {
          type: SchemaType.ARRAY,
          items: {
            oneOf: [
              { type: SchemaType.STRING },
              {
                type: SchemaType.OBJECT,
                properties: {
                  timeBucket: {
                    type: SchemaType.OBJECT,
                    properties: {
                      field: { type: SchemaType.STRING },
                      unit: {
                        type: SchemaType.STRING,
                        enum: ["day", "week", "month", "quarter", "year"],
                      },
                    },
                    required: ["field", "unit"],
                  },
                },
                required: ["timeBucket"],
              },
            ],
          },
        },
        metrics: {
          type: SchemaType.ARRAY,
          items: {
            type: SchemaType.OBJECT,
            properties: {
              op: {
                type: SchemaType.STRING,
                enum: ["count", "sum", "avg", "min", "max"],
              },
              field: { type: SchemaType.STRING },
              as: { type: SchemaType.STRING },
            },
            required: ["op"],
          },
        },
        sort: {
          type: SchemaType.ARRAY,
          items: {
            type: SchemaType.OBJECT,
            properties: {
              by: { type: SchemaType.STRING },
              dir: { type: SchemaType.STRING, enum: ["asc", "desc"] },
            },
            required: ["by"],
          },
        },
        limit: { type: SchemaType.INTEGER },
        projection: {
          type: SchemaType.ARRAY,
          items: { type: SchemaType.STRING },
        },
        chart: {
          type: SchemaType.OBJECT,
          properties: {
            kind: { type: SchemaType.STRING, enum: ["bar", "line", "pie"] },
            x: { type: SchemaType.STRING },
            y: { type: SchemaType.ARRAY, items: { type: SchemaType.STRING } },
          },
        },
        answerTemplate: { type: SchemaType.STRING },
      },
      required: ["kind"],
    },
  },
});
