import type { CodegenConfig } from "@graphql-codegen/cli";

// Validates every document in src/ against the SDL the API printed to
// api/generated/schema.graphql and generates the result/variable types into
// src/gql/ (gitignored; `codegen` runs before check/build/dev).
const config: CodegenConfig = {
  schema: "../api/generated/schema.graphql",
  documents: ["src/**/*.{ts,tsx}", "!src/gql/**"],
  generates: {
    "src/gql/": {
      preset: "client",
      presetConfig: { fragmentMasking: false, gqlTagName: "gql" },
      config: {
        scalars: {
          Date: { input: "string | Date", output: "string" },
          JSON: "unknown",
        },
        enumsAsTypes: true,
        useTypeImports: true,
      },
    },
  },
};

export default config;
