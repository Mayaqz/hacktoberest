import { connectDb, disconnectDb } from "./db.ts";
import { seedDemo } from "./seed.ts";

// `npm run seed -w subedei_api`: replaces all data in MONGO_URL with the demo class.
const { url } = await connectDb({ memory: false });
const result = await seedDemo({ reset: true });
console.log(`Seeded ${url}:`, result);
await disconnectDb();
