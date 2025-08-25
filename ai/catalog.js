// ai/catalog.js
export const CATALOG = {
  collection: "postplacementoffers", // your collection name
  timezone: "Asia/Kolkata",
  fields: {
    studentName: { type: "string", synonyms: ["student", "name"] },
    offerDate: {
      type: "date",
      synonyms: ["offer date", "placement date", "placed on", "offer"],
    },
    joiningDate: { type: "date", synonyms: ["joining date", "join date"] },
    companyName: { type: "string", synonyms: ["company", "employer", "org"] },
    location: { type: "string", synonyms: ["city", "location"] },
    packageLPA: {
      type: "number",
      synonyms: ["package", "ctc", "salary", "lpa"],
    },
    totalPostPlacementFee: {
      type: "number",
      synonyms: ["total pp fee", "post placement fee", "total fee"],
    },
    remainingFee: {
      type: "number",
      synonyms: ["remaining", "due", "outstanding"],
    },
  },
};
