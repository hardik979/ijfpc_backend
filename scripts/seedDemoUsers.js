// scripts/seedDemoUsers.js
import mongoose from "mongoose";
import dotenv from "dotenv";
import DemoUser from "../models/DemoUser.js";

dotenv.config();

const MOCK = [
  {
    name: "Aarav Sharma",
    email: "aarav@example.com",
    role: "student",
    active: true,
  },
  {
    name: "Isha Verma",
    email: "isha@example.com",
    role: "student",
    active: true,
  },
  {
    name: "Rohit Mehra",
    email: "rohit@example.com",
    role: "teacher",
    active: true,
  },
  {
    name: "Sneha Kapoor",
    email: "sneha@example.com",
    role: "student",
    active: false,
  },
  {
    name: "Priya Nair",
    email: "priya@example.com",
    role: "admin",
    active: true,
  },
  {
    name: "Karthik Iyer",
    email: "karthik@example.com",
    role: "student",
    active: true,
  },
  {
    name: "Neha Gupta",
    email: "neha@example.com",
    role: "teacher",
    active: false,
  },
  {
    name: "Vikram Singh",
    email: "vikram@example.com",
    role: "student",
    active: true,
  },
  {
    name: "Ananya Das",
    email: "ananya@example.com",
    role: "student",
    active: true,
  },
  {
    name: "Manish Kumar",
    email: "manish@example.com",
    role: "student",
    active: true,
  },
];

async function run() {
  const uri = process.env.MONGO_URI;
  if (!uri) {
    console.error("Missing MONGO_URI in .env");
    process.exit(1);
  }
  await mongoose.connect(uri);

  // reset & seed
  await DemoUser.deleteMany({});
  const inserted = await DemoUser.insertMany(MOCK);

  console.log(`Seeded ${inserted.length} demo users.`);
  await mongoose.disconnect();
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
