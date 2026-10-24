import { buildSubgraphSchema } from "@apollo/subgraph";
import { printSchema } from "graphql";
import { mkdirSync, writeFileSync } from "node:fs";
import { typeDefs } from "./graphql/schema.ts";

// Prints the subgraph SDL that ui/ codegen validates its documents against.
// Runs from api/ as a package script; needs no Redis, Mongo or running server.
mkdirSync("generated", { recursive: true });
writeFileSync(
  "generated/schema.graphql",
  printSchema(buildSubgraphSchema([{ typeDefs }])),
);
